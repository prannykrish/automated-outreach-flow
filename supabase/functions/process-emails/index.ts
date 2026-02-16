// @ts-nocheck
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function replacePlaceholders(content: string, customer: any): string {
  if (!content) return "";
  let result = content
    .replace(/\[First Name\]/g, customer.first_name || "")
    .replace(/\[Last Name\]/g, customer.last_name || "")
    .replace(/\[Full Name\]/g,
      [customer.first_name, customer.last_name].filter(Boolean).join(" ") || "")
    .replace(/\[Firm Name\]/g, customer.firm_name || "");

  // Replace custom placeholders from customer.custom_fields JSONB
  const customFields = customer.custom_fields || {};
  result = result.replace(/\[([^\]]+)\]/g, (match: string, key: string) => {
    return customFields[key] !== undefined ? customFields[key] : match;
  });
  return result;
}

serve(async (req: Request) => {
  console.log("=== Function invoked ===");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    console.log("ENV check - RESEND:", !!RESEND_API_KEY, "URL:", !!SUPABASE_URL, "KEY:", !!SUPABASE_SERVICE_ROLE_KEY);

    if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("Missing env vars");
      return new Response(
        JSON.stringify({ error: "Missing environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const now = new Date().toISOString();
    console.log("Checking for emails due before:", now);

    const { data: scheduledSends, error: fetchError } = await supabase
      .from("scheduled_sends")
      .select(`
        *,
        customers(*),
        sequence_steps(
          *,
          email_templates(*),
          email_sequences(
            organization_email_id,
            organization_emails(email, display_name, reply_to)
          )
        )
      `)
      .lte("scheduled_for", now)
      .eq("status", "pending")
      .limit(50);

    if (fetchError) {
      console.error("DB fetch error:", fetchError.message);
      return new Response(
        JSON.stringify({ error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Found pending emails:", scheduledSends?.length || 0);

    if (!scheduledSends || scheduledSends.length === 0) {
      return new Response(
        JSON.stringify({ message: "No emails to send", sent: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results = [];

    // Check billing allowance per organization before sending
    const orgIds = [...new Set(scheduledSends.map((s: any) => s.organization_id).filter(Boolean))];
    const blockedOrgs = new Set<string>();
    const currentMonth = new Date().toISOString().slice(0, 7); // "YYYY-MM"

    for (const orgId of orgIds) {
      const { data: allowance } = await supabase.rpc("check_email_allowance", { org_id: orgId });
      if (allowance && !allowance.allowed) {
        console.log(`Org ${orgId} blocked: ${allowance.reason}`);
        blockedOrgs.add(orgId);
      }
    }

    for (const scheduled of scheduledSends) {
      // Block sends for orgs that failed billing check
      if (scheduled.organization_id && blockedOrgs.has(scheduled.organization_id)) {
        await supabase.from("scheduled_sends").update({ status: "failed" }).eq("id", scheduled.id);
        await supabase.from("email_logs").insert({
          customer_id: scheduled.customers?.id,
          customer_email: scheduled.customers?.email,
          customer_name: [scheduled.customers?.first_name, scheduled.customers?.last_name].filter(Boolean).join(" "),
          template_id: scheduled.sequence_steps?.email_templates?.id,
          status: "failed",
          error_message: "Billing limit reached or subscription inactive",
          user_id: scheduled.user_id || null,
          organization_id: scheduled.organization_id || null,
        });
        results.push({ email: scheduled.customers?.email, status: "blocked", reason: "billing" });
        continue;
      }
      const customer = scheduled.customers;
      const step = scheduled.sequence_steps;
      const template = step?.email_templates;

      console.log("Processing:", customer?.email, "Template:", template?.name);

      if (!customer || !template) {
        console.log("Skipping - missing customer or template");
        await supabase.from("scheduled_sends").update({ status: "failed" }).eq("id", scheduled.id);
        continue;
      }

      if (customer.paused) {
        console.log("Skipping - customer paused");
        continue;
      }

      const subject = replacePlaceholders(template.subject || "", customer);
      const body = replacePlaceholders(template.body || "", customer);
      const isFollowUp = step.step_order > 0;

      let emailSubject = subject;

      if (isFollowUp) {
        const { data: firstEmail } = await supabase
          .from("email_logs")
          .select("resend_id, email_templates(subject)")
          .eq("customer_id", customer.id)
          .eq("status", "sent")
          .order("sent_at", { ascending: true })
          .limit(1)
          .single();

        if (firstEmail?.email_templates?.subject) {
          emailSubject = `Re: ${replacePlaceholders(firstEmail.email_templates.subject, customer)}`;
        }
      }

      try {
        // Resolve the "from" address and reply-to from the sequence's organization email
        let fromAddress = Deno.env.get("DEFAULT_FROM_EMAIL") || "noreply@example.com";
        let replyTo: string | undefined;
        const orgEmail = step?.email_sequences?.organization_emails;
        if (orgEmail) {
          fromAddress = orgEmail.display_name
            ? `${orgEmail.display_name} <${orgEmail.email}>`
            : orgEmail.email;
          if (orgEmail.reply_to) {
            replyTo = orgEmail.reply_to;
          }
        }

        console.log("Sending to:", customer.email, "From:", fromAddress, "Subject:", emailSubject, "ReplyTo:", replyTo || "none");

        const emailPayload: Record<string, any> = {
          from: fromAddress,
          to: customer.email,
          subject: emailSubject,
          html: body.replace(/\n/g, "<br>"),
          text: body,
        };
        if (replyTo) {
          emailPayload.reply_to = replyTo;
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
        console.log("Resend response:", resendResponse.status, JSON.stringify(resendData));

        if (!resendResponse.ok) {
          throw new Error(resendData.message || "Resend API error");
        }

        await supabase.from("scheduled_sends").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", scheduled.id);
        await supabase.from("email_logs").insert({
          customer_id: customer.id,
          customer_email: customer.email,
          customer_name: [customer.first_name, customer.last_name].filter(Boolean).join(" "),
          template_id: template.id,
          status: "sent",
          sent_at: new Date().toISOString(),
          resend_id: resendData.id,
          user_id: customer.user_id || null,
          organization_id: customer.organization_id || null,
        });

        // Increment email usage counter for billing
        if (customer.organization_id) {
          await supabase.rpc("increment_email_usage", {
            org_id: customer.organization_id,
            send_month: currentMonth,
            count: 1,
          });
        }

        if (step.step_order === 0) {
          await supabase.from("customers").update({ status: "contacted" }).eq("id", customer.id);
        }

        const { data: nextStep } = await supabase.from("sequence_steps").select("*").eq("sequence_id", step.sequence_id).eq("step_order", step.step_order + 1).single();

        if (nextStep) {
          const nextDate = new Date();
          nextDate.setDate(nextDate.getDate() + (nextStep.delay_days || 0));
          nextDate.setHours(nextDate.getHours() + (nextStep.delay_hours || 0));
          await supabase.from("scheduled_sends").insert({
            customer_id: customer.id,
            step_id: nextStep.id,
            scheduled_for: nextDate.toISOString(),
            status: "pending",
            user_id: customer.user_id || null,
            organization_id: customer.organization_id || null,
          });
          await supabase.from("customers").update({ current_step_id: nextStep.id }).eq("id", customer.id);
        }

        results.push({ email: customer.email, status: "sent" });

      } catch (err: any) {
        console.error("Send failed:", err.message);
        await supabase.from("scheduled_sends").update({ status: "failed" }).eq("id", scheduled.id);
        await supabase.from("email_logs").insert({
          customer_id: customer.id,
          customer_email: customer.email,
          customer_name: [customer.first_name, customer.last_name].filter(Boolean).join(" "),
          template_id: template.id,
          status: "failed",
          error_message: err.message,
          user_id: customer.user_id || null,
          organization_id: customer.organization_id || null,
        });
        results.push({ email: customer.email, status: "failed", error: err.message });
      }
    }

    console.log("=== Done ===", results);
    return new Response(
      JSON.stringify({ message: "Done", processed: results.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Fatal error:", error.message);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});