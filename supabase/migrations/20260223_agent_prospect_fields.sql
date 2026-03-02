-- Add new columns to agent_prospects for source provenance and quality tracking

alter table agent_prospects add column if not exists source_url text;
alter table agent_prospects add column if not exists email_source_location text; -- where on the page the email was found
alter table agent_prospects add column if not exists evidence_of_fit text; -- why this person matches the ICP
alter table agent_prospects add column if not exists summary text; -- one-line summary of who they are

-- Add 'rejected' status option for low-quality prospects
alter table agent_prospects drop constraint if exists agent_prospects_status_check;
alter table agent_prospects add constraint agent_prospects_status_check
  check (status in ('discovered', 'enriched', 'drafted', 'approved', 'sent', 'skipped', 'rejected'));
