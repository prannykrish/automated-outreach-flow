// @ts-nocheck
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const APP_URL = Deno.env.get("APP_URL") || "https://mora.software";

    if (!RESEND_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Find pending reminders where the inbound email arrived 24-48h ago and user hasn't responded
    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: pendingReminders, error: fetchErr } = await supabase
      .from("reply_reminders")
      .select(`
        id,
        inbound_email_id,
        organization_id,
        customer_id,
        created_at,
        inbound_emails(from_email, from_name, subject)
      `)
      .eq("status", "pending")
      .lte("created_at", cutoff24h)
      .gte("created_at", cutoff48h)
      .limit(50);

    if (fetchErr) {
      console.error("Failed to fetch reminders:", fetchErr);
      return new Response(
        JSON.stringify({ error: fetchErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!pendingReminders || pendingReminders.length === 0) {
      return new Response(
        JSON.stringify({ message: "No reminders to send", sent: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let sentCount = 0;

    for (const reminder of pendingReminders) {
      try {
        // Check if user has already replied (any outbound email to this customer after the inbound)
        if (reminder.customer_id) {
          const { data: recentOutbound } = await supabase
            .from("email_logs")
            .select("id")
            .eq("customer_id", reminder.customer_id)
            .eq("organization_id", reminder.organization_id)
            .eq("status", "sent")
            .gte("sent_at", reminder.created_at)
            .limit(1)
            .maybeSingle();

          if (recentOutbound) {
            // User already replied, mark as handled
            await supabase
              .from("reply_reminders")
              .update({ status: "handled", user_action: "already_replied" })
              .eq("id", reminder.id);
            continue;
          }
        }

        // Get org member emails to notify
        const { data: members } = await supabase
          .from("organization_members")
          .select("user_id")
          .eq("organization_id", reminder.organization_id);

        if (!members || members.length === 0) continue;

        const userIds = members.map((m: any) => m.user_id);
        const { data: users } = await supabase
          .from("users")
          .select("email")
          .in("id", userIds);

        const recipientEmails = (users || [])
          .map((u: any) => u.email)
          .filter(Boolean);

        if (recipientEmails.length === 0) continue;

        const inbound = reminder.inbound_emails;
        const senderDisplay = inbound?.from_name
          ? `${inbound.from_name} (${inbound.from_email})`
          : inbound?.from_email || "a prospect";
        const subjectLine = inbound?.subject || "(no subject)";

        // Send reminder email with action buttons
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: "Mora <notifications@mora.software>",
            to: recipientEmails,
            subject: `Reminder: You received a reply from ${senderDisplay} and haven't responded`,
            html: `
              <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
                <p style="color: #666; font-size: 13px; margin-bottom: 4px;">Reply reminder from Mora</p>
                <h2 style="margin: 0 0 8px; font-size: 18px;">You received a reply and have not responded</h2>
                <p style="margin: 0 0 4px; font-size: 14px;">From: <strong>${senderDisplay}</strong></p>
                <p style="margin: 0 0 16px; font-size: 14px;">Subject: ${subjectLine}</p>
                <p style="color: #444; font-size: 14px; margin-bottom: 20px;">
                  Do you want Mora to draft a reply, unpause the sequence, or wait?
                </p>
                <div style="margin-bottom: 20px;">
                  <a href="${APP_URL}/inbox?action=draft_reply&reminder=${reminder.id}" style="display: inline-block; background: #111; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; margin-right: 8px;">Draft Reply</a>
                  <a href="${APP_URL}/inbox?action=resume&reminder=${reminder.id}" style="display: inline-block; background: #fff; color: #111; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; border: 1px solid #ddd; margin-right: 8px;">Resume Sequence</a>
                  <a href="${APP_URL}/inbox?action=mark_handled&reminder=${reminder.id}" style="display: inline-block; background: #fff; color: #666; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; border: 1px solid #ddd;">Mark Handled</a>
                </div>
                <p style="color: #999; font-size: 11px; margin-top: 24px;">You received this because a prospect replied to an outreach email and you haven't responded within 24 hours.</p>
              </div>
            `,
          }),
        });

        // Mark reminder as sent
        await supabase
          .from("reply_reminders")
          .update({ status: "sent", reminder_sent_at: new Date().toISOString() })
          .eq("id", reminder.id);

        // Also create in-app notification
        const reminderNotifications = (members || []).map((m: any) => ({
          organization_id: reminder.organization_id,
          user_id: m.user_id,
          type: "reply_reminder",
          title: `Reminder: Reply from ${senderDisplay} is waiting`,
          body: `You received a reply to "${subjectLine}" and haven't responded yet.`,
          link: "/inbox",
          metadata: {
            reminder_id: reminder.id,
            inbound_email_id: reminder.inbound_email_id,
            customer_id: reminder.customer_id,
          },
        }));
        await supabase.from("notifications").insert(reminderNotifications);

        sentCount++;
      } catch (err: any) {
        console.error(`Failed to process reminder ${reminder.id}:`, err.message);
      }
    }

    // Also expire very old reminders (>48h) that haven't been acted on
    await supabase
      .from("reply_reminders")
      .update({ status: "expired" })
      .eq("status", "pending")
      .lt("created_at", cutoff48h);

    return new Response(
      JSON.stringify({ message: "Done", sent: sentCount, total: pendingReminders.length }),
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
