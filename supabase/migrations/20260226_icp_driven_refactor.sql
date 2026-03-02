-- ICP-Driven Outreach Refactor
-- Adds ICP settings to company_profiles, send/email mode to campaigns,
-- send_at to drafts, and campaign linkage columns to scheduled_sends.

-- 1. ICP settings on company_profiles
alter table company_profiles add column if not exists target_roles text[] default '{}';
alter table company_profiles add column if not exists target_industries text[] default '{}';
alter table company_profiles add column if not exists company_size text default '';
alter table company_profiles add column if not exists company_stage text default '';
alter table company_profiles add column if not exists icp_keywords text[] default '{}';
alter table company_profiles add column if not exists messaging_notes text default '';
alter table company_profiles add column if not exists preferred_sources text[] default '{}';

-- 2. Campaign-level mode columns
alter table agent_campaigns add column if not exists send_mode text default 'immediate';
alter table agent_campaigns add column if not exists email_mode text default 'auto';

-- 3. Computed send timestamp on drafts (visible before approval)
alter table agent_email_drafts add column if not exists send_at timestamptz;

-- 4. Campaign linkage on scheduled_sends (idempotent)
alter table scheduled_sends add column if not exists draft_id uuid references agent_email_drafts(id) on delete set null;
alter table scheduled_sends add column if not exists campaign_id uuid references agent_campaigns(id) on delete set null;
alter table scheduled_sends add column if not exists user_id uuid references auth.users(id) on delete set null;
