# Plan: Multi-Agent Research Pipeline Refactor

## What Already Exists (no new work needed)
- **ICP parsing** (`stepParseICP`): Converts user input + company profile into structured ICP
- **Search query generation** (`stepGenerateQueries` + `buildQueryGenPrompt`): Role-aware queries with cumulative source matching
- **Prospect extraction** (`extractProspectsFromPages`): Extracts name/email/company/title/source_url, validates emails exist on page, filters confidence < 0.7
- **Iterative search loop** (`stepIterativeSearch`): Loops until N valid prospects found or budget exhausted
- **Draft storage**: Drafts saved to `agent_email_drafts` with campaign_id, prospect_id, step_number
- **Approval step in UI**: MoraCommandBar shows prospects, drafts, requires user approval
- **Research summaries**: Generated per-prospect (`evidence_of_fit`, `summary` on `agent_prospects`)
- **Activity logging**: `emitAndLog` + `logActivity` persist to `agent_activity_log` (JSONB detail column)

## What Needs to Change

### Task 1: Settings Gate (frontend + backend)
Block campaign if required settings are missing.

**`src/components/MoraCommandBar.tsx`** — `handleSubmit` (~line 166):
- Check `companyProfile` for: `company_description`, `tone`, `target_roles` (non-empty array), `target_industries` (non-empty array)
- If any missing, show inline error: "Please complete your ICP and company settings before running a campaign."
- Auto-expand settings panel

**`supabase/functions/mora-campaign-agent/index.ts`** — after fetching companyProfileRow (~line 1451):
- Server-side validation: if company_description, target_roles, or target_industries are missing/empty, return 400

### Task 2: Refactor Pipeline into Named Agent Steps
Restructure existing functions into clearly labeled sequential agents with dedicated logging.

**`supabase/functions/mora-campaign-agent/index.ts`** — streaming pipeline (~line 1505-1770):

1. **ICP Interpreter Agent** (existing `stepParseICP`):
   - Step label: `"icp_interpreter"`, log structured output (roles, industries, company_type, relevance_signals)
   - Update `buildICPPrompt` JSON schema to include `relevance_signals` and `required_fields`
   - Add rule: "Do not assume Founder/CEO as default roles unless user specified them"

2. **Source Discovery Agent** (existing `stepGenerateQueries`):
   - Step label: `"source_discovery"`, log generated queries with strategy types

3. **Prospect Harvester Agent** (existing `stepIterativeSearch`):
   - Step label: `"prospect_harvester"`
   - Pass `logActivity` into `searchAndScrape` — log each scraped URL with purpose and email count
   - Already enforces: no prospects without email (line 609, 621)

4. **Qualification Agent** (existing dedup + confidence filtering):
   - Add explicit step label: `"qualification"`
   - Log duplicates removed and low-quality rejections count

5. **Research Summary Agent** (existing summaries):
   - Add explicit step label: `"research_summary"`
   - Summaries already in `evidence_of_fit`/`summary`, already saved to `agent_prospects`

6. **Approval** (existing review flow):
   - Step label: `"approval"` instead of `"review"`

### Task 3: Log Research URLs in Activity Log
**`supabase/functions/mora-campaign-agent/index.ts`**:
- `searchAndScrape`: Accept `logActivity` param, after scraping each page call `logActivity("prospect_harvester", "Researched source", { url, title, emails_found: count, purpose: "prospect research" })`
- `extractProspectsFromPages`: After each batch, log which URLs yielded prospects

**`src/components/MoraCommandBar.tsx`** — activity log rendering:
- Detect `detail.url` in activity entries, render as clickable link
- Show purpose from detail

**`src/pages/Insights.tsx`** — Activity Log tab:
- Check `agent_activity_log.detail` for URL, render clickable

### Task 4: Update STEP_LABELS in MoraCommandBar
Replace existing labels with multi-agent names:
```
icp_interpreter → "Interpreting ICP"
source_discovery → "Discovering sources"
prospect_harvester → "Harvesting prospects"
qualification → "Qualifying prospects"
research_summary → "Generating summaries"
drafting → "Drafting emails"
approval → "Ready for approval"
executing → "Sending emails"
```

### Task 5: Build & Type-Check

## Files Modified
1. `supabase/functions/mora-campaign-agent/index.ts` — Settings gate, agent step labels, research URL logging, ICP no-founder-default, function signatures
2. `src/components/MoraCommandBar.tsx` — Settings gate, STEP_LABELS, research URL display in activity
3. `src/pages/Insights.tsx` — Clickable URLs in activity log tab

## No New Migrations
- `agent_activity_log.detail` is already JSONB — stores URLs without schema changes
- `agent_prospects` already has `source_url`, `evidence_of_fit`, `summary`
- `agent_email_drafts` already saved with all required associations
