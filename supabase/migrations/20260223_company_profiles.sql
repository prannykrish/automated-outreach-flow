-- Company profile for AI-generated email context
-- Stored per organization so the agent knows what the company does

create table if not exists company_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  company_description text not null default '',
  problem_solved text not null default '',
  tone text not null default 'professional',
  key_message text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id)
);

-- RLS
alter table company_profiles enable row level security;

create policy "Users can manage their org company profile"
  on company_profiles for all
  using (organization_id in (
    select organization_id from organization_members where user_id = auth.uid()
  ));
