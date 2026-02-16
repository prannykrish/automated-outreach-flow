// @ts-nocheck
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface ManageDomainsRequest {
  action: "add" | "verify" | "delete" | "sync-status";
  domain?: string;
  domain_id?: string;
  organization_id: string;
}

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

    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const payload: ManageDomainsRequest = await req.json();
    const { action, domain, domain_id, organization_id } = payload;

    if (!organization_id) {
      return new Response(
        JSON.stringify({ error: "organization_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ADD DOMAIN
    if (action === "add") {
      if (!domain) {
        return new Response(
          JSON.stringify({ error: "domain is required for add action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const cleanDomain = domain.toLowerCase().trim();

      // Basic domain validation
      const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]?\.[a-zA-Z]{2,}$/;
      if (!domainRegex.test(cleanDomain)) {
        return new Response(
          JSON.stringify({ error: "Invalid domain format" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Call Resend API to create domain
      const resendResponse = await fetch("https://api.resend.com/domains", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RESEND_API_KEY}`,
        },
        body: JSON.stringify({ name: cleanDomain }),
      });

      const resendData = await resendResponse.json();

      if (!resendResponse.ok) {
        // Handle domain already registered in Resend – look it up and sync
        if (resendResponse.status === 409) {
          // Fetch all domains from Resend and find the matching one
          const listRes = await fetch("https://api.resend.com/domains", {
            headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
          });
          const listData = await listRes.json();
          const existing = listData?.data?.find(
            (d: any) => d.name?.toLowerCase() === cleanDomain
          );

          if (!existing) {
            return new Response(
              JSON.stringify({
                error: `The ${cleanDomain} domain has been registered already.`,
                code: "DOMAIN_EXISTS",
              }),
              { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Get full domain details (includes DNS records)
          const detailRes = await fetch(`https://api.resend.com/domains/${existing.id}`, {
            headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
          });
          const detailData = await detailRes.json();

          const isVerified = detailData.status === "verified";

          // Check if domain already exists in our DB for this org
          const { data: existingRow } = await supabase
            .from("organization_domains")
            .select("*")
            .eq("organization_id", organization_id)
            .eq("domain", cleanDomain)
            .maybeSingle();

          if (existingRow) {
            // Update existing row with latest Resend status
            const updatePayload: any = {
              resend_domain_id: existing.id,
              dns_records: detailData.records || existingRow.dns_records,
              status: detailData.status || existingRow.status,
              verified: isVerified,
            };
            if (isVerified && !existingRow.verified_at) {
              updatePayload.verified_at = new Date().toISOString();
            }

            const { data: updatedDomain } = await supabase
              .from("organization_domains")
              .update(updatePayload)
              .eq("id", existingRow.id)
              .select()
              .single();

            return new Response(
              JSON.stringify({
                success: true,
                domain: updatedDomain || existingRow,
                dns_records: detailData.records,
                synced: true,
              }),
              { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Domain exists in Resend but not in our DB – insert it
          const { data: insertedDomain, error: insertError } = await supabase
            .from("organization_domains")
            .insert({
              organization_id,
              domain: cleanDomain,
              resend_domain_id: existing.id,
              dns_records: detailData.records,
              status: detailData.status || "pending",
              verified: isVerified,
              verified_at: isVerified ? new Date().toISOString() : null,
            })
            .select()
            .single();

          if (insertError) {
            return new Response(
              JSON.stringify({ error: "Failed to save domain", details: insertError.message }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          return new Response(
            JSON.stringify({
              success: true,
              domain: insertedDomain,
              dns_records: detailData.records,
              synced: true,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(
          JSON.stringify({
            error: resendData.message || resendData.error || "Failed to add domain to Resend",
            code: resendData.name || "RESEND_ERROR",
            details: resendData,
          }),
          { status: resendResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Insert into database
      const { data: insertedDomain, error: insertError } = await supabase
        .from("organization_domains")
        .insert({
          organization_id,
          domain: cleanDomain,
          resend_domain_id: resendData.id,
          dns_records: resendData.records,
          status: resendData.status || "pending",
          verified: false,
        })
        .select()
        .single();

      if (insertError) {
        console.error("DB insert error:", insertError);
        // Try to clean up the domain from Resend
        await fetch(`https://api.resend.com/domains/${resendData.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
        });

        return new Response(
          JSON.stringify({ error: "Failed to save domain", details: insertError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          domain: insertedDomain,
          dns_records: resendData.records,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Helper: fetch domain status from Resend and update our DB
    const syncDomainFromResend = async (domainRecord: any) => {
      const resendId = domainRecord.resend_domain_id;
      const statusResponse = await fetch(`https://api.resend.com/domains/${resendId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      });

      if (!statusResponse.ok) {
        const errData = await statusResponse.json();
        console.error("Resend GET domain error:", errData);
        return { domain: domainRecord, status: domainRecord.status, verified: domainRecord.verified, dns_records: domainRecord.dns_records };
      }

      const statusData = await statusResponse.json();
      const isVerified = statusData.status === "verified";
      const updateData: any = {
        status: statusData.status,
        dns_records: statusData.records,
        verified: isVerified,
      };

      if (isVerified && !domainRecord.verified_at) {
        updateData.verified_at = new Date().toISOString();
      }

      const { data: updatedDomain, error: updateError } = await supabase
        .from("organization_domains")
        .update(updateData)
        .eq("id", domainRecord.id)
        .select()
        .single();

      if (updateError) {
        console.error("DB update error:", updateError);
      }

      return {
        domain: updatedDomain || { ...domainRecord, ...updateData },
        status: statusData.status,
        verified: isVerified,
        dns_records: statusData.records,
      };
    };

    // VERIFY DOMAIN
    if (action === "verify") {
      if (!domain_id) {
        return new Response(
          JSON.stringify({ error: "domain_id is required for verify action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get domain from database
      const { data: domainRecord, error: fetchError } = await supabase
        .from("organization_domains")
        .select("*")
        .eq("id", domain_id)
        .eq("organization_id", organization_id)
        .single();

      if (fetchError || !domainRecord) {
        return new Response(
          JSON.stringify({ error: "Domain not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!domainRecord.resend_domain_id) {
        return new Response(
          JSON.stringify({ error: "Domain is not registered with Resend" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Trigger verification in Resend
      const verifyRes = await fetch(`https://api.resend.com/domains/${domainRecord.resend_domain_id}/verify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      });
      console.log("Resend verify POST status:", verifyRes.status);

      // Wait 2 seconds for Resend to process, then check status
      await new Promise((r) => setTimeout(r, 2000));

      // Get status — retry once after 3s if not yet verified
      let result = await syncDomainFromResend(domainRecord);

      if (!result.verified) {
        console.log("Not verified yet, retrying after 3s...");
        await new Promise((r) => setTimeout(r, 3000));
        result = await syncDomainFromResend(domainRecord);
      }

      return new Response(
        JSON.stringify({ success: true, ...result }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SYNC STATUS — lightweight check for auto-polling (no verify POST)
    if (action === "sync-status") {
      // Sync all unverified domains for this org
      const { data: unverifiedDomains } = await supabase
        .from("organization_domains")
        .select("*")
        .eq("organization_id", organization_id)
        .eq("verified", false)
        .not("resend_domain_id", "is", null);

      if (!unverifiedDomains || unverifiedDomains.length === 0) {
        return new Response(
          JSON.stringify({ success: true, updated: 0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const results = [];
      for (const dr of unverifiedDomains) {
        const result = await syncDomainFromResend(dr);
        results.push(result);
      }

      return new Response(
        JSON.stringify({ success: true, updated: results.length, domains: results }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // DELETE DOMAIN
    if (action === "delete") {
      if (!domain_id) {
        return new Response(
          JSON.stringify({ error: "domain_id is required for delete action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Get domain from database
      const { data: domainRecord, error: fetchError } = await supabase
        .from("organization_domains")
        .select("*")
        .eq("id", domain_id)
        .eq("organization_id", organization_id)
        .single();

      if (fetchError || !domainRecord) {
        return new Response(
          JSON.stringify({ error: "Domain not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Delete from Resend if we have a resend_domain_id
      if (domainRecord.resend_domain_id) {
        const deleteResponse = await fetch(`https://api.resend.com/domains/${domainRecord.resend_domain_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
        });

        // Continue even if Resend deletion fails (domain might already be deleted)
        if (!deleteResponse.ok && deleteResponse.status !== 404) {
          console.warn("Failed to delete domain from Resend:", await deleteResponse.text());
        }
      }

      // Delete from database
      const { error: deleteError } = await supabase
        .from("organization_domains")
        .delete()
        .eq("id", domain_id);

      if (deleteError) {
        return new Response(
          JSON.stringify({ error: "Failed to delete domain", details: deleteError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, message: "Domain deleted" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ error: "Invalid action. Use 'add', 'verify', 'delete', or 'sync-status'" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
