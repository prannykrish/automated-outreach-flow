-- Revert migration: remove logo-related DB changes but DO NOT delete storage rows
-- (Direct deletion from storage.* tables is blocked; delete bucket/objects via Storage API or dashboard.)

-- Remove reply_to from organization_emails
ALTER TABLE organization_emails DROP COLUMN IF EXISTS reply_to;

-- Remove logo_url from organizations
ALTER TABLE organizations DROP COLUMN IF EXISTS logo_url;

-- Remove related storage policies (if they exist)
DROP POLICY IF EXISTS "Authenticated users can upload org assets" ON storage.objects;
DROP POLICY IF EXISTS "Public read access for org assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can manage org assets" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update org assets" ON storage.objects;

-- NOTE: Do NOT attempt to DELETE FROM storage.objects or storage.buckets in SQL.
-- Supabase prevents direct deletion to avoid orphaned data. Use the Storage API,
-- the Supabase dashboard, or the CLI to remove objects and delete the bucket.
