// @ts-nocheck

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

declare const Deno: any;

const AWS_ACCESS_KEY_ID = Deno.env.get("AWS_ACCESS_KEY_ID");
const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const AWS_REGION = Deno.env.get("AWS_REGION") || "us-east-1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const BEDROCK_MODEL_ID = Deno.env.get("BEDROCK_MODEL_ID") || "us.anthropic.claude-opus-4-6-v1";
const SERP_API_KEY = Deno.env.get("SERP_API_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

const aws = new AwsClient({
  accessKeyId: AWS_ACCESS_KEY_ID,
  secretAccessKey: AWS_SECRET_ACCESS_KEY,
  region: AWS_REGION,
  service: "bedrock",
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

// ── Bedrock helper ──

async function invokeBedrockJSON(systemPrompt: string, userMessage: string, maxTokens = 4096): Promise<any> {
  const url = `https://bedrock-runtime.${AWS_REGION}.amazonaws.com/model/${encodeURIComponent(BEDROCK_MODEL_ID)}/invoke`;

  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const response = await aws.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bedrock API error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const text = result.content?.find((b: any) => b.type === "text")?.text || "";

  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, text];
  try {
    return JSON.parse(jsonMatch[1].trim());
  } catch {
    throw new Error(`LLM returned invalid JSON: ${text.slice(0, 500)}`);
  }
}

// ── SSE helper ──

function sseEvent(data: any): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ── Page scraping helper ──

async function fetchPageContent(url: string): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MoraBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timeout);

    if (!res.ok) return "";

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return "";

    let html = await res.text();

    html = html.replace(/<script[\s\S]*?<\/script>/gi, " ");
    html = html.replace(/<style[\s\S]*?<\/style>/gi, " ");
    html = html.replace(/<nav[\s\S]*?<\/nav>/gi, " ");
    html = html.replace(/<footer[\s\S]*?<\/footer>/gi, " ");
    html = html.replace(/<[^>]+>/g, " ");
    html = html.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
    return html.replace(/\s+/g, " ").trim().slice(0, 15000);
  } catch {
    return "";
  }
}

// ── Email extraction from page content ──

function extractEmailsFromText(text: string): string[] {
  const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  const matches = text.match(emailRegex) || [];
  const blacklist = ["example.com", "test.com", "email.com", "domain.com", "yourcompany.com", "company.com", "sentry.io", "wixpress.com", "w3.org", "schema.org", "googleapis.com", "cloudflare.com"];
  return [...new Set(matches)].filter((e) => {
    const domain = e.split("@")[1].toLowerCase();
    return !blacklist.some((b) => domain.includes(b));
  });
}

// ── Company profile + ICP types ──

interface CompanyProfile {
  company_description: string;
  problem_solved: string;
  tone: string;
  key_message: string;
  target_roles: string[];
  target_industries: string[];
  company_size: string;
  company_stage: string;
  icp_keywords: string[];
  preferred_sources: string[];
  messaging_notes: string;
}

interface ICPSettings {
  target_roles: string[];
  target_industries: string[];
  company_size: string;
  company_stage: string;
  icp_keywords: string[];
  preferred_sources: string[];
  messaging_notes: string;
}

function extractICPSettings(profile: CompanyProfile | null): ICPSettings | null {
  if (!profile) return null;
  return {
    target_roles: profile.target_roles || [],
    target_industries: profile.target_industries || [],
    company_size: profile.company_size || "",
    company_stage: profile.company_stage || "",
    icp_keywords: profile.icp_keywords || [],
    preferred_sources: profile.preferred_sources || [],
    messaging_notes: profile.messaging_notes || "",
  };
}

interface ScrapedPage {
  url: string;
  title: string;
  snippet: string;
  content: string;
  emails_found: string[];
}

interface ExtractedProspect {
  name: string;
  email: string;
  email_source_location: string;
  company: string;
  title: string;
  source_url: string;
  evidence_of_fit: string;
  summary: string;
  confidence_score: number;
  linkedin_url: string | null;
}

// ── Step 1: ICP Parsing & Planning ──

function buildICPPrompt(companyProfile: CompanyProfile | null): string {
  let system = `You are a campaign planning AI for cold email outreach. Given the user's request, extract a structured Ideal Customer Profile (ICP) and campaign plan.

You MUST respond with ONLY valid JSON (no explanation, no markdown) in this exact format:
{
  "icp": {
    "roles": ["CEO", "Founder", "VP Sales"],
    "industries": ["SaaS", "B2B Tech"],
    "company_size": "10-200 employees",
    "geography": "US",
    "other_criteria": "Series A or later"
  },
  "desired_person_count": 20,
  "campaign_structure": {
    "sequence_length": 3,
    "tone": "${companyProfile?.tone || "professional"}",
    "key_value_prop": "${companyProfile?.key_message || ""}"
  },
  "relevance_signals": ["recently raised funding", "hiring for engineering roles"],
  "required_fields": ["email", "name", "company", "role"],
  "personalization_fields": ["company_name", "role", "recent_news", "company_product"]
}

Rules:
- Extract SPECIFIC roles, industries, company sizes from the user's request
- If the user mentions a number of prospects, use that as desired_person_count (default 20, max 50)
- If the user's request is vague or too broad, set "needs_clarification": true and "clarification_question": "your question"
- NEVER make up criteria the user didn't mention — only extract what's explicitly stated or clearly implied
- Do NOT assume "Founder" or "CEO" as default roles. Only include roles the user explicitly specified or that appear in the organization's saved ICP settings.
- If the organization has ICP settings defined (below), use them as defaults/fallbacks for any criteria the user doesn't specify
- Include "relevance_signals" in the ICP: specific signals that indicate a prospect matches (e.g. "recently raised funding", "hiring for X role", "published about Y topic")
- Include "required_fields" listing which data points are mandatory for a valid prospect (always include "email")`;

  if (companyProfile) {
    system += `\n\nThe user's company context (use this for email tone and value prop):
- What the company does: ${companyProfile.company_description}
- Problem it solves: ${companyProfile.problem_solved}
- Preferred tone: ${companyProfile.tone}
- Key message: ${companyProfile.key_message}`;

    // Include ICP settings as defaults
    const hasICP = companyProfile.target_roles?.length || companyProfile.target_industries?.length || companyProfile.company_size;
    if (hasICP) {
      system += `\n\nOrganization's saved ICP settings (use as defaults when user doesn't specify):`;
      if (companyProfile.target_roles?.length) system += `\n- Target roles: ${companyProfile.target_roles.join(", ")}`;
      if (companyProfile.target_industries?.length) system += `\n- Target industries: ${companyProfile.target_industries.join(", ")}`;
      if (companyProfile.company_size) system += `\n- Company size: ${companyProfile.company_size}`;
      if (companyProfile.company_stage) system += `\n- Company stage: ${companyProfile.company_stage}`;
      if (companyProfile.icp_keywords?.length) system += `\n- Keywords: ${companyProfile.icp_keywords.join(", ")}`;
      if (companyProfile.messaging_notes) system += `\n- Messaging notes: ${companyProfile.messaging_notes}`;
    }
  }

  return system;
}

async function stepParseICP(userPrompt: string, sequenceData: any | null, orgContext: any, companyProfile: CompanyProfile | null): Promise<any> {
  let contextStr = `User's request: ${userPrompt}

Organization context:
- ${orgContext.customerCount} existing customers
- ${orgContext.sequenceCount} sequences available
- ${orgContext.templateCount} email templates`;

  if (sequenceData) {
    contextStr += `\n\nUser selected an existing sequence to use as blueprint:
Sequence: "${sequenceData.name}"
Steps:
${sequenceData.steps.map((s: any, i: number) => `  Step ${i + 1}: Subject: "${s.subject}" | Body preview: "${s.body?.slice(0, 150)}..."`).join("\n")}`;
  }

  return await invokeBedrockJSON(buildICPPrompt(companyProfile), contextStr);
}

// ── Step 2: Search Query Generation (ICP-driven, dynamic sources) ──

