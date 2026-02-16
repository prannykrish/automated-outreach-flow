-- Add columns to organization_domains for Resend domain API integration
ALTER TABLE public.organization_domains
ADD COLUMN IF NOT EXISTS resend_domain_id TEXT,
ADD COLUMN IF NOT EXISTS dns_records JSONB,
ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending';

-- Add comment for status values
COMMENT ON COLUMN public.organization_domains.status IS
  'Domain verification status: pending, not_started, verified, failed, temporary_failure';

-- Create index for faster lookups by resend_domain_id
CREATE INDEX IF NOT EXISTS idx_organization_domains_resend_domain_id
  ON public.organization_domains(resend_domain_id)
  WHERE resend_domain_id IS NOT NULL;
