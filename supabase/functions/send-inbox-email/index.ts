// @ts-nocheck

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { to, subject, html, organization_email_id, customer_id, organization_id, user_id, in_reply_to_log_id } = await req.json();

    if (!to || !subject || !html || !organization_email_id || !organization_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: to, subject, html, organization_email_id, organization_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check billing allowance
    const { data: allowance } = await supabase.rpc("check_email_allowance", { org_id: organization_id });
    if (allowance && !allowance.allowed) {
      return new Response(
        JSON.stringify({ error: allowance.reason || "Email limit reached" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve sender from organization_emails
    const { data: orgEmail } = await supabase
      .from("organization_emails")
      .select("email, display_name, reply_to")
      .eq("id", organization_email_id)
      .single();

    if (!orgEmail) {
      return new Response(
        JSON.stringify({ error: "Sender email not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const fromAddress = orgEmail.display_name
      ? `${orgEmail.display_name} <${orgEmail.email}>`
      : orgEmail.email;

    // Look up customer info for the log
    let customerEmail = to;
    let customerName = "";
    if (customer_id) {
      const { data: customer } = await supabase
        .from("customers")
        .select("email, first_name, last_name")
        .eq("id", customer_id)
        .single();
      if (customer) {
        customerEmail = customer.email;
        customerName = [customer.first_name, customer.last_name].filter(Boolean).join(" ");
      }
    }

    // Look up parent email for threading headers
    let parentResendId: string | null = null;
    if (in_reply_to_log_id) {
      const { data: parentLog } = await supabase
        .from("email_logs")
        .select("resend_id")
        .eq("id", in_reply_to_log_id)
        .maybeSingle();
      if (parentLog?.resend_id) {
        parentResendId = parentLog.resend_id;
      }
    }

    // Send via Resend
    const emailPayload: Record<string, any> = {
      from: fromAddress,
      to,
      subject,
      html,
    };
    if (orgEmail.reply_to) {
      emailPayload.reply_to = orgEmail.reply_to;
    }
    // Set In-Reply-To and References headers for proper email threading
    if (parentResendId) {
      emailPayload.headers = {
        "In-Reply-To": `<${parentResendId}@resend.dev>`,
        "References": `<${parentResendId}@resend.dev>`,
      };
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify(emailPayload),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      // Log the failed attempt
      await supabase.from("email_logs").insert({
        customer_id: customer_id || null,
        customer_email: customerEmail,
        customer_name: customerName,
        template_id: null,
        status: "failed",
        error_message: resendData.message || "Resend API error",
        user_id: user_id || null,
        organization_id,
        subject,
        body: html,
        sender_email: fromAddress,
        in_reply_to_log_id: in_reply_to_log_id || null,
      });

      return new Response(
        JSON.stringify({ error: resendData.message || "Failed to send email" }),
        { status: resendResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log the successful send
    const { data: logEntry } = await supabase.from("email_logs").insert({
      customer_id: customer_id || null,
      customer_email: customerEmail,
      customer_name: customerName,
      template_id: null,
      status: "sent",
      sent_at: new Date().toISOString(),
      resend_id: resendData.id,
      user_id: user_id || null,
      organization_id,
      subject,
      body: html,
      sender_email: fromAddress,
      in_reply_to_log_id: in_reply_to_log_id || null,
    }).select("id").single();

    // Increment email usage
    const currentMonth = new Date().toISOString().slice(0, 7);
    await supabase.rpc("increment_email_usage", {
      org_id: organization_id,
      send_month: currentMonth,
      count: 1,
    });

    return new Response(
      JSON.stringify({ success: true, email_log_id: logEntry?.id, resend_id: resendData.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
