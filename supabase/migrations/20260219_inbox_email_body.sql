-- Add rendered email content columns to email_logs for Inbox feature
ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS sender_email TEXT;

-- Index for Inbox page queries: filter by org + order by sent_at
CREATE INDEX IF NOT EXISTS idx_email_logs_org_sent
  ON public.email_logs (organization_id, sent_at DESC);

-- Index for filtering by sender email within an org
CREATE INDEX IF NOT EXISTS idx_email_logs_org_sender
  ON public.email_logs (organization_id, sender_email, sent_at DESC);
