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
const HUNTER_API_KEY = Deno.env.get("HUNTER_API_KEY");

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

// ── Multi-Source Discovery: HN, Product Hunt, Reddit ──
// These functions search free APIs and return ScrapedPage[] format
// so they feed directly into the existing extraction pipeline.

async function searchHackerNews(
  keywords: string[],
  maxResults: number = 10
): Promise<ScrapedPage[]> {
  const pages: ScrapedPage[] = [];
  const hnStart = Date.now();
  const HN_BUDGET_MS = 15_000; // 15 seconds max for HN
  try {
    // Algolia HN search API (free, no key needed)
    for (const keyword of keywords.slice(0, 2)) {
      if (Date.now() - hnStart > HN_BUDGET_MS) break;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(keyword)}&tags=story&hitsPerPage=${Math.min(maxResults, 10)}`;
      let res;
      try { res = await fetch(url, { signal: controller.signal }); } catch { clearTimeout(timeout); continue; }
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();

      for (const hit of (data.hits || []).slice(0, 3)) {
        if (Date.now() - hnStart > HN_BUDGET_MS) break;
        const commentUrl = `https://news.ycombinator.com/item?id=${hit.objectID}`;

        // Scrape the linked article for contact info
        if (hit.url) {
          const content = await fetchPageContent(hit.url);
          const emails = extractEmailsFromText(content);
          if (content.length > 100 || emails.length > 0) {
            pages.push({
              url: hit.url,
              title: hit.title || "",
              snippet: `HN story by ${hit.author || "unknown"} (${hit.points || 0} points). ${hit.title}`,
              content: content.slice(0, 10000),
              emails_found: emails,
            });
          }
        }

        // Also scrape the HN comment thread for people discussing the topic
        const commentContent = await fetchPageContent(commentUrl);
        const commentEmails = extractEmailsFromText(commentContent);
        if (commentContent.length > 200) {
          pages.push({
            url: commentUrl,
            title: `HN Discussion: ${hit.title || ""}`,
            snippet: `Hacker News discussion with ${hit.num_comments || 0} comments. Author: ${hit.author || "unknown"}`,
            content: commentContent.slice(0, 10000),
            emails_found: commentEmails,
          });
        }
      }
      await new Promise(r => setTimeout(r, 200));
    }
  } catch (err) {
    console.error("HN search error:", err);
  }
  return pages;
}

async function searchProductHunt(
  keywords: string[],
  maxResults: number = 10
): Promise<ScrapedPage[]> {
  const pages: ScrapedPage[] = [];
  const phStart = Date.now();
  const PH_BUDGET_MS = 15_000; // 15 seconds max for PH
  try {
    // Product Hunt doesn't have a free search API, but we can search via Google
    // and scrape PH pages which have maker profiles with contact info
    for (const keyword of keywords.slice(0, 2)) {
      if (Date.now() - phStart > PH_BUDGET_MS) break;
      const query = `site:producthunt.com ${keyword} maker`;
      if (!SERP_API_KEY) break;

      const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${SERP_API_KEY}&num=5`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();

      for (const result of (data.organic_results || []).slice(0, 5)) {
        const pageUrl = result.link || "";
        const content = await fetchPageContent(pageUrl);
        const emails = extractEmailsFromText(content);
        if (content.length > 100 || emails.length > 0) {
          pages.push({
            url: pageUrl,
            title: result.title || "",
            snippet: `Product Hunt: ${result.snippet || ""}`,
            content: content.slice(0, 10000),
            emails_found: emails,
          });
        }
      }
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (err) {
    console.error("PH search error:", err);
  }
  return pages;
}

async function searchReddit(
  keywords: string[],
  maxResults: number = 10
): Promise<ScrapedPage[]> {
  const pages: ScrapedPage[] = [];
  const redditStart = Date.now();
  const REDDIT_BUDGET_MS = 15_000; // 15 seconds max for Reddit
  try {
    // Reddit JSON API (free, no key needed, append .json to any URL)
    for (const keyword of keywords.slice(0, 2)) {
      if (Date.now() - redditStart > REDDIT_BUDGET_MS) break;
      const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(keyword)}&sort=relevance&limit=${Math.min(maxResults, 10)}&t=year`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let res;
      try { res = await fetch(url, { headers: { "User-Agent": "MoraBot/1.0" }, signal: controller.signal }); } catch { clearTimeout(timeout); continue; }
      clearTimeout(timeout);
      if (!res.ok) continue;
      const data = await res.json();

      const posts = data?.data?.children || [];
      for (const post of posts.slice(0, 3)) {
        if (Date.now() - redditStart > REDDIT_BUDGET_MS) break;
        const d = post.data;
        if (!d || d.is_self === false) continue; // skip link-only posts

        const postUrl = `https://www.reddit.com${d.permalink}`;
        const selfText = d.selftext || "";
        const title = d.title || "";
        const author = d.author || "";
        const subreddit = d.subreddit || "";

        // Combine post content with comments
        let fullContent = `Title: ${title}\nAuthor: u/${author}\nSubreddit: r/${subreddit}\n\n${selfText}`;

        // Fetch comments for the post (with timeout)
        try {
          const commentsUrl = `https://www.reddit.com${d.permalink}.json?limit=20`;
          const cController = new AbortController();
          const cTimeout = setTimeout(() => cController.abort(), 5000);
          const commentsRes = await fetch(commentsUrl, {
            headers: { "User-Agent": "MoraBot/1.0" },
            signal: cController.signal,
          });
          clearTimeout(cTimeout);
          if (commentsRes.ok) {
            const commentsData = await commentsRes.json();
            const comments = commentsData?.[1]?.data?.children || [];
            for (const c of comments.slice(0, 15)) {
              if (c.data?.body) {
                fullContent += `\n\nComment by u/${c.data.author || "unknown"}:\n${c.data.body}`;
              }
            }
          }
        } catch { /* comments fetch failed, continue with post content */ }

        const emails = extractEmailsFromText(fullContent);

        pages.push({
          url: postUrl,
          title: `Reddit: ${title}`,
          snippet: `r/${subreddit} by u/${author}. ${selfText.slice(0, 200)}`,
          content: fullContent.slice(0, 10000),
          emails_found: emails,
        });
      }
      await new Promise(r => setTimeout(r, 1000)); // Reddit rate limits are strict
    }
  } catch (err) {
    console.error("Reddit search error:", err);
  }
  return pages;
}

