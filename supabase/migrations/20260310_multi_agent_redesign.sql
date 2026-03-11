-- Multi-Agent Redesign: problem-first discovery, hypotheses, structured evidence, contact methods
-- Supports prospects without email, multi-source discovery, and hypothesis tracking

-- 1. Problem-first fields on company_profiles (replaces rigid ICP requirement)
alter table company_profiles add column if not exists problem_statement text default '';
alter table company_profiles add column if not exists audience_description text default '';
alter table company_profiles add column if not exists signals text[] default '{}';

-- 2. Campaign-level problem context (so each campaign can override org defaults)
alter table agent_campaigns add column if not exists problem_context jsonb;
  -- { problem: string, audience: string, signals: string[], hypotheses: {...}[] }

-- 3. Hypotheses table: tracks what the system theorized about who has the problem
create table if not exists agent_hypotheses (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references agent_campaigns(id) on delete cascade,
  hypothesis text not null,        -- "SaaS founders struggling with outbound"
  search_queries text[] default '{}', -- queries generated from this hypothesis
  source_type text default 'web',  -- 'web', 'twitter', 'hackernews', 'producthunt', 'reddit'
  prospects_found int default 0,
  quality_score numeric(3,2),      -- how good were the prospects from this hypothesis
  status text default 'pending'
    check (status in ('pending', 'searching', 'completed', 'failed')),
  created_at timestamptz not null default now()
);

create index if not exists idx_agent_hypotheses_campaign on agent_hypotheses(campaign_id);

alter table agent_hypotheses enable row level security;
create policy "Users can manage hypotheses in their org campaigns"
  on agent_hypotheses for all
  using (campaign_id in (
    select id from agent_campaigns where organization_id in (
      select organization_id from organization_members where user_id = auth.uid()
    )
  ));

-- 4. New columns on agent_prospects for multi-channel contact and structured evidence
alter table agent_prospects add column if not exists contact_methods jsonb default '{}';
  -- { email?: string, linkedin?: string, twitter?: string, website?: string }
alter table agent_prospects add column if not exists intent_signals jsonb default '[]';
  -- [{ type: "post"|"comment"|"launch"|"hiring"|"blog", text: string, source_url: string, date?: string }]
alter table agent_prospects add column if not exists evidence_chain jsonb default '[]';
  -- [{ signal: string, source: string, url: string, relevance: string }]
alter table agent_prospects add column if not exists hypothesis_id uuid references agent_hypotheses(id) on delete set null;
alter table agent_prospects add column if not exists discovery_source text default 'web';
  -- 'web', 'twitter', 'hackernews', 'producthunt', 'reddit'

-- 5. Allow 'no_email' status for prospects surfaced without email
-- Drop the old check constraint and add expanded one
alter table agent_prospects drop constraint if exists agent_prospects_status_check;
alter table agent_prospects add constraint agent_prospects_status_check
  check (status in ('discovered', 'enriched', 'drafted', 'approved', 'sent', 'skipped', 'rejected', 'no_email'));

-- 6. Add delay_days column to agent_email_drafts if not exists
alter table agent_email_drafts add column if not exists delay_days int default 0;

-- 7. Add scheduled_for to agent_email_drafts if not exists (alias for send_at migration safety)
-- send_at already exists from 20260226_icp_driven_refactor.sql, so we just ensure it
-- No action needed, send_at already present