function buildQueryGenPrompt(icpSettings: ICPSettings | null): string {
  let system = `You are a search query specialist. Given an ICP (Ideal Customer Profile), generate targeted Google search queries that will find REAL people matching the criteria WITH their email addresses visible on the page.

You MUST respond with ONLY valid JSON (no explanation, no markdown):
{
  "queries": [
    "query one here",
    "query two here"
  ]
}

Rules:
- Generate 6-10 highly targeted queries
- At LEAST half your queries MUST include terms like "email", "contact", "@", "get in touch"
- Each query should target a different angle to maximize unique results with emails
- DO NOT generate generic queries — every query should reflect the specific ICP criteria
- Target pages that list people WITH contact info: team pages, directories, association listings, speaker lists, staff pages

SOURCE PRIORITY — choose sources that match the target ICP:`;

  // Dynamic source selection based on ICP roles/industries
  // Uses CUMULATIVE matching — all matching role buckets contribute sources
  const roles = icpSettings?.target_roles || [];
  const industries = icpSettings?.target_industries || [];
  const rolesLower = roles.map(r => r.toLowerCase());
  const industriesLower = industries.map(i => i.toLowerCase());

  const isFounder = rolesLower.some(r => ["founder", "ceo", "cofounder", "co-founder", "startup founder"].includes(r));
  const isAccountant = rolesLower.some(r => ["accountant", "cpa", "bookkeeper", "tax preparer", "auditor"].includes(r));
  const isDoctor = rolesLower.some(r => ["doctor", "physician", "surgeon", "dentist", "therapist", "psychiatrist", "md", "do"].includes(r));
  const isLawyer = rolesLower.some(r => ["lawyer", "attorney", "partner", "legal counsel", "solicitor", "barrister"].includes(r));
  const isRealEstate = rolesLower.some(r => ["realtor", "real estate agent", "broker", "property manager"].includes(r));
  const isFinance = rolesLower.some(r => ["financial advisor", "wealth manager", "financial planner", "cfo"].includes(r));
  const isMarketing = rolesLower.some(r => ["marketing director", "cmo", "head of marketing", "vp marketing", "marketing manager"].includes(r));
  const isSales = rolesLower.some(r => ["vp sales", "head of sales", "sales director", "account executive", "sdr"].includes(r));

  let hasRoleMatch = false;

  if (isFounder) {
    hasRoleMatch = true;
    system += `

FOR FOUNDERS/CEOs:
- Startup roundups and "startups to watch" articles with founder bios
- Accelerator and incubator cohort/batch directories
- Company team/about pages with founder contact info
- Founder blogs and Substack posts with author bios and emails
- Conference speaker lists with bios
- Podcast guest lists and interviews with contact links
- Newsletter features and curated startup lists`;
  }
  if (isAccountant) {
    hasRoleMatch = true;
    system += `

FOR ACCOUNTANTS/CPAs:
- Accounting firm directories and "top firms" articles
- CPA association member directories (AICPA, state CPA societies)
- Firm team/staff pages with partner emails
- Accounting industry publications and author bios
- "Best accounting firms" and "top CPAs" roundup articles
- Local business directories with accounting firm listings`;
  }
  if (isDoctor) {
    hasRoleMatch = true;
    system += `

FOR DOCTORS/PHYSICIANS:
- Clinic and practice directories
- Hospital staff/physician directory pages
- Medical association member listings
- "Top doctors" and "best physicians" articles
- Health system provider search pages
- Medical conference speaker lists
- Practice/clinic team pages with contact info`;
  }
  if (isLawyer) {
    hasRoleMatch = true;
    system += `

FOR LAWYERS/ATTORNEYS:
- Law firm directories and team pages
- Bar association member listings and attorney search tools
- "Top lawyers" and "best law firms" articles
- Legal industry publications and author bios
- Super Lawyers / Martindale-Hubbell / Avvo directory listings
- Practice area specialist directories`;
  }
  if (isRealEstate) {
    hasRoleMatch = true;
    system += `

FOR REAL ESTATE:
- Real estate brokerage team pages
- Realtor association directories
- "Top agents" roundup articles
- Real estate industry event speaker lists
- Local MLS agent directories`;
  }
  if (isFinance) {
    hasRoleMatch = true;
    system += `

FOR FINANCE/ADVISORS:
- Financial advisory firm team pages
- CFP Board / FINRA advisor lookup directories
- "Top financial advisors" articles
- Wealth management firm directories
- Financial planning association listings`;
  }
  if (isMarketing || isSales) {
    hasRoleMatch = true;
    system += `

FOR MARKETING/SALES LEADERS:
- Company leadership/team pages
- Marketing/Sales conference speaker lists
- Industry publication contributor bios
- "Top CMOs" / "Sales leaders" roundup articles
- SaaS company about pages with leadership emails
- Podcast guest lists for marketing/sales podcasts`;
  }

  if (!hasRoleMatch) {
    system += `

FOR THIS ICP:
- Industry-specific directories and association member listings
- Company team/about pages with contact info
- Industry conference speaker directories
- Professional association listings
- "Top [role]" and "[industry] leaders" roundup articles
- Company staff pages with visible emails
- Industry publication author/contributor bios`;
  }

  // Universal high-quality source categories for ALL roles
  system += `

UNIVERSAL HIGH-VALUE SOURCES (use for any ICP):
- Blog posts and newsletters that list or feature multiple people (Substack roundups, curated lists, "people to follow" posts)
- Industry-specific resource pages and curated directories
- Conference and event speaker pages with bios and contact info
- "Top X in [industry/city/role]" roundup articles
- Podcast guest pages with bios and contact links
- Award winners and recognition lists (e.g., "40 under 40", "rising stars in [field]")
- GitHub profile pages with visible emails (for technical roles)
- University faculty/alumni directories (for academic or research roles)
- Community and forum member pages with profiles

PRIORITIZE pages that:
- List MULTIPLE people with names, roles, and visible email addresses
- Are curated directories, roundups, or association listings
- Have structured contact information (not just social media links)
- Feature recent, active professionals (not outdated pages)

Prioritize curated lists, roundups, and directory pages far more than individual company websites. A single "top 50 founders in [city]" article is worth more than 50 individual company homepages.

DEPRIORITIZE:
- Homepages without specific contact info
- Pages with only social media links (LinkedIn, Twitter)
- Unstructured blog content without author contact info
- Pages behind login walls
- Generic company landing pages`;

  if (icpSettings?.preferred_sources?.length) {
    system += `\n\nThe user has specified preferred source types: ${icpSettings.preferred_sources.join(", ")}. Prioritize these.`;
  }

  if (icpSettings?.icp_keywords?.length) {
    system += `\n\nInclude these problem/industry keywords in your queries: ${icpSettings.icp_keywords.join(", ")}`;
  }

  return system;
}

async function stepGenerateQueries(icp: any, icpSettings: ICPSettings | null, existingProspects?: ExtractedProspect[]): Promise<string[]> {
  const system = buildQueryGenPrompt(icpSettings);
  let message = `Generate search queries for this ICP:\n${JSON.stringify(icp, null, 2)}`;

  if (icpSettings) {
    message += `\n\nOrganization's ICP settings:
- Target roles: ${icpSettings.target_roles.length ? icpSettings.target_roles.join(", ") : "Any"}
- Target industries: ${icpSettings.target_industries.length ? icpSettings.target_industries.join(", ") : "Any"}
- Company size: ${icpSettings.company_size || "Any"}
- Company stage: ${icpSettings.company_stage || "Any"}
- Keywords: ${icpSettings.icp_keywords.length ? icpSettings.icp_keywords.join(", ") : "None"}`;
  }

  if (existingProspects && existingProspects.length > 0) {
    message += `\n\nI already found these prospects — generate DIFFERENT queries to find MORE people (avoid duplicate companies/domains):\n`;
    message += existingProspects.slice(0, 10).map(p => `- ${p.name} at ${p.company}`).join("\n");
  }

  const result = await invokeBedrockJSON(system, message);
  return result.queries || [];
}

// ── Step 3: Iterative Search — batched SerpAPI + scraping + extraction ──

