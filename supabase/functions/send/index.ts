import { serve } from "https://deno.land/std@0.208.0/http/server.ts";

declare const Deno: any;

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

interface SendEmailRequest {
  to: string | string[];
  from?: string;
  subject?: string; // Now optional for follow-up emails
  html?: string;
  text?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  inReplyTo?: string; // Message-ID of the email being replied to
  references?: string; // For threading
}

const defaultFromEmail = "noreply@automated-outreach.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req: Request) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: corsHeaders }
      );
    }

    const payload: SendEmailRequest = await req.json();

    // Validate required fields - subject is only required if not a reply
    if (!payload.to) {
      return new Response(
        JSON.stringify({ error: "Missing required field: to" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Subject is required only for new threads (not replies)
    if (!payload.subject && !payload.inReplyTo) {
      return new Response(
        JSON.stringify({ error: "Subject is required for new emails (not replies)" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!payload.html && !payload.text) {
      return new Response(
        JSON.stringify({ error: "Either html or text content is required" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY not configured" }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Build the email payload
    const emailPayload: Record<string, any> = {
      from: payload.from || defaultFromEmail,
      to: payload.to,
      html: payload.html,
      text: payload.text,
      reply_to: payload.replyTo,
      cc: payload.cc,
      bcc: payload.bcc,
    };

    // Only include subject if provided
    if (payload.subject) {
      emailPayload.subject = payload.subject;
    }

    // Include threading headers for replies
    if (payload.inReplyTo) {
      emailPayload.headers = {
        "In-Reply-To": payload.inReplyTo,
        "References": payload.references || payload.inReplyTo,
      };
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify(emailPayload),
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          error: "Failed to send email",
          details: data,
        }),
        { status: response.status, headers: corsHeaders }
      );
    }

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: corsHeaders }
    );
  }
});