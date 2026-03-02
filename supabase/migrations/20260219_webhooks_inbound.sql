-- Add bounce details to email_logs
ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS bounce_type TEXT,
  ADD COLUMN IF NOT EXISTS bounce_message TEXT;

-- Create inbound_emails table
CREATE TABLE IF NOT EXISTS public.inbound_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  from_email TEXT NOT NULL,
  from_name TEXT,
  to_email TEXT NOT NULL,
  cc TEXT[],
  subject TEXT,
  html TEXT,
  text_body TEXT,
  resend_email_id TEXT UNIQUE,
  in_reply_to_log_id UUID REFERENCES public.email_logs(id),
  customer_id UUID REFERENCES public.customers(id),
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_inbound_org_created ON public.inbound_emails (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_customer ON public.inbound_emails (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_resend_id ON public.inbound_emails (resend_email_id);

-- RLS
ALTER TABLE public.inbound_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view inbound emails"
  ON public.inbound_emails FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Service role can insert inbound emails"
  ON public.inbound_emails FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Org members can update inbound emails"
  ON public.inbound_emails FOR UPDATE
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));
