-- Add reply_to field to organization_emails
ALTER TABLE organization_emails ADD COLUMN IF NOT EXISTS reply_to text;