function buildExtractionPrompt(icpSettings: ICPSettings | null): string {
  let system = `You are a prospect extraction AI. Given scraped web page content and a target ICP, extract REAL people from the page.

CRITICAL RULES — FOLLOW EXACTLY:
1. ONLY extract people whose information is ACTUALLY on the page. NEVER invent or hallucinate names, emails, companies, or titles.
2. For email: ONLY include an email if it literally appears in the page content or in the emails_found_on_page list. If no email is visible, set email to null.
3. ONLY RETURN PROSPECTS WHO HAVE AN EMAIL ADDRESS. Skip anyone without a visible email — they are useless for outreach.
4. Look carefully at the emails_found_on_page list — match each email to a person mentioned on the page (e.g. john@ likely belongs to "John Smith" on the same page).
5. For each person, provide evidence_of_fit: a direct quote or paraphrase from the page proving they match the ICP.
6. Set confidence_score based on how much real data you found:
   - 0.9+: Name, email, company, title all found on page, strong ICP match
   - 0.7-0.9: Name + company + email found, decent ICP match
   - Below 0.7: Don't include — not enough data
7. For the summary field, include: who they are, what they do, why they match the ICP, and the page where they were found.`;

  if (icpSettings) {
    const hasRoles = icpSettings.target_roles.length > 0;
    const hasIndustries = icpSettings.target_industries.length > 0;
    system += `\n\nTARGET ICP SETTINGS:`;
    if (hasRoles) system += `\n- Target roles: ${icpSettings.target_roles.join(", ")}. Prioritize people in these roles.`;
    if (hasIndustries) system += `\n- Target industries: ${icpSettings.target_industries.join(", ")}. Prioritize people in these industries.`;
    if (icpSettings.company_size) system += `\n- Company size: ${icpSettings.company_size}`;
    if (icpSettings.company_stage) system += `\n- Company stage: ${icpSettings.company_stage}`;
    if (icpSettings.icp_keywords.length) system += `\n- Keywords: ${icpSettings.icp_keywords.join(", ")}`;
  }

  system += `

You MUST respond with ONLY valid JSON:
{
  "prospects": [
    {
      "name": "John Smith",
      "email": "john@company.com",
      "email_source_location": "Found in team page contact section",
      "company": "TechCorp",
      "title": "CEO",
      "source_url": "https://techcorp.com/team",
      "evidence_of_fit": "Listed as CEO of TechCorp, a B2B SaaS company with 50 employees",
      "summary": "John Smith is CEO of TechCorp, a B2B SaaS company. Matches ICP as a SaaS founder. Found on the TechCorp team page.",
      "confidence_score": 0.92
    }
  ]
}

If the page has NO relevant prospects WITH email addresses, return: { "prospects": [] }
NEVER return a prospect without an email address.`;

  return system;
}