// Run all multi-source discovery in parallel, returns combined ScrapedPage[]
async function runMultiSourceDiscovery(
  hypotheses: Hypothesis[],
  emit: (data: any) => void,
  logActivity?: (step: string, message: string, detail?: any) => void
): Promise<ScrapedPage[]> {
  // Build search keywords from hypotheses
  const keywords: string[] = [];
  for (const h of hypotheses) {
    // Use first signal and description as search terms
    keywords.push(h.description);
    if (h.signals.length > 0) keywords.push(h.signals[0]);
  }
  // Deduplicate and limit
  const uniqueKeywords = [...new Set(keywords)].slice(0, 6);

  emit({ type: "status", text: `Searching HN, Product Hunt, and Reddit for "${uniqueKeywords[0]}"...` });

  // Run all three sources in parallel
  const [hnPages, phPages, redditPages] = await Promise.all([
    searchHackerNews(uniqueKeywords),
    searchProductHunt(uniqueKeywords),
    searchReddit(uniqueKeywords),
  ]);

  const totalPages = hnPages.length + phPages.length + redditPages.length;

  if (logActivity) {
    logActivity("source_discovery", `Multi-source discovery: ${hnPages.length} HN pages, ${phPages.length} PH pages, ${redditPages.length} Reddit pages`, {
      hn_pages: hnPages.length,
      ph_pages: phPages.length,
      reddit_pages: redditPages.length,
      keywords: uniqueKeywords,
    });
  }

  if (totalPages > 0) {
    emit({ type: "status", text: `Multi-source discovery found ${totalPages} pages (HN: ${hnPages.length}, PH: ${phPages.length}, Reddit: ${redditPages.length})` });
  }

  return [...hnPages, ...phPages, ...redditPages];
}

// ── Hunter.io Email Enrichment ──
// For prospects without email, try Hunter.io domain search + email finder

async function enrichWithHunter(
  prospects: ExtractedProspect[],
  emit: (data: any) => void,
  logActivity?: (step: string, message: string, detail?: any) => void
): Promise<number> {
  if (!HUNTER_API_KEY || prospects.length === 0) return 0;

  let found = 0;
  const maxAttempts = Math.min(prospects.length, 10);

  for (let i = 0; i < maxAttempts; i++) {
    const p = prospects[i];
    if (!p.company) continue;

    try {
      // Extract domain from company name or website
      let domain = "";
      if (p.website_url) {
        try { domain = new URL(p.website_url).hostname; } catch {}
      }
      if (!domain && p.source_url) {
        try {
          const srcHost = new URL(p.source_url).hostname;
          // Only use source_url domain if it looks like a company site (not a directory)
          if (!srcHost.includes("linkedin") && !srcHost.includes("producthunt") &&
              !srcHost.includes("ycombinator") && !srcHost.includes("reddit") &&
              !srcHost.includes("twitter") && !srcHost.includes("google")) {
            domain = srcHost;
          }
        } catch {}
      }

      // Try email finder first (name + domain)
      if (domain) {
        const firstName = p.name.split(" ")[0];
        const lastName = p.name.split(" ").slice(1).join(" ");
        const finderUrl = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${HUNTER_API_KEY}`;

        const res = await fetch(finderUrl);
        if (res.ok) {
          const data = await res.json();
          const email = data?.data?.email;
          const score = data?.data?.score || 0;

          if (email && score >= 70) {
            p.email = email;
            p.email_source_location = `Hunter.io (${score}% confidence)`;
            found++;

            if (logActivity) {
              logActivity("prospect_harvester", `Hunter.io found email for ${p.name}: ${email} (${score}% confidence)`, {
                source: "hunter.io",
                domain,
                score,
              });
            }
            continue;
          }
        }
      }

      // Fallback: domain search by company name
      if (!domain) {
        const domainSearchUrl = `https://api.hunter.io/v2/domain-search?company=${encodeURIComponent(p.company)}&api_key=${HUNTER_API_KEY}&limit=5`;
        const res = await fetch(domainSearchUrl);
        if (res.ok) {
          const data = await res.json();
          const emails = data?.data?.emails || [];
          domain = data?.data?.domain || "";

          // Try to match by name
          const nameParts = p.name.toLowerCase().split(" ");
          const matched = emails.find((e: any) => {
            const full = `${e.first_name || ""} ${e.last_name || ""}`.toLowerCase();
            return nameParts.some((part: string) => full.includes(part));
          });

          if (matched?.value) {
            p.email = matched.value;
            p.email_source_location = `Hunter.io domain search (${matched.confidence || 0}% confidence)`;
            found++;

            if (logActivity) {
              logActivity("prospect_harvester", `Hunter.io domain search found email for ${p.name}: ${matched.value}`, {
                source: "hunter.io",
                domain,
                confidence: matched.confidence,
              });
            }
          }
        }
      }

      await new Promise(r => setTimeout(r, 200)); // Rate limit
    } catch (err) {
      console.error("Hunter.io error:", err);
    }
  }

  return found;
}

// ── Company profile + ICP types ──

interface GuidedAnswers {
  what_building?: string;
  problem_solved?: string;
  who_has_problem?: string;
  online_signals?: string;
  customer_vibe?: string;
}

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
  // Problem-first fields
  problem_statement: string;
  audience_description: string;
  signals: string[];
  // Guided questions mode
  settings_mode?: string;
  guided_answers?: GuidedAnswers;
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
  email: string | null;           // null if no email found — prospect is still kept
  email_source_location: string;
  company: string;
  title: string;
  source_url: string;
  evidence_of_fit: string;
  summary: string;
  confidence_score: number;
  linkedin_url: string | null;
  twitter_url?: string | null;
  website_url?: string | null;
  intent_signals?: Array<{ type: string; text: string; source_url: string }>;
}

