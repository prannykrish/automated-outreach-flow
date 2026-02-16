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
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ error: "Missing environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify the caller is a super admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Decode the JWT to get the caller's user ID
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Invalid auth token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if caller is super admin
    const { data: callerProfile } = await supabase
      .from("users")
      .select("is_super_admin")
      .eq("id", caller.id)
      .single();

    if (!callerProfile?.is_super_admin) {
      return new Response(
        JSON.stringify({ error: "Only super admins can delete users" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { user_id } = await req.json();

    if (!user_id) {
      return new Response(
        JSON.stringify({ error: "user_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prevent self-deletion
    if (user_id === caller.id) {
      return new Response(
        JSON.stringify({ error: "You cannot delete yourself" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Clean up related records (service role bypasses RLS)

    // 1. Remove from organization_members
    await supabase
      .from("organization_members")
      .delete()
      .eq("user_id", user_id);

    // 2. Nullify user_id on customers (preserve customer data)
    await supabase
      .from("customers")
      .update({ user_id: null })
      .eq("user_id", user_id);

    // 3. Nullify user_id on email_logs (preserve log history)
    await supabase
      .from("email_logs")
      .update({ user_id: null })
      .eq("user_id", user_id);

    // 4. Nullify user_id on email_sequences
    await supabase
      .from("email_sequences")
      .update({ user_id: null })
      .eq("user_id", user_id);

    // 5. Nullify user_id on scheduled_sends
    await supabase
      .from("scheduled_sends")
      .update({ user_id: null })
      .eq("user_id", user_id);

    // 6. Delete template_folders owned by user
    await supabase
      .from("template_folders")
      .delete()
      .eq("user_id", user_id);

    // 7. Nullify user_id on email_templates
    await supabase
      .from("email_templates")
      .update({ user_id: null })
      .eq("user_id", user_id);

    // 8. Delete from public.users
    const { error: deleteUserError } = await supabase
      .from("users")
      .delete()
      .eq("id", user_id);

    if (deleteUserError) {
      console.error("Error deleting from public.users:", deleteUserError);
      return new Response(
        JSON.stringify({ error: "Failed to delete user record", details: deleteUserError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 9. Delete from auth.users (removes login credentials)
    const { error: authDeleteError } = await supabase.auth.admin.deleteUser(user_id);

    if (authDeleteError) {
      console.error("Error deleting from auth.users:", authDeleteError);
      // User is already removed from public.users, so this is a partial cleanup
      return new Response(
        JSON.stringify({
          success: true,
          warning: "User removed from app but auth record cleanup failed: " + authDeleteError.message,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: "User fully deleted" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
