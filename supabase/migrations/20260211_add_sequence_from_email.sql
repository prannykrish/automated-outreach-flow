-- Add organization_email_id to email_sequences so each sequence
-- knows which verified email to send from.
ALTER TABLE public.email_sequences
ADD COLUMN IF NOT EXISTS organization_email_id UUID REFERENCES public.organization_emails(id) ON DELETE SET NULL;