// ── Step 1: Hypothesis Generator ──
// Problem-first: instead of requiring rigid ICP fields, the system generates
// hypotheses about who might experience the user's problem, and what signals
// to search for. Works across any industry without hardcoded role buckets.

interface Hypothesis {
  id: string;
  description: string;       // "SaaS founders struggling with outbound sales"
  audience_type: string;      // "startup founders", "marketing agencies", "dentists"
  signals: string[];          // observable behaviors to search for
  search_angles: string[];    // different ways to find these people
}

interface HypothesisGeneratorOutput {
  hypotheses: Hypothesis[];
  icp: any;                   // backward compat: still emit ICP for downstream
  desired_person_count: number;
  campaign_structure: any;
  relevance_signals: string[];
  required_fields: string[];
  personalization_fields: string[];
  needs_clarification?: boolean;
  clarification_question?: string;
}

function buildHypothesisPrompt(companyProfile: CompanyProfile | null): string {
  let system = `You are a prospect discovery strategist. Your job is to think deeply about WHO might need the user's product/service and HOW to find them on the internet.

You are problem-first, not title-first. Instead of matching rigid job titles, you identify people who are EXPERIENCING a specific problem based on observable signals.

You MUST respond with ONLY valid JSON (no explanation, no markdown) in this exact format:
{
  "hypotheses": [
    {
      "id": "h1",
      "description": "Startup founders who recently launched and need their first customers",
      "audience_type": "startup founders",
      "signals": [
        "posted about launching a product",
        "asking how to find first customers",
        "discussing cold outreach strategies",
        "recently listed on Product Hunt or Hacker News"
      ],
      "search_angles": [
        "Product Hunt launches in [relevant category]",
        "Hacker News Show HN posts about [relevant topic]",
        "blog posts about struggling with customer acquisition",
        "startup directories and accelerator cohort pages",
        "founders discussing outbound sales on forums"
      ]
    },
    {
      "id": "h2",
      "description": "Growth marketers evaluating cold email tools",
      "audience_type": "growth marketers",
      "signals": [
        "comparing email outreach tools",
        "asking about cold email deliverability",
        "writing about lead generation tactics"
      ],
      "search_angles": [
        "comparison articles for cold email tools",
        "marketing forums discussing outreach",
        "conference speaker lists for growth marketing events"
      ]
    }
  ],
  "icp": {
    "roles": ["Founder", "Growth Marketer"],
    "industries": ["SaaS", "B2B Tech"],
    "company_size": "1-200 employees",
    "geography": "",
    "other_criteria": ""
  },
  "desired_person_count": 20,
  "campaign_structure": {
    "sequence_length": 3,
    "tone": "${companyProfile?.tone || "professional"}",
    "key_value_prop": "${companyProfile?.key_message || ""}"
  },
  "relevance_signals": ["launched product recently", "discussing outreach challenges"],
  "required_fields": ["name", "company"],
  "personalization_fields": ["company_name", "role", "recent_activity", "signal_context"]
}

CRITICAL RULES:
- Generate 3-5 DIVERSE hypotheses about who might have the problem described
- Each hypothesis must have a DIFFERENT audience type — cast a wide net
- Signals must be OBSERVABLE behaviors (things people do publicly online), not internal states
- Search angles must be CONCRETE: specific places and search strategies to find these people
- Think beyond job titles. A dentist, a SaaS founder, and a real estate agent might all struggle with "getting more customers" — your hypotheses should capture this diversity when the problem is broad
- If the user's request is extremely vague with no problem or audience implied, set "needs_clarification": true
- If the user mentions a number of prospects, use that as desired_person_count (default 20, max 50)
- The "icp" field is for backward compatibility — populate it from your hypotheses
- "required_fields" should be ["name", "company"] — email is found separately, do NOT require it upfront
- For "relevance_signals", combine the best signals from all hypotheses`;

  if (companyProfile) {
    // Guided mode: user gave casual conversational answers — richest signal source
    const ga = companyProfile.guided_answers;
    if (companyProfile.settings_mode === "guided" && ga) {
      system += `\n\nThe user answered these questions conversationally (infer ICP, problem, and signals from these):`;
      if (ga.what_building) system += `\n- What are you building? "${ga.what_building}"`;
      if (ga.problem_solved) system += `\n- What problem does it solve? "${ga.problem_solved}"`;
      if (ga.who_has_problem) system += `\n- Who has this problem? "${ga.who_has_problem}"`;
      if (ga.online_signals) system += `\n- What would someone say online? "${ga.online_signals}"`;
      if (ga.customer_vibe) system += `\n- What vibe do customers have? "${ga.customer_vibe}"`;
      if (companyProfile.key_message) system += `\n- Key message: ${companyProfile.key_message}`;
      system += `\n- Preferred tone: ${companyProfile.tone || "professional"}`;
    } else {
      // Manual mode: structured fields
      system += `\n\nThe user's company context:
- What the company does: ${companyProfile.company_description}
- Problem it solves: ${companyProfile.problem_solved}
- Preferred tone: ${companyProfile.tone}
- Key message: ${companyProfile.key_message}`;
    }

    // Include any existing ICP settings as hints (not requirements)
    const hasICP = companyProfile.target_roles?.length || companyProfile.target_industries?.length || companyProfile.company_size;
    if (hasICP) {
      system += `\n\nThe organization has some saved audience hints (use as starting points, not hard constraints):`;
      if (companyProfile.target_roles?.length) system += `\n- Typical roles: ${companyProfile.target_roles.join(", ")}`;
      if (companyProfile.target_industries?.length) system += `\n- Typical industries: ${companyProfile.target_industries.join(", ")}`;
      if (companyProfile.company_size) system += `\n- Company size: ${companyProfile.company_size}`;
      if (companyProfile.company_stage) system += `\n- Company stage: ${companyProfile.company_stage}`;
      if (companyProfile.icp_keywords?.length) system += `\n- Keywords: ${companyProfile.icp_keywords.join(", ")}`;
    }

    // Problem-first fields
    if (companyProfile.problem_statement) {
      system += `\n- Core problem they solve: ${companyProfile.problem_statement}`;
    }
    if (companyProfile.audience_description) {
      system += `\n- Who typically has this problem: ${companyProfile.audience_description}`;
    }
    if (companyProfile.signals?.length) {
      system += `\n- Known signals of this problem: ${companyProfile.signals.join(", ")}`;
    }
  }

  return system;
}

