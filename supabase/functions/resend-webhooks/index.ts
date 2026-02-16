// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Verify the request is from Resend
    const signature = req.headers.get("x-resend-signature");
    if (!signature) {
      return new Response(JSON.stringify({ error: "Missing signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const body = await req.text();

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse the webhook event
    const event = JSON.parse(body);

    console.log("Received Resend webhook event:", event.type);

    // Find the email log by resend_id
    const { data: emailLog, error: fetchError } = await supabase
      .from("email_logs")
      .select("id, customer_id")
      .eq("resend_id", event.email.id)
      .single();

    if (fetchError || !emailLog) {
      console.error("Email log not found for resend_id:", event.email.id);
      return new Response(
        JSON.stringify({ error: "Email log not found" }),
        {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    // Handle different event types
    let updateData: any = {};

    if (event.type === "email.delivered") {
      updateData.status = "sent";
    } else if (event.type === "email.opened") {
      updateData.opened_at = new Date(event.created_at).toISOString();
    } else if (event.type === "email.clicked") {
      // Also mark as opened if clicked
      updateData.opened_at = new Date(event.created_at).toISOString();
    } else if (event.type === "email.replied") {
      updateData.replied_at = new Date(event.created_at).toISOString();
    } else if (event.type === "email.bounced") {
      updateData.status = "failed";
    } else if (event.type === "email.complained") {
      updateData.status = "failed";
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
