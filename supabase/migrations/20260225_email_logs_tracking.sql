-- Add tracking columns to email_logs for full webhook event coverage
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS clicked_at timestamptz;

-- Add campaign_id to email_logs if not present (for linking campaign emails)
ALTER TABLE email_logs ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES agent_campaigns(id) ON DELETE SET NULL;

-- Add index for faster analytics queries
CREATE INDEX IF NOT EXISTS idx_email_logs_org_sent ON email_logs(organization_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_campaign ON email_logs(campaign_id) WHERE campaign_id IS NOT NULL;

-- Add scheduled_send_date to agent_email_drafts for timeline display
ALTER TABLE agent_email_drafts ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
ALTER TABLE agent_email_drafts ADD COLUMN IF NOT EXISTS delay_days integer DEFAULT 0;