async function stepGenerateHypotheses(
  userPrompt: string,
  sequenceData: any | null,
  orgContext: any,
  companyProfile: CompanyProfile | null
): Promise<HypothesisGeneratorOutput> {
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

  return await invokeBedrockJSON(buildHypothesisPrompt(companyProfile), contextStr);
}

// Backward compat alias — downstream code still calls stepParseICP
async function stepParseICP(userPrompt: string, sequenceData: any | null, orgContext: any, companyProfile: CompanyProfile | null): Promise<any> {
  return await stepGenerateHypotheses(userPrompt, sequenceData, orgContext, companyProfile);
}

// ── Step 2: Signal-Based Discovery ──
// Replaces hardcoded role buckets with hypothesis-driven query generation.
// The LLM decides the best search strategy for ANY industry based on the
// hypotheses generated in Step 1, not a switch/case on job titles.

function buildSignalQueryPrompt(): string {
  return `You are an expert internet researcher. Given a set of hypotheses about WHO might have a specific problem, generate Google search queries that will find these people.

You are signal-first: you search for BEHAVIORS and EVIDENCE that someone has the problem, not just job titles.

You MUST respond with ONLY valid JSON (no explanation, no markdown):
{
  "queries": [
    {
      "query": "the google search query",
      "hypothesis_id": "h1",
      "strategy": "brief description of what this query targets"
    }
  ]
}

QUERY GENERATION RULES:

1. SIGNAL QUERIES (at least 40% of total): Search for people EXPRESSING the problem
   Examples: "struggling with cold outreach", "need more customers for my startup", "how to find leads"
   These find people actively discussing the problem in forums, blogs, social media

2. DIRECTORY QUERIES (at least 30% of total): Search for lists/directories of the target audience
   Examples: "top SaaS founders 2025 email", "startup accelerator cohort directory contact"
   These find curated pages with multiple prospects and contact info

3. CONTACT DISCOVERY QUERIES (at least 20% of total): Include "email", "contact", "@" to find pages with contact info
   Examples: "marketing agency founders team page email", "[industry] association member directory"
   These find pages where contact information is publicly listed

4. COMMUNITY QUERIES (remaining): Search within specific communities
   Examples: "site:producthunt.com [topic]", "site:news.ycombinator.com [topic]"
   These find people active in relevant communities

CRITICAL:
- Generate 15-20 queries total, spread across all hypotheses
- Each query must target a DIFFERENT angle — no redundant queries
- DO NOT use generic queries like "founders" or "CEO list" — every query must connect to the specific problem or signal
- Prioritize pages that list MULTIPLE people (directories, roundups, team pages) over individual profiles
- For local/service businesses (dentists, lawyers, etc.), include city/region terms and association directories
- For tech/SaaS, include community sites (HN, PH, IndieHackers) and startup lists
- For agencies/consultants, include portfolio sites, case study pages, and industry award lists
- Include year terms (2024, 2025) for freshness
- Use site: operators for high-value sites (linkedin.com, twitter.com, producthunt.com, etc.)
- Generate queries for DIFFERENT geographic areas if the audience is global`;
}

async function stepGenerateQueries(icp: any, icpSettings: ICPSettings | null, existingProspects?: ExtractedProspect[], hypotheses?: Hypothesis[]): Promise<string[]> {
  const system = buildSignalQueryPrompt();

  let message = "";

  // If we have hypotheses from Agent 1, use them as the primary input
  if (hypotheses && hypotheses.length > 0) {
    message += `HYPOTHESES about who has this problem:\n`;
    for (const h of hypotheses) {
      message += `\n${h.id}: "${h.description}"
  Audience: ${h.audience_type}
  Signals to look for: ${h.signals.join(", ")}
  Search angles: ${h.search_angles.join(", ")}\n`;
    }
  }

  // Still include ICP for backward compat (when hypotheses aren't available)
  if (icp) {
    message += `\nICP context:\n${JSON.stringify(icp, null, 2)}`;
  }

  if (icpSettings) {
    const parts: string[] = [];
    if (icpSettings.target_roles.length) parts.push(`Roles: ${icpSettings.target_roles.join(", ")}`);
    if (icpSettings.target_industries.length) parts.push(`Industries: ${icpSettings.target_industries.join(", ")}`);
    if (icpSettings.company_size) parts.push(`Company size: ${icpSettings.company_size}`);
    if (icpSettings.icp_keywords.length) parts.push(`Keywords: ${icpSettings.icp_keywords.join(", ")}`);
    if (icpSettings.preferred_sources?.length) parts.push(`Preferred sources: ${icpSettings.preferred_sources.join(", ")}`);
    if (parts.length > 0) {
      message += `\n\nAdditional audience hints:\n${parts.join("\n")}`;
    }
  }

  if (existingProspects && existingProspects.length > 0) {
    message += `\n\nAlready found these prospects — generate DIFFERENT queries to find MORE people:\n`;
    message += existingProspects.slice(0, 10).map(p => `- ${p.name} at ${p.company}`).join("\n");
  }

  const result = await invokeBedrockJSON(system, message);

  // Handle both formats: array of objects (new) or array of strings (legacy)
  const queries = result.queries || [];
  return queries.map((q: any) => typeof q === "string" ? q : q.query);
}

// ── Step 3: Iterative Search — batched SerpAPI + scraping + extraction ──

