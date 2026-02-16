-- Migration: Make all data org-shared instead of user-scoped
-- 1. Add organization_id to template_folders (the only table missing it)
ALTER TABLE public.template_folders
ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 2. Backfill template_folders
UPDATE public.template_folders tf
SET organization_id = om.organization_id
FROM public.organization_members om
WHERE tf.user_id = om.user_id
  AND tf.organization_id IS NULL;

-- 3. Backfill email_templates
UPDATE public.email_templates et
SET organization_id = om.organization_id
FROM public.organization_members om
WHERE et.user_id = om.user_id
  AND et.organization_id IS NULL;

-- 4. Backfill custom_placeholders
UPDATE public.custom_placeholders cp
SET organization_id = om.organization_id
FROM public.organization_members om
WHERE cp.user_id = om.user_id
  AND cp.organization_id IS NULL;

-- 5. Backfill customers
UPDATE public.customers c
SET organization_id = om.organization_id
FROM public.organization_members om
WHERE c.user_id = om.user_id
  AND c.organization_id IS NULL;

-- 6. Backfill email_logs
UPDATE public.email_logs el
SET organization_id = om.organization_id
FROM public.organization_members om
WHERE el.user_id = om.user_id
  AND el.organization_id IS NULL;

-- 7. Backfill scheduled_sends
UPDATE public.scheduled_sends ss
SET organization_id = om.organization_id
FROM public.organization_members om
WHERE ss.user_id = om.user_id
  AND ss.organization_id IS NULL;
