-- Campaign Agent Refactor: search stats, budget control, email sending integration

-- 1. Add search stats and configurable limits to agent_campaigns
alter table agent_campaigns add column if not exists search_stats jsonb default '{}'::jsonb;
alter table agent_campaigns add column if not exists max_search_queries int default 50;
alter table agent_campaigns add column if not exists max_prospects int default 20;

-- 2. Link email_logs to campaigns for tracking campaign-sent emails
alter table email_logs add column if not exists campaign_id uuid references agent_campaigns(id) on delete set null;

-- 3. Link customers to campaigns that created them
alter table customers add column if not exists campaign_id uuid references agent_campaigns(id) on delete set null;

-- 4. Unique constraint on customers for upsert (email + org)
create unique index if not exists idx_customers_email_org on customers(email, organization_id);