function buildExtractionPrompt(icpSettings: ICPSettings | null): string {
  let system = `You are a prospect extraction AI. Given scraped web page content and target criteria, extract REAL people from the page.

CRITICAL RULES — FOLLOW EXACTLY:
1. ONLY extract people whose information is ACTUALLY on the page. NEVER invent or hallucinate names, emails, companies, or titles.
2. For email: ONLY include an email if it literally appears in the page content or in the emails_found_on_page list. If no email is visible, set email to null.
3. DO NOT skip prospects just because they lack an email. If someone clearly matches the target criteria, include them with email set to null. Good prospects without email are still valuable — they can be contacted via LinkedIn, Twitter, or their website.
4. Look carefully at the emails_found_on_page list — match each email to a person mentioned on the page (e.g. john@ likely belongs to "John Smith" on the same page).
5. For each person, provide evidence_of_fit: a direct quote or paraphrase from the page proving they match the criteria. Also include intent_signals if the person showed observable behavior related to the problem (posted about it, asked about tools, launched something relevant).
6. Set confidence_score based on how much real data you found AND how strong the evidence is:
   - 0.9+: Name + company + title + email + strong signal/evidence of fit
   - 0.8-0.9: Name + company + email OR name + company + strong evidence without email
   - 0.7-0.8: Name + company + decent evidence
   - Below 0.6: Don't include — not enough data
7. For the summary field, include: who they are, what they do, why they match, and the page where they were found.
8. Extract linkedin_url if any LinkedIn profile URL appears on the page. Extract twitter_url if a Twitter/X profile URL appears.`;

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
      "linkedin_url": "https://linkedin.com/in/johnsmith",
      "twitter_url": null,
      "source_url": "https://techcorp.com/team",
      "evidence_of_fit": "Listed as CEO of TechCorp, a B2B SaaS company with 50 employees",
      "summary": "John Smith is CEO of TechCorp, a B2B SaaS company. Matches ICP as a SaaS founder. Found on the TechCorp team page.",
      "confidence_score": 0.92,
      "intent_signals": [
        { "type": "post", "text": "Tweeted about struggling with outbound sales", "source_url": "https://twitter.com/johnsmith/status/123" }
      ]
    },
    {
      "name": "Jane Doe",
      "email": null,
      "email_source_location": "",
      "company": "StartupXYZ",
      "title": "Founder",
      "linkedin_url": "https://linkedin.com/in/janedoe",
      "twitter_url": "https://twitter.com/janedoe",
      "source_url": "https://example.com/startups-to-watch",
      "evidence_of_fit": "Featured as founder of StartupXYZ, recently launched and seeking growth",
      "summary": "Jane Doe is the founder of StartupXYZ. No email found but strong LinkedIn presence.",
      "confidence_score": 0.82,
      "intent_signals": []
    }
  ]
}

IMPORTANT:
- Include prospects WITHOUT email if they have strong evidence of fit. Set email to null.
- Prospects WITH email should be scored higher (they are more actionable).
- If a page has NO relevant prospects at all, return: { "prospects": [] }
- intent_signals should only include OBSERVABLE behaviors found on the page (posts, comments, launches, hiring signals). Leave empty array if none found.`;

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

      const results = (data.organic_results || []).slice(0, 8);

      // Scrape pages in parallel (batch of 5)
      for (let i = 0; i < results.length; i += 5) {
        const batch = results.slice(i, i + 5);
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
        if (!p.name || !p.company) continue; // Name + company are minimum required

        const nameKey = p.name.toLowerCase();
        if (seenNames.has(nameKey)) continue;

        // If email is provided, validate it was actually found on the page
        let validatedEmail: string | null = null;
        if (p.email) {
          const emailKey = p.email.toLowerCase();
          if (seenEmails.has(emailKey)) continue;

          const sourcePage = batch.find((pg) => pg.url === p.source_url) || batch[0];
          const emailFoundOnPage = sourcePage.emails_found.some(
            (e) => e.toLowerCase() === emailKey
          ) || sourcePage.content.toLowerCase().includes(emailKey);

          if (emailFoundOnPage) {
            validatedEmail = p.email;
            seenEmails.add(emailKey);
          }
          // If email wasn't on page, don't discard the prospect — just null the email
        }

        seenNames.add(nameKey);

        // Extract linkedin URL from the prospect data or source URL
        const linkedinUrl = p.linkedin_url
          || (p.source_url?.includes("linkedin.com/in/") ? p.source_url : null);

        extracted.push({
          name: p.name,
          email: validatedEmail,
          email_source_location: validatedEmail ? (p.email_source_location || "Found on page") : "",
          company: p.company,
          title: p.title || "",
          source_url: p.source_url || batch[0]?.url || "",
          evidence_of_fit: p.evidence_of_fit || "",
          summary: p.summary || `${p.title || ""} at ${p.company}`,
          confidence_score: p.confidence_score || 0.7,
          linkedin_url: linkedinUrl,
          twitter_url: p.twitter_url || null,
          intent_signals: p.intent_signals || [],
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
const SEARCH_WALL_CLOCK_MS = 80_000; // 80 seconds — leaves ~70s for drafting + DB writes
const PIPELINE_WALL_CLOCK_MS = 140_000; // 140 seconds — hard limit before Supabase kills the function (~150s)

async function stepIterativeSearch(
  icp: any,
  icpSettings: ICPSettings | null,
  desiredCount: number,
  maxSearchQueries: number,
  emit: (data: any) => void,
  supabase: any,
  campaignId: string,
  excludedEmails: Set<string> = new Set(),
  logActivity?: (step: string, message: string, detail?: any) => void,
  hypotheses?: Hypothesis[]
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

  // Generate initial batch of queries — now hypothesis-driven
  emit({ type: "status", text: `Generating signal-based search queries from ${hypotheses?.length || 0} hypotheses (target: ${desiredCount} prospects)...` });
  let allQueries = await stepGenerateQueries(icp, icpSettings, undefined, hypotheses);
  if (logActivity) {
    logActivity("source_discovery", `Generated ${allQueries.length} signal-based search strategies`, { queries: allQueries });
  }
  let queryIndex = 0;
  const BATCH_SIZE = 4;

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
      const moreQueries = await stepGenerateQueries(icp, icpSettings, validProspects, hypotheses);
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
- Use the prospect's evidence_of_fit, summary, AND intent_signals to personalize the opening. Intent signals are the strongest personalization — reference specific posts, launches, hiring activity, or complaints you discovered.
- One clear CTA per email.
- For follow-ups (step 2+), add new value or a different angle. NEVER "just bumping this" or "following up." Use different intent signals for each follow-up if available.
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

  // Company context — adapt to guided vs manual mode
  if (companyProfile) {
    const ga = companyProfile.guided_answers;
    if (companyProfile.settings_mode === "guided" && ga && (ga.what_building || ga.problem_solved)) {
      system += `ABOUT THE SENDER'S COMPANY (use this for all emails):
