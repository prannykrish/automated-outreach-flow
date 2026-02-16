-- Make email_logs persist when customers or templates are deleted.
-- This ensures analytics/stats remain available historically.

-- Add columns to preserve identity after customer deletion
ALTER TABLE public.email_logs
ADD COLUMN IF NOT EXISTS customer_email TEXT,
ADD COLUMN IF NOT EXISTS customer_name TEXT;

-- Change customer_id FK from CASCADE to SET NULL
ALTER TABLE public.email_logs ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE public.email_logs DROP CONSTRAINT IF EXISTS email_logs_customer_id_fkey;
ALTER TABLE public.email_logs
ADD CONSTRAINT email_logs_customer_id_fkey
  FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;

-- Change template_id FK from CASCADE to SET NULL
ALTER TABLE public.email_logs ALTER COLUMN template_id DROP NOT NULL;
ALTER TABLE public.email_logs DROP CONSTRAINT IF EXISTS email_logs_template_id_fkey;
ALTER TABLE public.email_logs
ADD CONSTRAINT email_logs_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES public.email_templates(id) ON DELETE SET NULL;

-- Backfill customer_email/customer_name for existing logs
UPDATE public.email_logs el
SET customer_email = c.email,
    customer_name = c.first_name || COALESCE(' ' || c.last_name, '')
FROM public.customers c
WHERE el.customer_id = c.id
  AND el.customer_email IS NULL;
