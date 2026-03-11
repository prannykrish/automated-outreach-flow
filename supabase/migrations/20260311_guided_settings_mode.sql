-- Guided Questions mode for settings: stores conversational answers separately from ICP fields
-- settings_mode controls which view is active; both sets of data are always persisted

alter table company_profiles add column if not exists settings_mode text default 'guided'
  check (settings_mode in ('guided', 'manual'));

-- Guided answers: casual, conversational responses that the system infers ICP from
alter table company_profiles add column if not exists guided_answers jsonb default '{}';
  -- {
  --   what_building: string,      -- "What are you building?"
  --   problem_solved: string,     -- "What problem does it solve?"
  --   who_has_problem: string,    -- "Who do you think might experience this problem?"
  --   online_signals: string,     -- "What would someone say online if they had this problem?"
  --   customer_vibe: string       -- "What kind of vibe or personality do your customers have?"
  -- }

-- Introduction suggestions: for strong prospects without email
alter table agent_prospects add column if not exists introduction_suggestion jsonb;
  -- { via_person: string, via_company: string, relationship: string, reason: string }