- What they're building: ${ga.what_building || ""}
- Problem they solve: ${ga.problem_solved || ""}
- Who has this problem: ${ga.who_has_problem || ""}
- Key message: ${companyProfile.key_message || ""}
- Tone: ${companyProfile.tone || "professional"}

IMPORTANT: Use this company info accurately. Do NOT make up features or benefits not listed above.
`;
    } else if (companyProfile.company_description) {
      system += `ABOUT THE SENDER'S COMPANY (use this for all emails):
- What we do: ${companyProfile.company_description}
- Problem we solve: ${companyProfile.problem_solved || companyProfile.problem_statement || ""}
${companyProfile.problem_statement ? `- Problem statement: ${companyProfile.problem_statement}` : ""}
${companyProfile.audience_description ? `- Target audience: ${companyProfile.audience_description}` : ""}
- Key message: ${companyProfile.key_message}
- Tone: ${companyProfile.tone}
${companyProfile.messaging_notes ? `- Messaging notes: ${companyProfile.messaging_notes}` : ""}

IMPORTANT: Use this company info accurately. Do NOT make up features or benefits not listed above.
`;
    }
  }
  }

  // Template mode is handled separately via direct replacement — this prompt is only for auto mode
  system += `\nEMAIL MODE: AUTO-GENERATED
