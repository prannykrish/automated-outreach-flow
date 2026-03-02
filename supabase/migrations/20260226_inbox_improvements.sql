-- Add attachments column to inbound_emails for storing attachment metadata
ALTER TABLE public.inbound_emails
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

-- Add in_reply_to_log_id to email_logs if not already present (idempotent)
ALTER TABLE public.email_logs
  ADD COLUMN IF NOT EXISTS in_reply_to_log_id uuid REFERENCES public.email_logs(id) ON DELETE SET NULL;

-- Create in-app notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  user_id UUID REFERENCES auth.users(id),
  type TEXT NOT NULL, -- 'reply_received', 'reply_reminder', etc.
  title TEXT NOT NULL,
  body TEXT,
  link TEXT, -- e.g. '/inbox'
  is_read BOOLEAN DEFAULT FALSE,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON public.notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_org ON public.notifications (organization_id, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid() OR organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid() OR organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Service role can insert notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (true);

-- Track reply reminders so we don't send duplicates
CREATE TABLE IF NOT EXISTS public.reply_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_email_id UUID NOT NULL REFERENCES public.inbound_emails(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  customer_id UUID REFERENCES public.customers(id),
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'sent', 'handled', 'resumed'
  reminder_sent_at TIMESTAMPTZ,
  user_action TEXT, -- 'draft_reply', 'resume', 'mark_handled'
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reply_reminders_status ON public.reply_reminders (status, created_at);

ALTER TABLE public.reply_reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view reply reminders"
  ON public.reply_reminders FOR SELECT
  USING (organization_id IN (
    SELECT organization_id FROM public.organization_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "Service role can manage reply reminders"
  ON public.reply_reminders FOR ALL
  WITH CHECK (true);
