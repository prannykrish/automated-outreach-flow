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

// Tool definitions for Claude
const TOOLS = [
  {
    name: "get_templates",
    description: "Fetch all email templates for the user's organization. Returns template names, subjects, bodies, and stages.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_sequences",
    description: "Fetch all email sequences for the organization, including their steps (templates, delays, order).",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_customers",
    description: "Search or list customers in the organization's pipeline. Can filter by status or search by name/email.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Optional search term to filter by name, email, or firm" },
        status: { type: "string", description: "Optional status filter: not_started, in_progress, completed, replied, bounced" },
        limit: { type: "number", description: "Max results to return. Default 50." },
      },
      required: [],
    },
  },
  {
    name: "get_pipeline_stats",
    description: "Get aggregated pipeline statistics: customer counts by status, total customers, active sequences.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_email_stats",
    description: "Get email sending statistics: total sent, delivered, opened, replied, bounced counts from recent email logs.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_email_logs",
    description: "Get detailed email send logs with customer info, status, open/reply timestamps. Use this when the user wants to see individual email activity, not just aggregated stats.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status: sent, delivered, opened, replied, bounced, failed" },
        customer_id: { type: "string", description: "Filter logs for a specific customer by their ID" },
        limit: { type: "number", description: "Max results. Default 50." },
      },
      required: [],
    },
  },
  {
    name: "get_scheduled_sends",
    description: "Get upcoming and past scheduled email sends. Shows what emails are queued, when they'll go out, and their status.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status: pending, sent, cancelled" },
        limit: { type: "number", description: "Max results. Default 50." },
      },
      required: [],
    },
  },
  {
    name: "get_sender_emails",
    description: "Get the organization's configured sender email addresses, display names, and reply-to addresses.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_domains",
    description: "Get the organization's email sending domains, their verification status, and DNS records.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_organization_info",
    description: "Get organization details: name, plan, billing status, limits (email limit, member limit, domain limit), trial info.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_email_usage",
    description: "Get the organization's email sending usage by month — how many emails sent vs their plan limit.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_team_members",
    description: "Get all team members in the organization with their roles.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_template_folders",
    description: "Get all template folders and the templates inside each folder.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_custom_placeholders",
    description: "Get all custom merge field placeholders the organization has defined for email personalization.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

// Execute a tool call against Supabase
async function executeTool(toolName: string, toolInput: any, orgId: string) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  switch (toolName) {
    case "get_templates": {
      const { data } = await supabase
        .from("email_templates")
        .select("id, name, subject, body, stage, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(50);
      return data || [];
    }
    case "get_sequences": {
      const { data: sequences } = await supabase
        .from("email_sequences")
        .select("id, name, description, created_at, updated_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false });

      if (!sequences?.length) return [];

      const { data: steps } = await supabase
        .from("sequence_steps")
        .select("id, sequence_id, step_order, template_id, delay_days, email_templates(name, subject)")
        .in("sequence_id", sequences.map((s) => s.id))
        .order("step_order", { ascending: true });

      return sequences.map((seq) => ({
        ...seq,
        steps: (steps || []).filter((s) => s.sequence_id === seq.id),
      }));
    }
    case "get_customers": {
      let query = supabase
        .from("customers")
        .select("id, first_name, last_name, email, firm_name, status, created_at")
        .eq("organization_id", orgId);

      if (toolInput.search) {
        query = query.or(
          `first_name.ilike.%${toolInput.search}%,last_name.ilike.%${toolInput.search}%,email.ilike.%${toolInput.search}%,firm_name.ilike.%${toolInput.search}%`
        );
      }
      if (toolInput.status) {
        query = query.eq("status", toolInput.status);
      }

      const { data } = await query
        .order("created_at", { ascending: false })
        .limit(toolInput.limit || 50);
      return data || [];
    }
    case "get_pipeline_stats": {
      const { data: customers } = await supabase
        .from("customers")
        .select("status")
        .eq("organization_id", orgId);

      if (!customers) return { total: 0 };

      const stats: Record<string, number> = {};
      for (const c of customers) {
        stats[c.status] = (stats[c.status] || 0) + 1;
      }
      return { total: customers.length, by_status: stats };
    }
    case "get_email_stats": {
      const { data: logs } = await supabase
        .from("email_logs")
        .select("status, event")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(500);

      if (!logs) return { total: 0 };

      const stats: Record<string, number> = {};
      for (const l of logs) {
        const key = l.event || l.status || "unknown";
        stats[key] = (stats[key] || 0) + 1;
      }
      return { total: logs.length, by_event: stats };
    }
    case "get_email_logs": {
      let query = supabase
        .from("email_logs")
        .select("id, customer_id, customer_email, customer_name, status, sent_at, opened_at, replied_at, error_message, template_id, created_at, email_templates(name, subject)")
        .eq("organization_id", orgId);

      if (toolInput.status) {
        query = query.eq("status", toolInput.status);
      }
      if (toolInput.customer_id) {
        query = query.eq("customer_id", toolInput.customer_id);
      }

      const { data } = await query
        .order("created_at", { ascending: false })
        .limit(toolInput.limit || 50);
      return data || [];
    }
    case "get_scheduled_sends": {
      let query = supabase
        .from("scheduled_sends")
        .select("id, customer_id, step_id, scheduled_for, sent_at, status, created_at, customers(first_name, last_name, email), sequence_steps(step_order, email_templates(name, subject))")
        .eq("organization_id", orgId);

      if (toolInput.status) {
        query = query.eq("status", toolInput.status);
      }

      const { data } = await query
        .order("scheduled_for", { ascending: true })
        .limit(toolInput.limit || 50);
      return data || [];
    }
    case "get_sender_emails": {
      const { data } = await supabase
        .from("organization_emails")
        .select("id, email, display_name, reply_to, is_default, created_at")
        .eq("organization_id", orgId);
      return data || [];
    }
    case "get_domains": {
      const { data } = await supabase
        .from("organization_domains")
        .select("id, domain, status, verified, verified_at, created_at")
        .eq("organization_id", orgId);
      return data || [];
    }
    case "get_organization_info": {
      const { data } = await supabase
        .from("organizations")
        .select("id, name, plan, billing_status, plan_email_limit, plan_member_limit, plan_domain_limit, plan_email_address_limit, trial_ends_at, current_period_start, current_period_end, created_at")
        .eq("id", orgId)
        .single();
      return data || {};
    }
    case "get_email_usage": {
      const { data } = await supabase
        .from("email_usage")
        .select("month, emails_sent, updated_at")
        .eq("organization_id", orgId)
        .order("month", { ascending: false })
        .limit(12);

      // Also get the plan limit for context
      const { data: org } = await supabase
        .from("organizations")
        .select("plan_email_limit, plan")
        .eq("id", orgId)
        .single();

      return { usage: data || [], plan_limit: org?.plan_email_limit, plan: org?.plan };
    }
    case "get_team_members": {
      const { data } = await supabase
        .from("organization_members")
        .select("id, role, created_at, user_id, users(email, first_name, last_name, name)")
        .eq("organization_id", orgId);
      return data || [];
    }
    case "get_template_folders": {
      const { data: folders } = await supabase
        .from("template_folders")
        .select("id, name, created_at")
        .eq("organization_id", orgId)
        .order("name", { ascending: true });

      if (!folders?.length) return [];

      const { data: templates } = await supabase
        .from("email_templates")
        .select("id, name, subject, stage, folder_id")
        .eq("organization_id", orgId)
        .in("folder_id", folders.map((f) => f.id));

      return folders.map((folder) => ({
        ...folder,
        templates: (templates || []).filter((t) => t.folder_id === folder.id),
      }));
    }
    case "get_custom_placeholders": {
      const { data } = await supabase
        .from("custom_placeholders")
        .select("id, name, description, created_at")
        .eq("organization_id", orgId)
        .order("name", { ascending: true });
      return data || [];
    }
    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

function buildSystemPrompt(contextPage?: string) {
  let prompt = `You are Mora — a cold outbound strategist built into an email outreach platform. You talk like a sharp founder friend who's sent 100k+ cold emails and actually knows what converts. You're not a chatbot. You're the person they'd hire if they could afford a $300k/yr head of outbound.

## How you talk
- Casual, direct, zero fluff. Like texting a smart friend who happens to be an outbound expert.
- Never say "Great question!" or "I'd be happy to help!" or any corporate filler. Just get to the point.
- Short paragraphs. Use line breaks generously. Nobody reads walls of text.
- No emojis unless it genuinely adds something (rare). Never use 🚀 or 💡 or clapping hands.

## Formatting rules (CRITICAL — you MUST follow these every single time, no exceptions)

### Bullet points
ANY time you list multiple points under a heading (e.g. "What's working", "What needs work", pros, cons, feedback, suggestions, observations), you MUST use markdown bullet points with the - character. NEVER write them as separate paragraphs. This is the #1 most important formatting rule.

CORRECT:
### What's working
- **Subject line is solid.** Feels human, not salesy.
- **Origin story is genuine.** "I built this for myself" disarms people.
- **CTA is low-pressure.** "Or not really your thing?" gives an easy out.

WRONG (never do this):
### What's working
**Subject line is solid.** Feels human, not salesy.
**Origin story is genuine.** "I built this for myself" disarms people.
**CTA is low-pressure.** "Or not really your thing?" gives an easy out.

### Other formatting
- Use ## and ### headers to break content into clear sections.
- Use **bold** to lead each bullet — bold the key phrase, then explain.
- When presenting data or comparisons, use a markdown table (each row on its own line).
- When quoting the user's email copy, use > blockquotes.
- Use --- horizontal rules between major sections in longer analyses.
- When writing email copy for the user: **Subject:** on its own line, then the body in a > blockquote.
- Keep it concise. Each bullet should be 1-2 sentences max.
- Your responses should look like a well-formatted Notion doc — scannable, structured, professional.

## What you know deeply
- Cold email that actually gets replies: subject lines, openers, CTAs, personalization at scale
- Human psychology behind why people open, read, and respond to cold outreach
- The difference between emails that feel like spam vs emails that feel like they came from a real person
- Founder-led sales — you know the user is probably a founder or early sales hire, not an enterprise SDR team
- Sequence strategy: when to follow up, how many touches, when to break up, how to re-engage
- Targeting: how to think about ICP, how to write differently for CEOs vs VPs vs ICs
- Deliverability basics: what tanks your open rates, domain warming, spam triggers

## How you work
- You have tools to pull the user's actual data: templates, sequences, customers, pipeline stats, email logs, scheduled sends, sender emails, domains, org info, email usage, team members, template folders, and custom placeholders. USE THEM. Don't give generic advice when you can look at their real data.
- When analyzing templates, be specific and opinionated. Say what's working, what's not, and rewrite the weak parts. Don't just list "suggestions."
- When writing emails, write like a human — not a marketer. The best cold emails feel like they were written by one person to one person.
- When you write email copy, format it clearly with **Subject:** and **Body:** on separate lines so they can copy-paste it directly.
- If something is bad, say so directly but constructively. "This subject line is generic and will get ignored — here's why" is better than "You might consider adjusting your subject line."

## Key principles you live by
- The #1 rule of cold email: would you reply to this if you received it? If not, rewrite it.
- Personalization > templates. But good templates with merge fields beat bad personalization.
- Short > long. The ideal cold email is 3-5 sentences. Every word earns the next word.
- One CTA per email. Never ask two things.
- Subject lines should feel like they came from a colleague, not a newsletter.
- Follow-ups should add new value or angles, not just "bumping this up" or "circling back."
- The breakup email is one of the highest-converting emails in any sequence — don't skip it.`;

  if (contextPage) {
    const pageDescriptions: Record<string, string> = {
      "/templates": "their email templates page — they may want help writing, improving, or analyzing templates",
      "/sequences": "their email sequences page — they may want help with sequence strategy, timing, or follow-up structure",
      "/customers": "the add customers page — they may want help with customer targeting or import strategy",
      "/pipeline": "their pipeline page — they may want to understand their outreach progress and conversion rates",
      "/insights": "the insights/analytics page — they may want to understand their email performance metrics",
      "/agent": "the agent chat page — they're here specifically to chat with you",
    };
    const desc = pageDescriptions[contextPage] || `the ${contextPage} page`;
    prompt += `\n\nThe user is currently viewing ${desc}.`;
  }

  return prompt;
}

// Call Claude via Bedrock using aws4fetch for signing
async function invokeBedrockModel(messages: any[], systemPrompt: string) {
  const url = `https://bedrock-runtime.${AWS_REGION}.amazonaws.com/model/${encodeURIComponent(BEDROCK_MODEL_ID)}/invoke`;

  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 4096,
    system: systemPrompt,
    tools: TOOLS,
    messages,
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

  return await response.json();
}

// Call Claude via Bedrock (non-streaming), handling tool use loops
async function callClaude(
  messages: any[],
  orgId: string,
  contextPage?: string
): Promise<ReadableStream> {
  const encoder = new TextEncoder();
  const systemPrompt = buildSystemPrompt(contextPage);

  return new ReadableStream({
    async start(controller) {
      let currentMessages = [...messages];
      let continueLoop = true;

      while (continueLoop) {
        continueLoop = false;

        let response;
        try {
          response = await invokeBedrockModel(currentMessages, systemPrompt);
        } catch (err) {
          console.error("Bedrock call error:", err);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: String(err) })}\n\n`)
          );
          controller.close();
          return;
        }

        // Extract text and tool use blocks from response
        const toolUseBlocks: any[] = [];
        let textContent = "";

        for (const block of response.content) {
          if (block.type === "text") {
            textContent += block.text;
          } else if (block.type === "tool_use") {
            toolUseBlocks.push({
              id: block.id,
              name: block.name,
              input: block.input,
            });
          }
        }

        // Send text to client
        if (textContent) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "text", text: textContent })}\n\n`)
          );
        }

        // If Claude used tools, execute them and continue the loop
        if (response.stop_reason === "tool_use" && toolUseBlocks.length > 0) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "status", text: "Looking up your data..." })}\n\n`)
          );

          currentMessages.push({ role: "assistant", content: response.content });

          const toolResults: any[] = [];
          for (const tool of toolUseBlocks) {
            const toolResult = await executeTool(tool.name, tool.input, orgId);
            toolResults.push({
              type: "tool_result",
              tool_use_id: tool.id,
              content: JSON.stringify(toolResult),
            });
          }

          currentMessages.push({ role: "user", content: toolResults });
          continueLoop = true;
        }
      }

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
      controller.close();
    },
  });
}

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

    const { messages, organizationId, conversationId, contextPage } = await req.json();

    if (!messages || !organizationId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: messages, organizationId" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const stream = await callClaude(messages, organizationId, contextPage);

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: corsHeaders }
    );
  }
});
