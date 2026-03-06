-- Domain Warming Status Checker
-- Returns per-domain warming status for an organization based on domain age and daily send volume.
-- Warming schedule (conservative, industry-standard):
--   Week 1:  max 20/day
--   Week 2:  max 50/day
--   Week 3:  max 100/day
--   Week 4:  max 200/day
--   Month 2: max 500/day
--   Month 3+: max 1000/day

CREATE OR REPLACE FUNCTION public.check_domain_warming_status(org_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result json;
BEGIN
  SELECT json_agg(row_to_json(t)) INTO result
  FROM (
    SELECT
      d.domain,
      EXTRACT(DAY FROM now() - COALESCE(d.verified_at, d.created_at))::int AS domain_age_days,
      COALESCE(s.today_sent, 0)::int AS today_sent,
      CASE
        WHEN EXTRACT(DAY FROM now() - COALESCE(d.verified_at, d.created_at)) <= 7  THEN 20
        WHEN EXTRACT(DAY FROM now() - COALESCE(d.verified_at, d.created_at)) <= 14 THEN 50
        WHEN EXTRACT(DAY FROM now() - COALESCE(d.verified_at, d.created_at)) <= 21 THEN 100
        WHEN EXTRACT(DAY FROM now() - COALESCE(d.verified_at, d.created_at)) <= 30 THEN 200
        WHEN EXTRACT(DAY FROM now() - COALESCE(d.verified_at, d.created_at)) <= 60 THEN 500
        ELSE 1000
      END::int AS recommended_limit,
      COALESCE(s.today_sent, 0) >=
        CASE
          WHEN EXTRACT(DAY FROM now() - COALESCE(d.verified_at, d.created_at)) <= 7  THEN 20
          WHEN EXTRACT(DAY FROM now() - COALESCE(d.verified_at, d.created_at)) <= 14 THEN 50
          WHEN EXTRACT(DAY FROM now() - COALESCE(d.verified_at, d.created_at)) <= 21 THEN 100
          WHEN EXTRACT(DAY FROM now() - COALESCE(d.verified_at, d.created_at)) <= 30 THEN 200
          WHEN EXTRACT(DAY FROM now() - COALESCE(d.verified_at, d.created_at)) <= 60 THEN 500
          ELSE 1000
        END AS is_over_limit
    FROM organization_domains d
    LEFT JOIN (
      SELECT
        split_part(
          CASE WHEN sender_email LIKE '%<%>%'
            THEN substring(sender_email FROM '<(.+)>')
            ELSE sender_email
          END, '@', 2
        ) AS send_domain,
        COUNT(*)::int AS today_sent
      FROM email_logs
      WHERE organization_id = org_id
        AND status = 'sent'
        AND sent_at::date = CURRENT_DATE
      GROUP BY send_domain
    ) s ON s.send_domain = d.domain
    WHERE d.organization_id = org_id
      AND d.status = 'verified'
    ORDER BY d.domain
  ) t;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

-- Performance index for daily send volume queries
CREATE INDEX IF NOT EXISTS idx_email_logs_org_sent_date
  ON email_logs(organization_id, (sent_at::date))
  WHERE status = 'sent';
