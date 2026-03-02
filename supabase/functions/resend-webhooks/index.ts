// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function handleInboundEmail(event: any, supabase: any) {
  const data = event.data;
  const emailId = data.email_id;
  const fromRaw = data.from || "";
  const toAddresses = data.to || [];
  const subject = data.subject || null;

  // Parse sender name and email from "Name <email>" format
  const fromMatch = fromRaw.match(/^(.+?)\s*<(.+?)>$/);
  const fromName = fromMatch ? fromMatch[1].trim() : null;
  const fromEmail = fromMatch ? fromMatch[2].trim() : fromRaw.trim();

  // Get the first "to" address
  const toEmail = (Array.isArray(toAddresses) ? toAddresses[0] : toAddresses) || "";

  console.log("Processing inbound email:", { emailId, fromEmail, toEmail, subject });

  // Fetch full email content from Resend API
  let html = null;
  let textBody = null;
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (resendApiKey && emailId) {
    try {
      const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
        headers: { Authorization: `Bearer ${resendApiKey}` },
      });
      if (res.ok) {
        const emailData = await res.json();
        html = emailData.html || null;
        textBody = emailData.text || null;
      } else {
        console.error("Failed to fetch inbound email content:", res.status, await res.text());
      }
    } catch (err) {
      console.error("Error fetching inbound email content:", err);
    }
  }

  // Find which organization owns the "to" address
  // First try exact match on organization_emails
  const { data: orgEmail } = await supabase
    .from("organization_emails")
    .select("organization_id")
    .eq("email", toEmail)
    .maybeSingle();

  let organizationId = orgEmail?.organization_id;

  // If no exact match, try matching the domain from the "to" address
  if (!organizationId) {
    const toDomain = toEmail.split("@")[1]?.toLowerCase();
    if (toDomain) {
      const { data: orgDomain } = await supabase
        .from("organization_domains")
        .select("organization_id")
        .eq("domain", toDomain)
        .eq("verified", true)
        .maybeSingle();
      organizationId = orgDomain?.organization_id;
    }
  }

  if (!organizationId) {
    console.error("No organization found for receiving address:", toEmail);
    return new Response(JSON.stringify({ error: "Unknown receiving address" }), {
      status: 200, // Return 200 so Resend doesn't retry
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // Try to find matching customer by sender email
  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("email", fromEmail)
    .maybeSingle();

  // Try to link to our most recent outbound email to this sender
  let inReplyToLogId = null;
  if (customer) {
    const { data: recentOutbound } = await supabase
      .from("email_logs")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("customer_id", customer.id)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentOutbound) {
      inReplyToLogId = recentOutbound.id;

      // Also update replied_at on that outbound email
      await supabase
        .from("email_logs")
        .update({ replied_at: new Date().toISOString() })
        .eq("id", recentOutbound.id)
        .is("replied_at", null); // Only set if not already set
    }
  }

  // Insert into inbound_emails
  const { data: insertedInbound, error: insertError } = await supabase
    .from("inbound_emails")
    .insert({
      organization_id: organizationId,
      from_email: fromEmail,
      from_name: fromName,
      to_email: toEmail,
      cc: Array.isArray(data.cc) ? data.cc : data.cc ? [data.cc] : null,
      subject,
      html,
      text_body: textBody,
      resend_email_id: emailId,
      in_reply_to_log_id: inReplyToLogId,
      customer_id: customer?.id || null,
      is_read: false,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("Failed to insert inbound email:", JSON.stringify(insertError));
    return new Response(JSON.stringify({ error: "Failed to store inbound email", details: insertError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // AUTO-PAUSE: When a prospect replies, pause their pending scheduled sends
  if (customer) {
    try {
      const { data: pausedSends } = await supabase
        .from("scheduled_sends")
        .update({ status: "paused" })
        .eq("customer_id", customer.id)
        .eq("status", "pending")
        .select("id");

      if (pausedSends && pausedSends.length > 0) {
        console.log(`Auto-paused ${pausedSends.length} scheduled sends for customer ${customer.id}`);
        // Also mark the customer as paused
        await supabase
          .from("customers")
          .update({ paused: true })
          .eq("id", customer.id);
      }
    } catch (pauseErr) {
      console.error("Failed to auto-pause sends:", pauseErr);
    }
  }

  // IN-APP NOTIFICATION: Create notification for all org members
  try {
    const { data: orgMembers } = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId);

    if (orgMembers && orgMembers.length > 0) {
      const senderDisplay = fromName ? `${fromName} (${fromEmail})` : fromEmail;
      const notifications = orgMembers.map((m: any) => ({
        organization_id: organizationId,
        user_id: m.user_id,
        type: "reply_received",
        title: `Reply from ${senderDisplay}`,
        body: subject || "(no subject)",
        link: "/inbox",
        metadata: {
          inbound_email_id: insertedInbound?.id,
          from_email: fromEmail,
          customer_id: customer?.id,
        },
      }));
      await supabase.from("notifications").insert(notifications);
    }
  } catch (notifErr) {
    console.error("Failed to create in-app notifications:", notifErr);
  }

  // CREATE REPLY REMINDER: Track so we can send a reminder if user doesn't respond in 24-48h
  if (insertedInbound?.id) {
    try {
      await supabase.from("reply_reminders").insert({
        inbound_email_id: insertedInbound.id,
        organization_id: organizationId,
        customer_id: customer?.id || null,
        status: "pending",
      });
    } catch (reminderErr) {
      console.error("Failed to create reply reminder:", reminderErr);
    }
  }

  // Send email notification to org members
  try {
    const { data: members } = await supabase
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", organizationId);

    if (members && members.length > 0) {
      const userIds = members.map((m: any) => m.user_id);
      const { data: users } = await supabase
        .from("users")
        .select("email")
        .in("id", userIds);

      const recipientEmails = (users || [])
        .map((u: any) => u.email)
        .filter((e: string) => e && e !== fromEmail);

      if (recipientEmails.length > 0 && resendApiKey) {
        const senderDisplay = fromName ? `${fromName} (${fromEmail})` : fromEmail;
        const subjectLine = subject || "(no subject)";
        const preview = textBody
          ? textBody.substring(0, 200) + (textBody.length > 200 ? "..." : "")
          : "View the full message in your Mora inbox.";

        const appUrl = Deno.env.get("APP_URL") || "https://mora.software";

        const sequencePausedNote = customer
          ? `<p style="color: #c0392b; font-size: 13px; margin: 12px 0; padding: 8px 12px; background: #fdf2f2; border-radius: 6px;">Their outreach sequence has been automatically paused.</p>`
          : "";

        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: "Mora <notifications@mora.software>",
            to: recipientEmails,
            subject: `New reply from ${senderDisplay}: ${subjectLine}`,
            html: `
              <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
                <p style="color: #666; font-size: 13px; margin-bottom: 4px;">New reply in your Mora inbox</p>
                <h2 style="margin: 0 0 8px; font-size: 18px;">From ${senderDisplay}</h2>
                <p style="margin: 0 0 4px; font-size: 14px; font-weight: 600;">${subjectLine}</p>
                <p style="color: #444; font-size: 14px; line-height: 1.5; margin: 8px 0 16px; white-space: pre-wrap;">${preview}</p>
                ${sequencePausedNote}
                <a href="${appUrl}/inbox" style="display: inline-block; background: #111; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px;">View in Inbox</a>
                <p style="color: #999; font-size: 11px; margin-top: 24px;">You received this because someone replied to an email sent from your Mora account.</p>
              </div>
            `,
          }),
        });
        console.log("Notification sent to:", recipientEmails);
      }
    }
  } catch (notifErr) {
    // Don't fail the webhook if notification fails
    console.error("Failed to send notification email:", notifErr);
  }

  return new Response(JSON.stringify({ success: true, event: "email.received" }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Log signature for debugging (Resend may not send signatures for all event types)
    const signature = req.headers.get("x-resend-signature");
    if (!signature) {
      console.warn("No x-resend-signature header — proceeding anyway");
    }

    const body = await req.text();

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse the webhook event
    const event = JSON.parse(body);

    console.log("Received Resend webhook event:", event.type);

    // Handle inbound emails separately (different payload structure)
    if (event.type === "email.received") {
      return await handleInboundEmail(event, supabase);
    }

    // For outbound events, find the email log by resend_id
    const resendId = event.data?.email_id || event.email?.id;
    if (!resendId) {
      console.error("No resend ID found in event payload");
      return new Response(JSON.stringify({ error: "No email ID in payload" }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { data: emailLog, error: fetchError } = await supabase
      .from("email_logs")
      .select("id, customer_id")
      .eq("resend_id", resendId)
      .single();

    if (fetchError || !emailLog) {
      console.error("Email log not found for resend_id:", resendId);
      return new Response(
        JSON.stringify({ error: "Email log not found" }),
        {
          status: 200, // Return 200 so Resend doesn't retry endlessly
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Handle different event types
    let updateData: any = {};
    const eventTimestamp = event.created_at ? new Date(event.created_at).toISOString() : new Date().toISOString();

    if (event.type === "email.delivered") {
      updateData.status = "delivered";
      updateData.delivered_at = eventTimestamp;
    } else if (event.type === "email.opened") {
      updateData.opened_at = eventTimestamp;
    } else if (event.type === "email.clicked") {
      updateData.clicked_at = eventTimestamp;
      // Also mark as opened if clicked
      updateData.opened_at = eventTimestamp;
    } else if (event.type === "email.replied") {
      updateData.replied_at = eventTimestamp;
    } else if (event.type === "email.bounced") {
      updateData.status = "bounced";
      updateData.bounce_type = "bounce";
      updateData.bounce_message = event.data?.message || event.data?.reason || null;
    } else if (event.type === "email.complained") {
      updateData.status = "complained";
      updateData.bounce_type = "complaint";
      updateData.bounce_message = event.data?.message || event.data?.reason || null;
    }

    // Update the email log
    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await supabase
        .from("email_logs")
        .update(updateData)
        .eq("id", emailLog.id);

      if (updateError) {
        console.error("Failed to update email log:", updateError);
        return new Response(
          JSON.stringify({ error: "Failed to update email log" }),
          {
            status: 500,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          }
        );
      }
    }

    return new Response(JSON.stringify({ success: true, event: event.type }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    console.error("Error handling webhook:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