async function searchAndScrape(
  queries: string[],
  seenUrls: Set<string>,
  emit: (data: any) => void,
  logActivity?: (step: string, message: string, detail?: any) => void,
  maxPagesPerDomain: number = 3
): Promise<ScrapedPage[]> {
  const allPages: ScrapedPage[] = [];
  const domainPageCount = new Map<string, number>();

  for (const query of queries) {
    try {
      emit({ type: "status", text: `Searching: "${query}"` });

      const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERP_API_KEY}&num=10`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();

      const results = (data.organic_results || []).slice(0, 6);

      // Scrape pages in parallel (batch of 4)
      for (let i = 0; i < results.length; i += 4) {
        const batch = results.slice(i, i + 4);
        const scrapedBatch = await Promise.all(
          batch.map(async (result: any) => {
            const pageUrl = result.link || "";
            if (seenUrls.has(pageUrl)) return null;
            seenUrls.add(pageUrl);

            if (/\.(pdf|jpg|png|gif|mp4|zip)$/i.test(pageUrl)) return null;

            // Domain-level page cap
            try {
              const domain = new URL(pageUrl).hostname;
              const count = domainPageCount.get(domain) || 0;
              if (count >= maxPagesPerDomain) return null;
              domainPageCount.set(domain, count + 1);
            } catch { /* invalid URL, skip cap */ }

            const content = await fetchPageContent(pageUrl);
            const emails = extractEmailsFromText(content);

            return {
              url: pageUrl,
              title: result.title || "",
              snippet: result.snippet || "",
              content: content.slice(0, 10000),
              emails_found: emails,
            } as ScrapedPage;
          })
        );

        for (const page of scrapedBatch) {
          if (page && (page.content.length > 100 || page.emails_found.length > 0)) {
            allPages.push(page);
            // Log each researched source URL
            if (logActivity) {
              logActivity("prospect_harvester", `Researched: ${page.title || page.url}`, {
                url: page.url,
                title: page.title,
                emails_found: page.emails_found.length,
                purpose: page.emails_found.length > 0 ? "email discovery" : "company research",
              });
            }
          }
        }
      }

      // Rate limit between SerpAPI calls
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.error("Search error:", err);
    }
  }

  return allPages;
}

async function extractProspectsFromPages(
  pages: ScrapedPage[],
  icp: any,
  icpSettings: ICPSettings | null,
  seenEmails: Set<string>,
  seenNames: Set<string>,
  emit: (data: any) => void
): Promise<ExtractedProspect[]> {
  const extracted: ExtractedProspect[] = [];
  const extractionSystem = buildExtractionPrompt(icpSettings);

  // Prioritize pages that have emails
  const pagesWithEmails = pages.filter((p) => p.emails_found.length > 0);
  const pagesWithoutEmails = pages.filter((p) => p.emails_found.length === 0);
  const sortedPages = [...pagesWithEmails, ...pagesWithoutEmails];

  const batchSize = 3;
  for (let i = 0; i < sortedPages.length; i += batchSize) {
    const batch = sortedPages.slice(i, i + batchSize);

    const batchInput = batch.map((page) => ({
      url: page.url,
      title: page.title,
      snippet: page.snippet,
      emails_found_on_page: page.emails_found,
      page_content: page.content.slice(0, 5000),
    }));

    try {
      const result = await invokeBedrockJSON(
        extractionSystem,
        `ICP criteria:\n${JSON.stringify(icp, null, 2)}\n\nPages to analyze:\n${JSON.stringify(batchInput, null, 2)}`,
        8192
      );

      for (const p of result.prospects || []) {
        if (!p.name || !p.company || !p.email) continue;

        const emailKey = p.email.toLowerCase();
        const nameKey = p.name.toLowerCase();
        if (seenEmails.has(emailKey) || seenNames.has(nameKey)) continue;

        // Validate email was actually found on the page
        const sourcePage = batch.find((pg) => pg.url === p.source_url) || batch[0];
        const emailFoundOnPage = sourcePage.emails_found.some(
          (e) => e.toLowerCase() === p.email.toLowerCase()
        ) || sourcePage.content.toLowerCase().includes(p.email.toLowerCase());

        if (!emailFoundOnPage) continue; // Skip hallucinated emails

        seenEmails.add(emailKey);
        seenNames.add(nameKey);

        const linkedinUrl = p.source_url?.includes("linkedin.com/in/") ? p.source_url : null;

        extracted.push({
          name: p.name,
          email: p.email,
          email_source_location: p.email_source_location || "Found on page",
          company: p.company,
          title: p.title || "",
          source_url: p.source_url || batch[0]?.url || "",
          evidence_of_fit: p.evidence_of_fit || "",
          summary: p.summary || `${p.title || ""} at ${p.company}`,
          confidence_score: p.confidence_score || 0.7,
          linkedin_url: linkedinUrl,
        });
      }
    } catch (err) {
      console.error("Extraction batch error:", err);
    }
  }

  return extracted;
}

// Iterative search: keeps searching in batches until enough prospects found or budget exhausted
// Has a wall-clock guard to stop gracefully before Supabase edge function timeout (~150s)
const SEARCH_WALL_CLOCK_MS = 55_000; // 55 seconds — leaves ~95s for drafting + DB writes

async function stepIterativeSearch(
  icp: any,
  icpSettings: ICPSettings | null,
  desiredCount: number,
  maxSearchQueries: number,
  emit: (data: any) => void,
  supabase: any,
  campaignId: string,
  excludedEmails: Set<string> = new Set(),
  logActivity?: (step: string, message: string, detail?: any) => void
): Promise<{ prospects: ExtractedProspect[]; stats: { queriesUsed: number; pagesScraped: number; stoppedReason: string } }> {
  if (!SERP_API_KEY) {
    emit({ type: "status", text: "No SERP_API_KEY configured — cannot perform research." });
    return { prospects: [], stats: { queriesUsed: 0, pagesScraped: 0, stoppedReason: "no_api_key" } };
  }

  const searchStartTime = Date.now();
  const validProspects: ExtractedProspect[] = [];
  // Pre-populate seenEmails with emails from previous campaigns to avoid duplicates
  const seenEmails = new Set<string>(excludedEmails);
  const seenNames = new Set<string>();
  const seenUrls = new Set<string>();
  let queriesUsed = 0;
  let totalPagesScraped = 0;

  // Generate initial batch of queries
  emit({ type: "status", text: `Generating targeted search queries to find ${desiredCount} prospects with emails...` });
  let allQueries = await stepGenerateQueries(icp, icpSettings);
  if (logActivity) {
    logActivity("source_discovery", `Generated ${allQueries.length} search strategies`, { queries: allQueries });
  }
  let queryIndex = 0;
  const BATCH_SIZE = 3;

  while (validProspects.length < desiredCount && queriesUsed < maxSearchQueries) {
    // Wall-clock guard: stop gracefully if running too long
    if (Date.now() - searchStartTime > SEARCH_WALL_CLOCK_MS) {
      emit({ type: "status", text: `Stopping search — time limit reached. Found ${validProspects.length} prospects so far.` });
      break;
    }
    // Take next batch of queries
    let queryBatch = allQueries.slice(queryIndex, queryIndex + BATCH_SIZE);

    // If we've used all queries and need more, generate additional ones
    if (queryBatch.length === 0) {
      emit({ type: "status", text: "Generating additional search queries..." });
      const moreQueries = await stepGenerateQueries(icp, icpSettings, validProspects);
      allQueries.push(...moreQueries);
      queryBatch = allQueries.slice(queryIndex, queryIndex + BATCH_SIZE);
      if (queryBatch.length === 0) break; // LLM couldn't generate more
    }

    queryIndex += queryBatch.length;

    // Search + scrape this batch
    const batchPages = await searchAndScrape(queryBatch, seenUrls, emit, logActivity);
    queriesUsed += queryBatch.length;
    totalPagesScraped += batchPages.length;

    // Extract prospects from batch
    if (batchPages.length > 0) {
      emit({ type: "status", text: `Analyzing ${batchPages.length} pages for prospects...` });
      const batchProspects = await extractProspectsFromPages(batchPages, icp, icpSettings, seenEmails, seenNames, emit);
      validProspects.push(...batchProspects);
    }

    // Emit progress
    emit({
      type: "search_stats",
      stats: {
        queriesUsed,
        pagesScraped: totalPagesScraped,
        prospectsFound: validProspects.length,
        targetCount: desiredCount,
      },
    });

    emit({
      type: "status",
      text: `${queriesUsed} searches used. Found ${validProspects.length} of ${desiredCount} prospects so far.`,
    });
  }

  const timedOut = Date.now() - searchStartTime > SEARCH_WALL_CLOCK_MS;
  const stoppedReason = validProspects.length >= desiredCount
    ? "target_reached"
    : timedOut
      ? "time_limit"
      : "budget_exhausted";

  // Store search stats
  await supabase.from("agent_campaigns").update({
    search_stats: {
      queries_used: queriesUsed,
      pages_scraped: totalPagesScraped,
      prospects_found: validProspects.length,
      stopped_reason: stoppedReason,
    },
  }).eq("id", campaignId);

  // Emit final stats
  emit({
    type: "search_stats",
    stats: {
      queriesUsed,
      pagesScraped: totalPagesScraped,
      prospectsFound: validProspects.length,
      targetCount: desiredCount,
      stoppedReason,
    },
  });

  if (stoppedReason === "budget_exhausted" && validProspects.length < desiredCount) {
    emit({
      type: "status",
      text: `Found ${validProspects.length} of ${desiredCount} requested prospects after ${queriesUsed} searches. Search budget reached.`,
    });
  }

  return { prospects: validProspects, stats: { queriesUsed, pagesScraped: totalPagesScraped, stoppedReason } };
}

// ── Step 4: Email Drafting ──

function buildDraftingPrompt(companyProfile: CompanyProfile | null, plan: any): string {
  let system = `You are an email copywriter for personalized cold outreach. Generate email drafts for each prospect.

CRITICAL RULES — FOLLOW EXACTLY:
- Write like a real human. Short, direct, no fluff, no marketing speak.
- 3-5 sentences max per email body.
- Subject line should feel like it came from a real person (not salesy, no caps, no exclamation marks).
- Use the prospect's evidence_of_fit and summary to personalize the opening.
- One clear CTA per email.
- For follow-ups (step 2+), add new value or a different angle. NEVER "just bumping this" or "following up."
- NEVER use placeholders like {{first_name}}, {{company}}, [Name], [Company], {insert name here}, [Insert X], {Name}, etc.
- NEVER use brackets [] or curly braces {} around any name, company, or variable. These are NOT templates.
- Each email is for a SPECIFIC person — use their ACTUAL name, company, and title directly in the text.
- Address them by their first name directly (e.g. "Hi Josh," not "Hi {{first_name}},").
- These are fully personalized, ready-to-send drafts. No placeholders, no merge tags, no template variables whatsoever.
- If you don't know a detail, omit it entirely rather than using a placeholder.

PERSONALIZATION & QUALITY RULES:
- The opening line MUST reference something specific from the prospect's evidence_of_fit or summary — a recent achievement, company milestone, blog post, or role-specific detail. Generic openers like "I came across your profile" or "I noticed your company" are banned.
- The second sentence must clearly state what specific outcome the sender's product/service delivers. Use concrete numbers or results when possible. Never say "we help companies grow" — say what specifically changes.
- Write like a peer reaching out, not a salesperson. Use casual contractions (I'm, you're, we'd). No corporate buzzwords (leverage, synergy, optimize, cutting-edge, innovative, game-changing, revolutionize, empower, seamless). No exclamation marks.
- NEVER use em dashes (—) or en dashes (–) in any email. Use commas, periods, or semicolons instead.
- Each follow-up must provide genuinely new information — a case study, a relevant stat, a new angle on why this matters to them specifically. Never reference the previous email ("as I mentioned", "per my last email", "just following up on my last note"). Write each follow-up as if it could stand alone.

`;

  // Company context
  if (companyProfile && companyProfile.company_description) {
    system += `ABOUT THE SENDER'S COMPANY (use this for all emails):
- What we do: ${companyProfile.company_description}
- Problem we solve: ${companyProfile.problem_solved}
- Key message: ${companyProfile.key_message}
- Tone: ${companyProfile.tone}
${companyProfile.messaging_notes ? `- Messaging notes: ${companyProfile.messaging_notes}` : ""}

IMPORTANT: Use this company info accurately. Do NOT make up features or benefits not listed above.
`;
  }

  // Template mode is handled separately via direct replacement — this prompt is only for auto mode
  system += `\nEMAIL MODE: AUTO-GENERATED
Write original personalized emails from scratch using:
- The prospect's research summary and evidence_of_fit for personalization
- The sender's company description and value proposition for the pitch
- Tone preference: ${companyProfile?.tone || plan.campaign_structure?.tone || "professional"}

ABSOLUTE REQUIREMENTS:
- Always use the prospect's real first name. NEVER "Hi [First Name]" or any placeholder.
- No em dashes (—) or en dashes (–). Use commas, periods, or semicolons.
- No generic marketing language. No "I hope this finds you well", "reaching out because", "I'd love to connect".
- Write like a real human sending a real email. Natural, direct, conversational.
`;

  system += `
You MUST respond with ONLY valid JSON (no explanation, no markdown):
[
  {
    "prospect_index": 0,
    "step_number": 1,
    "subject": "Subject line here",
    "body": "Email body here"
  }
]`;

  return system;
}

// Template mode: direct placeholder replacement, no LLM rewriting
function stepDraftTemplate(
  prospects: ExtractedProspect[],
  sequenceData: any
): any[] {
  const allDrafts: any[] = [];
  for (let i = 0; i < prospects.length; i++) {
    const p = prospects[i];
    const firstName = p.name.split(" ")[0];
    const lastName = p.name.split(" ").slice(1).join(" ");
    for (const step of sequenceData.steps) {
      let subject = step.subject || "";
      let body = step.body || "";
      // Replace standard placeholders — use the template word for word otherwise
      const replacements: [RegExp, string][] = [
        [/\[First Name\]/gi, firstName],
        [/\[Last Name\]/gi, lastName],
        [/\[Full Name\]/gi, p.name],
        [/\[Name\]/gi, firstName],
        [/\[Company\]/gi, p.company || ""],
        [/\[Firm Name\]/gi, p.company || ""],
        [/\[Title\]/gi, p.title || ""],
        [/\[Role\]/gi, p.title || ""],
        [/\{\{first_name\}\}/gi, firstName],
        [/\{\{last_name\}\}/gi, lastName],
        [/\{\{name\}\}/gi, p.name],
        [/\{\{company\}\}/gi, p.company || ""],
        [/\{\{title\}\}/gi, p.title || ""],
      ];
      for (const [pattern, value] of replacements) {
        subject = subject.replace(pattern, value);
        body = body.replace(pattern, value);
      }
      allDrafts.push({
        prospect_index: i,
        step_number: step.step_order + 1,
        subject,
        body,
      });
    }
  }
  return allDrafts;
}

// Auto-generate mode: LLM writes original personalized emails from scratch
async function stepDraftAuto(
  prospects: ExtractedProspect[],
  companyProfile: CompanyProfile | null,
  plan: any
): Promise<any[]> {
  const sequenceLength = plan.campaign_structure?.sequence_length || 3;
  const system = buildDraftingPrompt(companyProfile, plan);

  const batchSize = 5;
  const allDrafts: any[] = [];

  for (let i = 0; i < prospects.length; i += batchSize) {
    const batch = prospects.slice(i, i + batchSize);
    const input = batch.map((p, idx) => ({
      prospect_index: i + idx,
      name: p.name,
      first_name: p.name.split(" ")[0],
      email: p.email,
      company: p.company,
      title: p.title,
      evidence_of_fit: p.evidence_of_fit,
      summary: p.summary,
    }));

    try {
      const result = await invokeBedrockJSON(
        system,
        `Generate EXACTLY ${sequenceLength} email(s) per prospect (step_number 1 to ${sequenceLength}). Every prospect MUST have all ${sequenceLength} steps. Total output should be ${batch.length * sequenceLength} objects.\n\nProspects:\n${JSON.stringify(input, null, 2)}`,
        8192
      );
      const drafts = Array.isArray(result) ? result : (result.drafts || result.emails || [result]);
      allDrafts.push(...drafts);
    } catch (err) {
      console.error("Drafting batch error:", err);
    }
  }

  return allDrafts;
}

// ── Main handler ──

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
      return new Response(
        JSON.stringify({ error: "AWS credentials not configured" }),
        { status: 500, headers: corsHeaders }
      );
    }

    const body = await req.json();
    const { action, userPrompt, organizationId, userId, campaignId, selectedSequenceId, emailMode, maxSearchQueries: reqMaxSearchQueries, maxProspects: reqMaxProspects, senderEmail: reqSenderEmail, singleProspectId, sendMode: reqSendMode, followupSchedule: reqFollowupSchedule } = body;

    if (!organizationId) {
      return new Response(
        JSON.stringify({ error: "Missing organizationId" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // ══════════════════════════════════════════
    // ACTION: CHECK SPAM RISK — Returns sending health warnings
    // ══════════════════════════════════════════
    if (action === "check_spam_risk") {
      const warnings: string[] = [];
      const today = new Date().toISOString().slice(0, 10);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      // Count emails sent today from this org
      const { count: sentToday } = await supabase
        .from("email_logs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gte("sent_at", today + "T00:00:00Z")
        .eq("status", "sent");

      // Count emails sent in the last hour
      const { count: sentLastHour } = await supabase
        .from("email_logs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .gte("sent_at", oneHourAgo)
        .eq("status", "sent");

      // Count bounces in last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [{ count: recentTotal }, { count: recentBounces }, { count: recentComplaints }] = await Promise.all([
        supabase.from("email_logs").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId).gte("sent_at", thirtyDaysAgo),
        supabase.from("email_logs").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId).gte("sent_at", thirtyDaysAgo).eq("bounce_type", "bounce"),
        supabase.from("email_logs").select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId).gte("sent_at", thirtyDaysAgo).eq("bounce_type", "complaint"),
      ]);

      const dailySent = sentToday || 0;
      const hourlySent = sentLastHour || 0;
      const total = recentTotal || 0;
      const bounces = recentBounces || 0;
      const complaints = recentComplaints || 0;

      // Thresholds based on industry best practices
      if (dailySent >= 100) {
        warnings.push(`You've sent ${dailySent} emails today. Sending more than 100/day from a single domain risks spam flags. Consider spreading sends across multiple days.`);
      } else if (dailySent >= 50) {
        warnings.push(`You've sent ${dailySent} emails today. You're approaching the safe daily limit (~50-100/day). Monitor your deliverability closely.`);
      }

      if (hourlySent >= 20) {
        warnings.push(`You've sent ${hourlySent} emails in the last hour. Sending more than 20/hour can trigger rate limits. Consider spacing out your sends.`);
      }

      if (total > 50) {
        const bounceRate = bounces / total;
        const complaintRate = complaints / total;

        if (bounceRate > 0.02) {
          warnings.push(`Your bounce rate is ${(bounceRate * 100).toFixed(1)}% (${bounces}/${total}). Google/Yahoo/Microsoft flag senders above 2%. Clean your prospect lists.`);
        }

        if (complaintRate > 0.001) {
          warnings.push(`Your spam complaint rate is ${(complaintRate * 100).toFixed(2)}% (${complaints}/${total}). Even 0.1% can damage sender reputation. Review your email content and targeting.`);
        }
      }

      return new Response(
        JSON.stringify({
          warnings,
          stats: { dailySent, hourlySent, bounceRate: total > 0 ? bounces / total : 0, complaintRate: total > 0 ? complaints / total : 0 },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ══════════════════════════════════════════
    // ACTION: APPROVE — Actually send emails via Resend
    // ══════════════════════════════════════════
    if (action === "approve" && campaignId) {
      if (!RESEND_API_KEY) {
        return new Response(
          JSON.stringify({ error: "RESEND_API_KEY not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 1. Update campaign status
      await supabase
        .from("agent_campaigns")
        .update({ status: "executing", updated_at: new Date().toISOString() })
        .eq("id", campaignId);

      // 2. Get the org's sender email (use override if provided, else default, else first available)
      let { data: orgEmail } = reqSenderEmail
        ? await supabase
            .from("organization_emails")
            .select("id, email, display_name, reply_to")
            .eq("organization_id", organizationId)
            .eq("email", reqSenderEmail)
            .maybeSingle()
        : await supabase
            .from("organization_emails")
            .select("id, email, display_name, reply_to")
            .eq("organization_id", organizationId)
            .eq("is_default", true)
            .maybeSingle();

      if (!orgEmail) {
        const { data: fallback } = await supabase
          .from("organization_emails")
          .select("id, email, display_name, reply_to")
          .eq("organization_id", organizationId)
          .limit(1)
          .maybeSingle();
        orgEmail = fallback;
      }

      if (!orgEmail) {
        return new Response(
          JSON.stringify({ error: "No sender email configured. Go to Settings to add one." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const fromAddress = orgEmail.display_name
        ? `${orgEmail.display_name} <${orgEmail.email}>`
        : orgEmail.email;

      // 3. Check billing allowance
      const { data: allowance } = await supabase.rpc("check_email_allowance", { org_id: organizationId });
      if (allowance && !allowance.allowed) {
        return new Response(
          JSON.stringify({ error: allowance.reason || "Email limit reached" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 4. Fetch all draft emails with prospect data
      const { data: allDrafts } = await supabase
        .from("agent_email_drafts")
        .select("id, prospect_id, step_number, subject, body, status, delay_days, send_at")
        .eq("campaign_id", campaignId)
        .eq("status", "draft")
        .order("step_number", { ascending: true });

      // Get prospect data separately
      const { data: prospects } = await supabase
        .from("agent_prospects")
        .select("id, name, email, company, title")
        .eq("campaign_id", campaignId)
        .neq("status", "rejected");

      const prospectMap = new Map((prospects || []).map((p: any) => [p.id, p]));

      // Determine send mode
      const sendMode = reqSendMode || "immediate";

      // Filter drafts (optionally to single prospect)
      let draftsToProcess = allDrafts || [];
      if (singleProspectId) {
        draftsToProcess = draftsToProcess.filter((d: any) => d.prospect_id === singleProspectId);
      }

      let sentCount = 0;
      let failedCount = 0;
      let scheduledCount = 0;
      const currentMonth = new Date().toISOString().slice(0, 7);

      // ── SEND MODE: SCHEDULED — schedule ALL emails (step 1 included) ──
      if (sendMode === "scheduled" || sendMode === "per_prospect") {
        for (const draft of draftsToProcess) {
          const prospect = prospectMap.get(draft.prospect_id);
          if (!prospect?.email) continue;

          const firstName = prospect.name?.split(" ")[0] || "";
          const lastName = prospect.name?.split(" ").slice(1).join(" ") || "";

          const { data: customer } = await supabase
            .from("customers")
            .upsert({
              email: prospect.email,
              organization_id: organizationId,
              first_name: firstName,
              last_name: lastName,
              firm_name: prospect.company || "",
              status: "scheduled",
              campaign_id: campaignId,
              user_id: userId,
            }, { onConflict: "email,organization_id" })
            .select("id")
            .single();

          if (customer) {
            await supabase.from("agent_prospects")
              .update({ customer_id: customer.id })
              .eq("id", prospect.id);
          }

          const scheduledFor = draft.send_at || new Date(Date.now() + (draft.delay_days || 0) * 86400000).toISOString();

          await supabase.from("scheduled_sends").insert({
            customer_id: customer?.id || null,
            organization_id: organizationId,
            user_id: userId,
            scheduled_for: scheduledFor,
            status: "pending",
            campaign_id: campaignId,
            draft_id: draft.id,
          });

          await supabase.from("agent_email_drafts")
            .update({ status: "scheduled", scheduled_for: scheduledFor })
            .eq("id", draft.id);

          scheduledCount++;
        }

        await supabase.from("agent_campaigns")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("id", campaignId);

        return new Response(
          JSON.stringify({ success: true, sent: 0, failed: 0, scheduled: scheduledCount }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // ── SEND MODE: IMMEDIATE (default) — send step 1 now, schedule rest ──
      let step1Drafts = draftsToProcess.filter((d: any) => d.step_number === 1);

      for (const draft of step1Drafts) {
        const prospect = prospectMap.get(draft.prospect_id);
        if (!prospect?.email) continue;

        try {
          // 5a. Upsert customer record
          const firstName = prospect.name?.split(" ")[0] || "";
          const lastName = prospect.name?.split(" ").slice(1).join(" ") || "";

          const { data: customer } = await supabase
            .from("customers")
            .upsert({
              email: prospect.email,
              organization_id: organizationId,
              first_name: firstName,
              last_name: lastName,
              firm_name: prospect.company || "",
              status: "contacted",
              campaign_id: campaignId,
              user_id: userId,
            }, { onConflict: "email,organization_id" })
            .select("id")
            .single();

          // 5b. Link prospect to customer
          if (customer) {
            await supabase.from("agent_prospects")
              .update({ customer_id: customer.id, status: "sent" })
              .eq("id", prospect.id);
          }

          // 5c. Send via Resend
          const htmlBody = draft.body.replace(/\n/g, "<br>");
          const emailPayload: Record<string, any> = {
            from: fromAddress,
            to: prospect.email,
            subject: draft.subject,
            html: htmlBody,
          };
          if (orgEmail.reply_to) emailPayload.reply_to = orgEmail.reply_to;

          const resendRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify(emailPayload),
          });
          const resendData = await resendRes.json();

          if (!resendRes.ok) throw new Error(resendData.message || "Resend API error");

          // 5d. Log to email_logs
          await supabase.from("email_logs").insert({
            customer_id: customer?.id || null,
            customer_email: prospect.email,
            customer_name: prospect.name,
            template_id: null,
            status: "sent",
            sent_at: new Date().toISOString(),
            resend_id: resendData.id,
            user_id: userId,
            organization_id: organizationId,
            subject: draft.subject,
            body: htmlBody,
            sender_email: fromAddress,
            campaign_id: campaignId,
          });

          // 5e. Update draft status
          await supabase.from("agent_email_drafts")
            .update({ status: "sent" })
            .eq("id", draft.id);

          // 5f. Increment billing
          await supabase.rpc("increment_email_usage", {
            org_id: organizationId,
            send_month: currentMonth,
            count: 1,
          });

          sentCount++;
        } catch (err: any) {
          failedCount++;
          console.error("Send error:", err);

          await supabase.from("agent_email_drafts")
            .update({ status: "failed" })
            .eq("id", draft.id);

          // Log failure
          await supabase.from("email_logs").insert({
            customer_email: prospect.email,
            customer_name: prospect.name,
            status: "failed",
            error_message: err.message,
            organization_id: organizationId,
            subject: draft.subject,
            body: draft.body.replace(/\n/g, "<br>"),
            sender_email: fromAddress,
            campaign_id: campaignId,
          });
        }
      }

      // 6. Schedule follow-up emails (step 2+)
      const { data: followUpDrafts } = await supabase
        .from("agent_email_drafts")
        .select("id, prospect_id, step_number, subject, body, delay_days, send_at")
        .eq("campaign_id", campaignId)
        .eq("status", "draft")
        .gt("step_number", 1)
        .order("step_number", { ascending: true });

      const now = new Date();
      for (const draft of followUpDrafts || []) {
        const prospect = prospectMap.get(draft.prospect_id);
        if (!prospect?.email) continue;

        // Find the customer we created for this prospect
        const { data: cust } = await supabase
          .from("customers")
          .select("id")
          .eq("email", prospect.email)
          .eq("organization_id", organizationId)
          .maybeSingle();

        if (!cust) continue;

        // Use pre-computed send_at from draft, or compute from delay_days
        let scheduledFor: string;
        if (draft.send_at) {
          scheduledFor = draft.send_at;
        } else {
          const delayDays = draft.delay_days || (draft.step_number - 1) * 3;
          const sendDate = new Date(now.getTime() + delayDays * 24 * 60 * 60 * 1000);
          sendDate.setHours(10, 0, 0, 0);
          scheduledFor = sendDate.toISOString();
        }

        await supabase.from("scheduled_sends").insert({
          customer_id: cust.id,
          organization_id: organizationId,
          user_id: userId,
          scheduled_for: scheduledFor,
          status: "pending",
          campaign_id: campaignId,
          draft_id: draft.id,
        });

        await supabase.from("agent_email_drafts")
          .update({
            status: "scheduled",
            scheduled_for: scheduledFor,
          })
          .eq("id", draft.id);

        scheduledCount++;
      }

      // 7. Update campaign
      await supabase.from("agent_campaigns")
        .update({ status: "completed", updated_at: new Date().toISOString() })
        .eq("id", campaignId);

      return new Response(
        JSON.stringify({ success: true, sent: sentCount, failed: failedCount, scheduled: scheduledCount }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ══════════════════════════════════════════
    // ACTION: CREATE TEMPLATES from campaign drafts
    // ══════════════════════════════════════════
    if (action === "create_templates" && campaignId) {
      // Get campaign title
      const { data: campaign } = await supabase
        .from("agent_campaigns")
        .select("title")
        .eq("id", campaignId)
        .single();

      // 1. Create a template folder
      const { data: folder } = await supabase
        .from("template_folders")
        .insert({
          name: `Campaign: ${campaign?.title || "Agent Campaign"}`,
          organization_id: organizationId,
          user_id: userId,
        })
        .select("id")
        .single();

      if (!folder) {
        return new Response(
          JSON.stringify({ error: "Failed to create template folder" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // 2. Fetch drafts grouped by step_number (take first per step)
      const { data: drafts } = await supabase
        .from("agent_email_drafts")
        .select("step_number, subject, body")
        .eq("campaign_id", campaignId)
        .order("step_number")
        .limit(20);

      const byStep = new Map<number, any>();
      for (const d of drafts || []) {
        if (!byStep.has(d.step_number)) byStep.set(d.step_number, d);
      }

      // 3. Convert personalized emails back to templates via LLM
      const TEMPLATIZE_SYSTEM = `You are converting a personalized email into a reusable template. Replace personal details with these standard placeholders: [First Name], [Last Name], [Full Name], [Firm Name]. Keep the structure, tone, and messaging intact.

You MUST respond with ONLY valid JSON:
{ "subject": "template subject here", "body": "template body here with [First Name] etc." }`;

      const templateInserts: any[] = [];
      const stageMap: Record<number, string> = { 1: "initial", 2: "follow_up_1", 3: "follow_up_2", 4: "follow_up_3", 5: "final" };

      for (const [step, draft] of byStep) {
        try {
          const templatized = await invokeBedrockJSON(
            TEMPLATIZE_SYSTEM,
            `Convert this personalized email into a template:\n\nSubject: ${draft.subject}\nBody: ${draft.body}`
          );

          templateInserts.push({
            name: `Step ${step}: ${(templatized.subject || draft.subject).slice(0, 60)}`,
            subject: templatized.subject || draft.subject,
            body: templatized.body || draft.body,
            stage: stageMap[step] || "follow_up_1",
            folder_id: folder.id,
            organization_id: organizationId,
            user_id: userId,
          });
        } catch (err) {
          // Fallback: use raw draft as template
          templateInserts.push({
            name: `Step ${step}: ${draft.subject.slice(0, 60)}`,
            subject: draft.subject,
            body: draft.body,
            stage: stageMap[step] || "follow_up_1",
            folder_id: folder.id,
            organization_id: organizationId,
            user_id: userId,
          });
        }
      }

      if (templateInserts.length > 0) {
        await supabase.from("email_templates").insert(templateInserts);
      }

      return new Response(
        JSON.stringify({ success: true, folder_id: folder.id, templates_created: templateInserts.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ══════════════════════════════════════════
    // RUN CAMPAIGN PIPELINE (streaming)
    // ══════════════════════════════════════════
    if (!userPrompt || !userId) {
      return new Response(
        JSON.stringify({ error: "Missing userPrompt or userId" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Check campaign allowance before starting
    const { data: campaignAllowance } = await supabase.rpc("check_campaign_allowance", { org_id: organizationId });
    if (campaignAllowance && !campaignAllowance.allowed) {
      return new Response(
        JSON.stringify({
          error: campaignAllowance.reason || "Campaign limit reached",
          used: campaignAllowance.used,
          limit: campaignAllowance.limit,
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const requestedProspects = reqMaxProspects || 20;
    const maxProspects = requestedProspects;
    const maxSearchQueries = Math.min(reqMaxSearchQueries || 30, 50);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (data: any) => controller.enqueue(encoder.encode(sseEvent(data)));

        try {
          // ── Gather org context ──
          const [
            { data: templates },
            { count: customerCount },
            { data: sequences },
            { data: companyProfileRow },
          ] = await Promise.all([
            supabase.from("email_templates").select("id, name, subject, body").eq("organization_id", organizationId).limit(20),
            supabase.from("customers").select("*", { count: "exact", head: true }).eq("organization_id", organizationId).then((r) => ({ count: r.count })),
            supabase.from("email_sequences").select("id, name").eq("organization_id", organizationId),
            supabase.from("company_profiles").select("*").eq("organization_id", organizationId).maybeSingle(),
          ]);

          const companyProfile: CompanyProfile | null = companyProfileRow ? {
            company_description: companyProfileRow.company_description || "",
            problem_solved: companyProfileRow.problem_solved || "",
            tone: companyProfileRow.tone || "professional",
            key_message: companyProfileRow.key_message || "",
            target_roles: companyProfileRow.target_roles || [],
            target_industries: companyProfileRow.target_industries || [],
            company_size: companyProfileRow.company_size || "",
            company_stage: companyProfileRow.company_stage || "",
            icp_keywords: companyProfileRow.icp_keywords || [],
            preferred_sources: companyProfileRow.preferred_sources || [],
            messaging_notes: companyProfileRow.messaging_notes || "",
          } : null;

          // Settings gate: require ICP and company settings before running
          const missingSettings: string[] = [];
          if (!companyProfile?.company_description) missingSettings.push("company description");
          if (!companyProfile?.tone) missingSettings.push("tone");
          if (!companyProfile?.target_roles?.length) missingSettings.push("target roles");
          if (!companyProfile?.target_industries?.length) missingSettings.push("target industries");
          if (missingSettings.length > 0) {
            emit({ type: "error", error: "Please complete your ICP and company settings before running a campaign." });
            emit({ type: "done" });
            controller.close();
            return;
          }

          const icpSettings = extractICPSettings(companyProfile);

          const orgContext = {
            customerCount: customerCount || 0,
            templateCount: (templates || []).length,
            sequenceCount: (sequences || []).length,
          };

          // If user selected a sequence, fetch its full data
          let sequenceData: any = null;
          if (selectedSequenceId) {
            const { data: seqSteps } = await supabase
              .from("sequence_steps")
              .select("step_order, delay_days, delay_hours, template_id, email_templates(subject, body)")
              .eq("sequence_id", selectedSequenceId)
              .order("step_order", { ascending: true });

            const { data: seq } = await supabase
              .from("email_sequences")
              .select("name")
              .eq("id", selectedSequenceId)
              .single();

            if (seqSteps && seq) {
              sequenceData = {
                name: seq.name,
                steps: seqSteps.map((s: any) => ({
                  step_order: s.step_order,
                  delay_days: s.delay_days,
                  delay_hours: s.delay_hours,
                  subject: s.email_templates?.subject || "",
                  body: s.email_templates?.body || "",
                })),
              };
            }
          }

          // Emit the user's prompt so the UI can display it
          emit({ type: "user_prompt", text: userPrompt });

          // ══ Agent 1: ICP Interpreter ══
          emit({ type: "step", step: "icp_interpreter", message: "Interpreting ICP filters from your request..." });

          const plan = await stepParseICP(userPrompt, sequenceData, orgContext, companyProfile);
          const rawDesired = plan.desired_person_count || 20;
          const desiredCount = Math.min(rawDesired, maxProspects);

          if (plan.needs_clarification) {
            emit({ type: "step", step: "clarification", message: plan.clarification_question || "Could you provide more details about your target audience?" });
            emit({ type: "done" });
            controller.close();
            return;
          }

          // Create campaign record
          const resolvedEmailMode = emailMode || "auto";
          const resolvedSendMode = reqSendMode || "immediate";

          const { data: campaign, error: campErr } = await supabase
            .from("agent_campaigns")
            .insert({
              organization_id: organizationId,
              user_id: userId,
              title: userPrompt.slice(0, 100),
              status: "researching",
              plan,
              user_prompt: userPrompt,
              max_search_queries: maxSearchQueries,
              max_prospects: desiredCount,
              email_mode: resolvedEmailMode,
              send_mode: resolvedSendMode,
            })
            .select("id")
            .single();

          if (campErr) throw new Error(`Failed to create campaign: ${campErr.message}`);

          emit({ type: "plan", campaignId: campaign.id, plan });

          // Helper to save activity to DB (fire-and-forget for performance)
          const logActivity = (step: string, message: string, detail?: any) => {
            supabase.from("agent_activity_log").insert({
              campaign_id: campaign.id,
              step,
              message,
              ...(detail ? { detail } : {}),
            }).then(() => {});
          };

          // Wrap emit to also persist step/status events to DB
          const emitAndLog = (data: any) => {
            emit(data);
            if (data.type === "step" || data.type === "status") {
              logActivity(data.step || "processing", data.message || data.text || "");
            }
          };

          logActivity("icp_interpreter", "ICP filters parsed", {
            roles: plan.icp?.roles || [],
            industries: plan.icp?.industries || [],
            company_type: plan.icp?.company_size || "",
            relevance_signals: plan.relevance_signals || [],
            required_fields: plan.required_fields || ["email", "name", "company", "role"],
          });

          // ══ Agent 2: Source Discovery ══
          emit({ type: "step", step: "source_discovery", message: "Generating search strategies based on ICP..." });

          // Fetch emails already used in previous campaigns (for this org) + existing customers to avoid duplicates
          const [{ data: prevCampaigns }, { data: existingCustomers }] = await Promise.all([
            supabase.from("agent_campaigns")
              .select("id")
              .eq("organization_id", organizationId)
              .neq("id", campaign.id),
            supabase.from("customers")
              .select("email")
              .eq("organization_id", organizationId)
              .not("email", "is", null),
          ]);

          // Get prospect emails from this org's previous campaigns
          let prevProspects: any[] = [];
          const prevCampaignIds = (prevCampaigns || []).map((c: any) => c.id);
          if (prevCampaignIds.length > 0) {
            const { data } = await supabase.from("agent_prospects")
              .select("email")
              .in("campaign_id", prevCampaignIds)
              .not("email", "is", null);
            prevProspects = data || [];
          }

          const excludedEmails = new Set<string>();
          for (const p of (prevProspects || [])) {
            if (p.email) excludedEmails.add(p.email.toLowerCase().trim());
          }
          for (const c of (existingCustomers || [])) {
            if (c.email) excludedEmails.add(c.email.toLowerCase().trim());
          }

          if (excludedEmails.size > 0) {
            emitAndLog({ type: "status", text: `Excluding ${excludedEmails.size} emails already in your pipeline or previous campaigns.` });
          }

          // ══ Agent 3: Prospect Harvester ══
          emit({ type: "step", step: "prospect_harvester", message: `Harvesting prospects from discovered sources (target: ${desiredCount})...` });

          const { prospects: extractedProspects, stats: searchStats } = await stepIterativeSearch(
            plan.icp || plan,
            icpSettings,
            desiredCount,
            maxSearchQueries,
            emitAndLog,
            supabase,
            campaign.id,
            excludedEmails,
            logActivity
          );

          logActivity("prospect_harvester", `Harvesting complete: ${searchStats.queriesUsed} searches, ${extractedProspects.length} of ${desiredCount} prospects found`, {
            queries_used: searchStats.queriesUsed,
            pages_scraped: searchStats.pagesScraped,
            prospects_found: extractedProspects.length,
            stopped_reason: searchStats.stoppedReason,
          });

          // ══ Agent 4: Qualification ══
          emit({ type: "step", step: "qualification", message: `Qualifying ${extractedProspects.length} prospects against ICP...` });

          const preQualCount = extractedProspects.length;
          // Trim to desired count — sort by confidence, keep best matches
          if (extractedProspects.length > desiredCount) {
            extractedProspects.sort((a, b) => (b.confidence_score || 0) - (a.confidence_score || 0));
            extractedProspects.length = desiredCount;
          }
          // Remove any remaining low-confidence prospects
          const qualifiedProspects = extractedProspects.filter(p => (p.confidence_score || 0) >= 0.7);
          const removedCount = preQualCount - qualifiedProspects.length;
          extractedProspects.length = 0;
          extractedProspects.push(...qualifiedProspects);

          logActivity("qualification", `Qualified ${extractedProspects.length} prospects (removed ${removedCount} low-quality or excess)`, {
            pre_qualification: preQualCount,
            post_qualification: extractedProspects.length,
            removed: removedCount,
          });

          emitAndLog({ type: "status", text: `${extractedProspects.length} prospects passed qualification (${removedCount} removed).` });

          // ── Handle no prospects ──
          if (extractedProspects.length === 0) {
            const msg = `Could not find any prospects with verified email addresses matching your ICP after ${searchStats.queriesUsed} searches. Try targeting industries or roles where contact info is more publicly available.`;
            emitAndLog({ type: "step", step: "clarification", message: msg });
            await supabase
              .from("agent_campaigns")
              .update({ status: "failed", warnings: [msg], updated_at: new Date().toISOString() })
              .eq("id", campaign.id);
            emit({ type: "done" });
            controller.close();
            return;
          }

          // ══ Agent 5: Research Summary ══
          emit({ type: "step", step: "research_summary", message: `Generating research summaries for ${extractedProspects.length} prospects...` });

          // Summaries are already generated per-prospect during extraction (evidence_of_fit + summary fields)
          // Log each summary for activity trail
          for (const p of extractedProspects) {
            logActivity("research_summary", `${p.name} — ${p.title} at ${p.company}`, {
              prospect_name: p.name,
              company: p.company,
              source_url: p.source_url,
              summary: p.summary,
              evidence_of_fit: p.evidence_of_fit,
            });
          }

          emitAndLog({ type: "status", text: `Research summaries generated for ${extractedProspects.length} prospects.` });

          // ── Store prospects ──
          const prospectInserts = extractedProspects.map((p) => ({
            campaign_id: campaign.id,
            name: p.name,
            email: p.email,
            company: p.company,
            title: p.title,
            linkedin_url: p.linkedin_url,
            source: "serp",
            source_url: p.source_url,
            email_source_location: p.email_source_location,
            evidence_of_fit: p.evidence_of_fit,
            summary: p.summary,
            confidence_score: p.confidence_score,
            status: "enriched",
            risk_flags: [],
            enrichment: {
              evidence_of_fit: p.evidence_of_fit,
              summary: p.summary,
              source_url: p.source_url,
            },
          }));

          const { data: insertedProspects, error: prospErr } = await supabase
            .from("agent_prospects")
            .insert(prospectInserts)
            .select("id, name, email, company, title, linkedin_url, source, source_url, email_source_location, evidence_of_fit, summary, confidence_score, status, risk_flags, enrichment");

          if (prospErr) throw new Error(`Failed to store prospects: ${prospErr.message}`);

          await supabase
            .from("agent_campaigns")
            .update({ status: "drafting", updated_at: new Date().toISOString() })
            .eq("id", campaign.id);

          emit({
            type: "prospects",
            prospects: insertedProspects || [],
          });

          // ── Step 4: Email Drafting ──
          const foundCount = extractedProspects.length;
          emitAndLog({ type: "step", step: "drafting", message: `Generating personalized emails for ${foundCount} prospects...` });

          // ── Two explicit drafting modes ──
          let emailDrafts: any[];
          if (resolvedEmailMode === "template" && sequenceData && sequenceData.steps.length > 0) {
            // TEMPLATE MODE: use templates word-for-word, only replace placeholders
            emitAndLog({ type: "status", text: `Using template sequence (${sequenceData.steps.length} steps) — replacing placeholders with prospect data...` });
            emailDrafts = stepDraftTemplate(extractedProspects, sequenceData);
          } else {
            // AUTO-GENERATE MODE: LLM writes original emails using prospect research + company profile
            emailDrafts = await stepDraftAuto(extractedProspects, companyProfile, plan);
          }

          // Store drafts
          const prospectIds = (insertedProspects || []).map((p: any) => p.id);
          const followupDelays = reqFollowupSchedule || [0, 3, 7, 14, 21]; // configurable
          const draftNow = new Date();
          const draftInserts = emailDrafts
            .map((d: any) => {
              const prospectId = prospectIds[d.prospect_index];
              if (!prospectId || !d.subject || !d.body) return null;
              // For auto-generated drafts, filter out any with unfilled placeholders
              if (resolvedEmailMode !== "template") {
                const placeholderPattern = /\{\{[^}]+\}\}|\{insert[^}]*\}|\{[A-Z][a-z]+ ?[A-Z]?[a-z]*\}|\[Your [^\]]+\]|\[INSERT[^\]]*\]|\[First ?Name\]|\[Last ?Name\]|\[Full ?Name\]|\[Company\]|\[Firm\]|\[Name\]|\[Title\]/i;
                if (placeholderPattern.test(d.body) || placeholderPattern.test(d.subject)) return null;
              }
              // Strip em dashes and en dashes
              d.body = d.body.replace(/[—–]/g, ",");
              d.subject = d.subject.replace(/[—–]/g, ",");
              // Follow-up delays: configurable per campaign
              const stepNum = d.step_number || 1;
              const delayDays = followupDelays[stepNum - 1] ?? ((stepNum - 1) * 7);
              // Compute send_at timestamp for timeline visibility
              const sendAt = new Date(draftNow.getTime() + delayDays * 24 * 60 * 60 * 1000);
              sendAt.setHours(10, 0, 0, 0);
              return {
                campaign_id: campaign.id,
                prospect_id: prospectId,
                step_number: stepNum,
                subject: d.subject,
                body: d.body,
                status: "draft",
                delay_days: delayDays,
                send_at: sendAt.toISOString(),
              };
            })
            .filter(Boolean);

          // Retry only for auto mode if all drafts were filtered
          if (resolvedEmailMode !== "template" && draftInserts.length === 0 && emailDrafts.length > 0) {
            emitAndLog({ type: "status", text: `Generated ${emailDrafts.length} drafts but all were filtered (contained placeholders). Retrying...` });
            const retryDrafts = await stepDraftAuto(extractedProspects, companyProfile, plan);
            const retryInserts = retryDrafts
              .map((d: any) => {
                const prospectId = prospectIds[d.prospect_index];
                if (!prospectId || !d.subject || !d.body) return null;
                d.body = d.body.replace(/[—–]/g, ",");
                d.subject = d.subject.replace(/[—–]/g, ",");
                const stepNum = d.step_number || 1;
                const delayDays = followupDelays[stepNum - 1] ?? ((stepNum - 1) * 7);
                const sendAt = new Date(draftNow.getTime() + delayDays * 24 * 60 * 60 * 1000);
                sendAt.setHours(10, 0, 0, 0);
                return { campaign_id: campaign.id, prospect_id: prospectId, step_number: stepNum, subject: d.subject, body: d.body, status: "draft", delay_days: delayDays, send_at: sendAt.toISOString() };
              })
              .filter(Boolean);
            draftInserts.push(...retryInserts);
          }

          const { data: insertedDrafts } = await supabase
            .from("agent_email_drafts")
            .insert(draftInserts.length > 0 ? draftInserts : [])
            .select("id, prospect_id, step_number, subject, body, status, delay_days, send_at");

          // Warnings
          const warnings: string[] = [];
          if (foundCount < desiredCount) {
            warnings.push(`Found ${foundCount} of ${desiredCount} requested prospects after ${searchStats.queriesUsed} searches. ${searchStats.stoppedReason === "budget_exhausted" ? "Search budget reached." : "Email availability on public pages limited results."}`);
          }

          // Increment campaign usage counters
          const usageMonth = new Date().toISOString().slice(0, 7);
          await supabase.rpc("increment_campaign_usage", {
            org_id: organizationId,
            usage_month: usageMonth,
            campaign_count: 1,
            prospect_count: foundCount,
          });

          await supabase
            .from("agent_campaigns")
            .update({ status: "review", warnings, updated_at: new Date().toISOString() })
            .eq("id", campaign.id);

          emit({
            type: "drafts",
            drafts: insertedDrafts || [],
            warnings,
          });

          logActivity("drafting", `Generated ${(insertedDrafts || []).length} email drafts for ${foundCount} prospects`);

          emitAndLog({ type: "step", step: "approval", message: "Campaign ready for approval. Review prospects, research summaries, source URLs, and email drafts before approving." });
          emit({ type: "done" });

        } catch (err: any) {
          console.error("Campaign agent error:", err);
          const errorMsg = err?.message || "Something went wrong";
          emit({ type: "error", error: `Campaign failed: ${errorMsg}. Please try again.` });
          emit({ type: "done" });
        }

        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });

  } catch (err) {
    console.error("Handler error:", err);
    return new Response(
      JSON.stringify({ error: "Something went wrong. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