Write original personalized emails from scratch using:
- The prospect's research summary, evidence_of_fit, and intent_signals for personalization
- Intent signals (posts, launches, hiring, complaints) are GOLD for openers — reference what they actually said or did
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
      intent_signals: p.intent_signals || [],
      linkedin_url: p.linkedin_url || null,
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
        const pipelineStart = Date.now();
        const hasTimeRemaining = (minMs: number) => (Date.now() - pipelineStart) < (PIPELINE_WALL_CLOCK_MS - minMs);

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
            problem_statement: companyProfileRow.problem_statement || "",
            audience_description: companyProfileRow.audience_description || "",
            signals: companyProfileRow.signals || [],
            settings_mode: companyProfileRow.settings_mode || "guided",
            guided_answers: companyProfileRow.guided_answers || {},
          } : null;

          // Settings gate: accept either guided answers or company description
          const hasGuidedSetup = companyProfile?.guided_answers?.what_building || companyProfile?.guided_answers?.problem_solved;
          const hasManualSetup = companyProfile?.company_description;
          if (!hasGuidedSetup && !hasManualSetup) {
            emit({ type: "error", error: "Please fill out your Settings before running a campaign. Mora needs to know what you're building to find the right prospects." });
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

          // ══ Agent 1: Hypothesis Generator ══
          emit({ type: "step", step: "icp_interpreter", message: "Analyzing your request and generating discovery hypotheses..." });

          const plan = await stepGenerateHypotheses(userPrompt, sequenceData, orgContext, companyProfile);
          const rawDesired = plan.desired_person_count || 20;
          const desiredCount = Math.min(rawDesired, maxProspects);

          // Extract hypotheses for downstream agents
          const hypotheses: Hypothesis[] = plan.hypotheses || [];

          if (plan.needs_clarification) {
            emit({ type: "step", step: "clarification", message: plan.clarification_question || "Could you describe the problem your product solves and who might experience it?" });
            emit({ type: "done" });
            controller.close();
            return;
          }

          // Log hypotheses
          if (hypotheses.length > 0) {
            for (const h of hypotheses) {
              emit({ type: "status", text: `Hypothesis: ${h.description}` });
            }
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
              problem_context: {
                hypotheses: hypotheses.map(h => ({
                  id: h.id,
                  description: h.description,
                  audience_type: h.audience_type,
                  signals: h.signals,
                })),
                problem: companyProfile?.problem_solved || companyProfile?.problem_statement || "",
                audience: companyProfile?.audience_description || "",
              },
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

          // Store hypotheses in DB
          if (hypotheses.length > 0) {
            const hypothesisInserts = hypotheses.map(h => ({
              campaign_id: campaign.id,
              hypothesis: h.description,
              search_queries: h.search_angles || [],
              source_type: "web",
              status: "pending",
            }));
            await supabase.from("agent_hypotheses").insert(hypothesisInserts);
          }

          logActivity("icp_interpreter", "Hypotheses generated", {
            hypothesis_count: hypotheses.length,
            hypotheses: hypotheses.map(h => h.description),
            roles: plan.icp?.roles || [],
            industries: plan.icp?.industries || [],
            relevance_signals: plan.relevance_signals || [],
          });

          // ══ Agent 2: Signal-Based Discovery ══
          emit({ type: "step", step: "source_discovery", message: `Generating signal-based search strategies from ${hypotheses.length || "your"} hypotheses...` });

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

          // ══ Agent 3: Prospect Harvester — PARALLEL discovery ══
          // Run SerpAPI search AND multi-source discovery (HN/Reddit/PH) in parallel
          emit({ type: "step", step: "prospect_harvester", message: `Harvesting prospects from web + community sources in parallel (target: ${desiredCount})...` });

          // Start multi-source discovery in parallel with main search (don't wait for SerpAPI to finish)
          const multiSourcePromise = hypotheses.length > 0
            ? runMultiSourceDiscovery(hypotheses, emitAndLog, logActivity)
            : Promise.resolve([] as ScrapedPage[]);

          const { prospects: extractedProspects, stats: searchStats } = await stepIterativeSearch(
            plan.icp || plan,
            icpSettings,
            desiredCount,
            maxSearchQueries,
            emitAndLog,
            supabase,
            campaign.id,
            excludedEmails,
            logActivity,
            hypotheses
          );

          logActivity("prospect_harvester", `SerpAPI harvesting: ${searchStats.queriesUsed} searches, ${extractedProspects.length} of ${desiredCount} prospects found`, {
            queries_used: searchStats.queriesUsed,
            pages_scraped: searchStats.pagesScraped,
            prospects_found: extractedProspects.length,
            stopped_reason: searchStats.stoppedReason,
          });

          // ══ Merge Multi-Source Discovery results ══
          // Only process if we have time remaining (need ~50s for qualification + drafting + DB writes)
          if (hasTimeRemaining(50_000)) {
            const multiSourcePages = await multiSourcePromise;
            if (multiSourcePages.length > 0 && hasTimeRemaining(45_000)) {
              // Build seen sets from existing prospects to avoid duplicates
              const msSeenEmails = new Set<string>(excludedEmails);
              const msSeenNames = new Set<string>();
              for (const p of extractedProspects) {
                if (p.email) msSeenEmails.add(p.email.toLowerCase());
                msSeenNames.add(p.name.toLowerCase());
              }

              // Limit pages to process based on remaining time
              const maxMultiPages = hasTimeRemaining(60_000) ? multiSourcePages.length : Math.min(multiSourcePages.length, 3);
              const pagesToProcess = multiSourcePages.slice(0, maxMultiPages);

              emit({ type: "status", text: `Extracting prospects from ${pagesToProcess.length} community source pages...` });
              const multiProspects = await extractProspectsFromPages(
                pagesToProcess,
                plan.icp || plan,
                icpSettings,
                msSeenEmails,
                msSeenNames,
                emitAndLog
              );

              // Tag discovery source and merge
              for (const p of multiProspects) {
                const url = p.source_url || "";
                if (url.includes("ycombinator") || url.includes("hn.algolia")) {
                  (p as any).discovery_source = "hackernews";
                } else if (url.includes("producthunt")) {
                  (p as any).discovery_source = "producthunt";
                } else if (url.includes("reddit")) {
                  (p as any).discovery_source = "reddit";
                }
                extractedProspects.push(p);
              }

              if (multiProspects.length > 0) {
                emitAndLog({ type: "status", text: `Community sources added ${multiProspects.length} new prospects (total: ${extractedProspects.length}).` });
              }
            } else if (multiSourcePages.length > 0) {
              emitAndLog({ type: "status", text: `Skipping community source extraction — not enough time remaining.` });
            }
          } else {
            emitAndLog({ type: "status", text: `Skipping multi-source merge — time budget tight.` });
          }

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
            const msg = `Could not find any prospects matching your criteria after ${searchStats.queriesUsed} searches. Try describing the problem differently or broadening the audience.`;
            emitAndLog({ type: "step", step: "clarification", message: msg });
            await supabase
              .from("agent_campaigns")
              .update({ status: "failed", warnings: [msg], updated_at: new Date().toISOString() })
              .eq("id", campaign.id);
            emit({ type: "done" });
            controller.close();
            return;
          }

          // Split prospects: those with email (actionable) vs without (surfaced for manual outreach)
          const prospectsWithEmail = extractedProspects.filter(p => p.email);
          const prospectsWithoutEmail = extractedProspects.filter(p => !p.email);

          if (prospectsWithoutEmail.length > 0) {
            emitAndLog({ type: "status", text: `Found ${prospectsWithEmail.length} prospects with email + ${prospectsWithoutEmail.length} without email (surfaced with LinkedIn/profile links).` });
          }

          // ══ Contact Discovery Agent ══
          // For prospects without email, attempt to find contact info via targeted search.
          // This runs within time budget — stops if wall clock is getting tight.
          if (prospectsWithoutEmail.length > 0 && SERP_API_KEY && hasTimeRemaining(40_000)) {
            const contactSearchStart = Date.now();
            const CONTACT_SEARCH_BUDGET_MS = 15_000; // 15 seconds max for contact discovery
            const maxContactSearches = Math.min(prospectsWithoutEmail.length, 5); // max 5 searches
            let contactFound = 0;

            emit({ type: "step", step: "prospect_harvester", message: `Searching for contact info for ${prospectsWithoutEmail.length} prospects without email...` });

            for (let ci = 0; ci < maxContactSearches; ci++) {
              if (Date.now() - contactSearchStart > CONTACT_SEARCH_BUDGET_MS) break;

              const p = prospectsWithoutEmail[ci];
              const contactQuery = `"${p.name}" "${p.company}" email contact`;

              try {
                const serpUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(contactQuery)}&api_key=${SERP_API_KEY}&num=3`;
                const serpRes = await fetch(serpUrl);
                if (!serpRes.ok) continue;
                const serpData = await serpRes.json();

                const contactResults = (serpData.organic_results || []).slice(0, 2);
                for (const result of contactResults) {
                  const pageUrl = result.link || "";
                  if (/\.(pdf|jpg|png|gif|mp4|zip)$/i.test(pageUrl)) continue;

                  const content = await fetchPageContent(pageUrl);
                  const emails = extractEmailsFromText(content);

                  if (emails.length > 0) {
                    // Try to match an email to this person (check if their name parts appear near the email)
                    const nameParts = p.name.toLowerCase().split(" ");
                    const matchedEmail = emails.find(e => {
                      const localPart = e.split("@")[0].toLowerCase();
                      return nameParts.some(part => localPart.includes(part));
                    }) || emails[0]; // fallback to first email on page

                    // Move prospect from no-email to with-email
                    p.email = matchedEmail;
                    p.email_source_location = `Found via contact search on ${pageUrl}`;

                    // Update the arrays
                    const idx = prospectsWithoutEmail.indexOf(p);
                    if (idx > -1) prospectsWithoutEmail.splice(idx, 1);
                    prospectsWithEmail.push(p);
                    contactFound++;

                    logActivity("prospect_harvester", `Found email for ${p.name}: ${matchedEmail}`, {
                      source: pageUrl,
                      method: "contact_discovery_search",
                    });
                    break; // found email, move to next prospect
                  }
                }

                await new Promise(r => setTimeout(r, 300)); // rate limit
              } catch {
                // Silent failure — contact discovery is best-effort
              }
            }

            if (contactFound > 0) {
              emitAndLog({ type: "status", text: `Contact discovery found emails for ${contactFound} additional prospects.` });
            }
          }

          // ══ Hunter.io Email Enrichment ══
          // For remaining prospects without email, try Hunter.io as a last resort
          if (prospectsWithoutEmail.length > 0 && HUNTER_API_KEY && hasTimeRemaining(30_000)) {
            emit({ type: "status", text: `Trying Hunter.io for ${prospectsWithoutEmail.length} prospects without email...` });
            const hunterFound = await enrichWithHunter(prospectsWithoutEmail, emitAndLog, logActivity);

            if (hunterFound > 0) {
              // Move newly enriched prospects to the with-email list
              const newlyEnriched = prospectsWithoutEmail.filter(p => p.email);
              for (const p of newlyEnriched) {
                const idx = prospectsWithoutEmail.indexOf(p);
                if (idx > -1) prospectsWithoutEmail.splice(idx, 1);
                prospectsWithEmail.push(p);
              }
              emitAndLog({ type: "status", text: `Hunter.io found emails for ${hunterFound} additional prospects.` });
            }
          }

          // ══ Introduction Suggestions ══
          // For strong candidates without email, suggest asking shared connections for introductions
          if (prospectsWithoutEmail.length > 0 && prospectsWithEmail.length > 0) {
            for (const noEmail of prospectsWithoutEmail) {
              if ((noEmail.confidence_score || 0) < 0.8) continue; // only for strong candidates
              // Find a prospect WITH email at the same company or a closely related one
              const sameCompany = prospectsWithEmail.find(
                p => p.company && noEmail.company &&
                  p.company.toLowerCase() === noEmail.company.toLowerCase() &&
                  p.name !== noEmail.name
              );
              if (sameCompany) {
                (noEmail as any).introduction_suggestion = {
                  via_person: sameCompany.name,
                  via_company: sameCompany.company,
                  relationship: "same company",
                  reason: `${sameCompany.name} works at ${sameCompany.company} and may be able to introduce you to ${noEmail.name}.`,
                };
              }
            }
          }

          // ══ Agent 5: Research Summary ══
          emit({ type: "step", step: "research_summary", message: `Building evidence for ${extractedProspects.length} prospects...` });

          // Summaries are already generated per-prospect during extraction (evidence_of_fit + summary fields)
          for (const p of extractedProspects) {
            logActivity("research_summary", `${p.name} — ${p.title} at ${p.company}${p.email ? "" : " (no email)"}`, {
              prospect_name: p.name,
              company: p.company,
              source_url: p.source_url,
              summary: p.summary,
              evidence_of_fit: p.evidence_of_fit,
              has_email: !!p.email,
              intent_signals: p.intent_signals || [],
            });
          }

          emitAndLog({ type: "status", text: `Evidence built for ${extractedProspects.length} prospects (${prospectsWithEmail.length} with email, ${prospectsWithoutEmail.length} profile-only).` });

          // ── Store ALL prospects (with and without email) ──
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
            status: p.email ? "enriched" : "no_email",
            risk_flags: [],
            discovery_source: (p as any).discovery_source || "web",
            contact_methods: {
              ...(p.email ? { email: p.email } : {}),
              ...(p.linkedin_url ? { linkedin: p.linkedin_url } : {}),
              ...(p.twitter_url ? { twitter: p.twitter_url } : {}),
            },
            intent_signals: p.intent_signals || [],
            evidence_chain: [
              {
                signal: p.evidence_of_fit,
                source: p.source_url,
                url: p.source_url,
                relevance: p.summary,
              },
              ...(p.intent_signals || []).map((s: any) => ({
                signal: s.text,
                source: s.source_url,
                url: s.source_url,
                relevance: s.type,
              })),
            ],
            enrichment: {
              evidence_of_fit: p.evidence_of_fit,
              summary: p.summary,
              source_url: p.source_url,
            },
            ...((p as any).introduction_suggestion ? { introduction_suggestion: (p as any).introduction_suggestion } : {}),
          }));

          const { data: insertedProspects, error: prospErr } = await supabase
            .from("agent_prospects")
            .insert(prospectInserts)
            .select("id, name, email, company, title, linkedin_url, source, source_url, email_source_location, evidence_of_fit, summary, confidence_score, status, risk_flags, enrichment, contact_methods, intent_signals, evidence_chain");

          if (prospErr) throw new Error(`Failed to store prospects: ${prospErr.message}`);

          await supabase
            .from("agent_campaigns")
            .update({ status: "drafting", updated_at: new Date().toISOString() })
            .eq("id", campaign.id);

          emit({
            type: "prospects",
            prospects: insertedProspects || [],
          });

          // ── Step 4: Email Drafting (only for prospects with email) ──
          const foundCount = extractedProspects.length;
          const emailableCount = prospectsWithEmail.length;
          emitAndLog({ type: "step", step: "drafting", message: `Generating personalized emails for ${emailableCount} prospects with email (${prospectsWithoutEmail.length} surfaced without email)...` });

          // ── Two explicit drafting modes (only for prospects WITH email) ──
          // Build index mapping: prospectsWithEmail[i] -> insertedProspects DB id
          const allInserted = insertedProspects || [];
          const emailProspectDbIds: string[] = [];
          for (const ip of allInserted) {
            if (ip.email) emailProspectDbIds.push(ip.id);
          }

          let emailDrafts: any[];
          if (emailableCount === 0) {
            emailDrafts = [];
            emitAndLog({ type: "status", text: "No prospects with email — skipping email drafting. Prospects are surfaced with profile links for manual outreach." });
          } else if (resolvedEmailMode === "template" && sequenceData && sequenceData.steps.length > 0) {
            emitAndLog({ type: "status", text: `Using template sequence (${sequenceData.steps.length} steps) — replacing placeholders with prospect data...` });
            emailDrafts = stepDraftTemplate(prospectsWithEmail, sequenceData);
          } else {
            emailDrafts = await stepDraftAuto(prospectsWithEmail, companyProfile, plan);
          }

          // Store drafts — map prospect_index to emailProspectDbIds
          const prospectIds = emailProspectDbIds;
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
            const retryDrafts = await stepDraftAuto(prospectsWithEmail, companyProfile, plan);
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
