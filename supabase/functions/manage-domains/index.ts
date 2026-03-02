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

// Status priority: higher number = more definitive. Never downgrade.
const STATUS_PRIORITY: Record<string, number> = {
  not_started: 0,
  pending: 1,
  temporary_failure: 2,
  failed: 2,
  verified: 10,
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

    // Helper: enable receiving capability on a Resend domain via PATCH API
    const enableReceiving = async (resendDomainId: string): Promise<boolean> => {
      try {
        console.log("Enabling receiving for Resend domain:", resendDomainId);
        const res = await fetch(`https://api.resend.com/domains/${resendDomainId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            capabilities: {
              sending: "enabled",
              receiving: "enabled",
            },
          }),
        });
        if (!res.ok) {
          const errData = await res.json();
          console.error("Failed to enable receiving:", res.status, errData);
          return false;
        }
        console.log("Receiving enabled successfully for domain:", resendDomainId);
        return true;
      } catch (err) {
        console.error("Error enabling receiving:", err);
        return false;
      }
    };

    // Helper: check if a value is a receiving MX record
    const isReceivingMxValue = (value: string): boolean => {
      const v = (value || "").toLowerCase();
      return v.includes("inbound.resend.dev") || v.includes("inbound-smtp");
    };

    // Helper: create a unique key for a DNS record (for matching across syncs)
    const recordKey = (r: any): string => {
      const type = r.type || r.record || "";
      const name = r.name || "@";
      return `${type}_${name}`;
    };

    // Helper: normalize records from Resend
    // - MX priority baked into value
    // - Blank/empty name defaults to "@"
    // - Preserves Resend's actual status (verified, pending, not_started, failed)
    const normalizeRecords = (records: any[]): any[] => {
      if (!records || !Array.isArray(records)) return [];
      return records.map((r: any) => {
        const normalized = { ...r };
        if (!normalized.name || normalized.name.trim() === "") {
          normalized.name = "@";
        }
        // Keep Resend's status as-is — do NOT convert pending to not_started
        if (!normalized.status) {
          normalized.status = "not_started";
        }
        if ((r.type === "MX" || r.record === "MX") && r.priority !== undefined) {
          const valAlreadyHasPriority = /^\d+\s/.test(r.value || "");
          if (!valAlreadyHasPriority) {
            normalized.value = `${r.priority} ${r.value}`;
          }
          delete normalized.priority;
        }
        return normalized;
      });
    };

    // Helper: ensure a receiving MX record exists in the DNS records list.
    const withMxRecord = (records: any[], domainName: string, fallbackStatus = "not_started") => {
      const normalized = normalizeRecords(records);
      const existingIdx = normalized.findIndex((r: any) =>
        (r.type === "MX" || r.record === "MX") && isReceivingMxValue(r.value || "")
      );
      if (existingIdx >= 0) return normalized;
      return [
        ...normalized,
        {
          record: "MX",
          type: "MX",
          name: "@",
          value: "10 inbound.resend.dev",
          status: fallbackStatus,
        },
      ];
    };

    // Helper: merge new records from Resend with existing DB records.
    // CRITICAL: never downgrade a verified record. Only move forward.
    const mergeRecords = (existingRecords: any[], resendRecords: any[]): any[] => {
      // Build a map of existing record statuses
      const existingMap: Record<string, string> = {};
      (existingRecords || []).forEach((r: any) => {
        existingMap[recordKey(r)] = r.status || "not_started";
      });

      return resendRecords.map((r: any) => {
        const key = recordKey(r);
        const existingStatus = existingMap[key];
        const newStatus = r.status || "not_started";

        // If existing status is more definitive, keep it
        if (existingStatus) {
          const existingPriority = STATUS_PRIORITY[existingStatus] ?? 0;
          const newPriority = STATUS_PRIORITY[newStatus] ?? 0;

          // Never downgrade from verified
          if (existingStatus === "verified" && newStatus !== "verified") {
            console.log(`Record ${key}: keeping verified (Resend returned ${newStatus})`);
            return { ...r, status: "verified" };
          }

          // For non-verified states, allow Resend to update (it might go from pending→verified or pending→failed)
          // But don't go from failed back to not_started
          if (existingPriority > newPriority && existingStatus !== "failed") {
            return { ...r, status: existingStatus };
          }
        }

        return r;
      });
    };

    // Helper: fetch domain status from Resend, merge with DB state, and update DB.
    // Never regresses verified records.
    const syncDomainFromResend = async (domainRecord: any) => {
      const resendId = domainRecord.resend_domain_id;
      console.log(`Syncing domain ${domainRecord.domain} (resend_id: ${resendId})`);

      const statusResponse = await fetch(`https://api.resend.com/domains/${resendId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      });

      if (!statusResponse.ok) {
        const errText = await statusResponse.text();
        console.error(`Resend GET domain error for ${resendId}:`, errText);
        return {
          domain: domainRecord,
          status: domainRecord.status,
          verified: domainRecord.verified,
          dns_records: domainRecord.dns_records,
        };
      }

      const statusData = await statusResponse.json();
      console.log(`Resend status for ${domainRecord.domain}: ${statusData.status}, records:`,
        JSON.stringify(statusData.records?.map((r: any) => ({ type: r.type || r.record, name: r.name, status: r.status }))));

      // Normalize new records and ensure MX is present
      const resendRecords = withMxRecord(statusData.records, domainRecord.domain);

      // Merge with existing DB records — never downgrade verified
      const existingRecords = domainRecord.dns_records || [];
      const mergedRecords = mergeRecords(existingRecords, resendRecords);

      // Domain is verified only when ALL records are verified
      const allVerified = mergedRecords.length > 0 && mergedRecords.every((r: any) => r.status === "verified");

      // Determine overall status
      let overallStatus = statusData.status;
      if (allVerified) overallStatus = "verified";

      const updateData: any = {
        status: overallStatus,
        dns_records: mergedRecords,
        verified: allVerified,
      };

      if (allVerified && !domainRecord.verified_at) {
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

      const result = updatedDomain || { ...domainRecord, ...updateData };
      return {
        domain: result,
        status: overallStatus,
        verified: allVerified,
        dns_records: mergedRecords,
      };
    };

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

          await enableReceiving(existing.id);
          await new Promise((r) => setTimeout(r, 2000));

          const detailRes = await fetch(`https://api.resend.com/domains/${existing.id}`, {
            headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
          });
          const detailData = await detailRes.json();

          const { data: existingRow } = await supabase
            .from("organization_domains")
            .select("*")
            .eq("organization_id", organization_id)
            .eq("domain", cleanDomain)
            .maybeSingle();

          const syncedRecords = withMxRecord(detailData.records, cleanDomain);
          const allRecordsVerified = syncedRecords?.length > 0 && syncedRecords.every((r: any) => r.status === "verified");

          if (existingRow) {
            // Merge with existing DB records to protect verified state
            const mergedRecords = mergeRecords(existingRow.dns_records || [], syncedRecords);
            const allMergedVerified = mergedRecords.length > 0 && mergedRecords.every((r: any) => r.status === "verified");

            const updatePayload: any = {
              resend_domain_id: existing.id,
              dns_records: mergedRecords,
              status: allMergedVerified ? "verified" : (detailData.status || existingRow.status),
              verified: allMergedVerified,
            };
            if (allMergedVerified && !existingRow.verified_at) {
              updatePayload.verified_at = new Date().toISOString();
            }

            const { data: updatedDomain } = await supabase
              .from("organization_domains")
              .update(updatePayload)
              .eq("id", existingRow.id)
              .select()
              .single();

            // Auto-trigger verification if not yet verified
            if (!allMergedVerified) {
              fetch(`https://api.resend.com/domains/${existing.id}/verify`, {
                method: "POST",
                headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
              }).catch(() => {});
            }

            return new Response(
              JSON.stringify({
                success: true,
                domain: updatedDomain || existingRow,
                dns_records: mergedRecords,
                synced: true,
                auto_verifying: !allMergedVerified,
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
              dns_records: syncedRecords,
              status: allRecordsVerified ? "verified" : (detailData.status || "pending"),
              verified: allRecordsVerified,
              verified_at: allRecordsVerified ? new Date().toISOString() : null,
            })
            .select()
            .single();

          if (insertError) {
            return new Response(
              JSON.stringify({ error: "Failed to save domain", details: insertError.message }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }

          // Auto-trigger verification if not yet verified
          if (!allRecordsVerified) {
            fetch(`https://api.resend.com/domains/${existing.id}/verify`, {
              method: "POST",
              headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
            }).catch(() => {});
          }

          return new Response(
            JSON.stringify({
              success: true,
              domain: insertedDomain,
              dns_records: syncedRecords,
              synced: true,
              auto_verifying: !allRecordsVerified,
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

      // New domain — enable receiving
      await enableReceiving(resendData.id);
      await new Promise((r) => setTimeout(r, 2000));

      const detailRes = await fetch(`https://api.resend.com/domains/${resendData.id}`, {
        headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      });
      const detailData = detailRes.ok ? await detailRes.json() : null;
      const latestRecords = detailData?.records || resendData.records;
      const allRecords = withMxRecord(latestRecords, cleanDomain);

      const { data: insertedDomain, error: insertError } = await supabase
        .from("organization_domains")
        .insert({
          organization_id,
          domain: cleanDomain,
          resend_domain_id: resendData.id,
          dns_records: allRecords,
          status: detailData?.status || resendData.status || "not_started",
          verified: false,
        })
        .select()
        .single();

      if (insertError) {
        console.error("DB insert error:", insertError);
        await fetch(`https://api.resend.com/domains/${resendData.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
        });

        return new Response(
          JSON.stringify({ error: "Failed to save domain", details: insertError.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Auto-trigger verification immediately
      fetch(`https://api.resend.com/domains/${resendData.id}/verify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      }).catch(() => {});

      return new Response(
        JSON.stringify({
          success: true,
          domain: insertedDomain,
          dns_records: allRecords,
          auto_verifying: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // VERIFY DOMAIN — triggers Resend verification and does one sync
    if (action === "verify") {
      if (!domain_id) {
        return new Response(
          JSON.stringify({ error: "domain_id is required for verify action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

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

      // Ensure receiving is enabled
      await enableReceiving(domainRecord.resend_domain_id);

      // Trigger verification in Resend
      const verifyRes = await fetch(`https://api.resend.com/domains/${domainRecord.resend_domain_id}/verify`, {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      });
      console.log("Resend verify POST status:", verifyRes.status);

      // Wait a moment for Resend to process, then sync once
      await new Promise((r) => setTimeout(r, 3000));
      const result = await syncDomainFromResend(domainRecord);

      // If not yet verified, do one more check after another 3s
      if (!result.verified) {
        await new Promise((r) => setTimeout(r, 3000));
        const result2 = await syncDomainFromResend({
          ...domainRecord,
          dns_records: result.dns_records, // pass merged records to protect verified state
        });
        return new Response(
          JSON.stringify({ success: true, ...result2 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, ...result }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // SYNC STATUS — lightweight polling check. Also re-triggers Resend verify
    // periodically so DNS checks actually happen (not just reading cached state).
    if (action === "sync-status") {
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
        // Re-trigger Resend verification so it actually checks DNS
        // (without this, GET just returns cached state)
        try {
          await fetch(`https://api.resend.com/domains/${dr.resend_domain_id}/verify`, {
            method: "POST",
            headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
          });
        } catch (e) {
          console.error("Failed to trigger verify for", dr.domain, e);
        }

        // Wait a moment, then sync
        await new Promise((r) => setTimeout(r, 2000));
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

      if (domainRecord.resend_domain_id) {
        const deleteResponse = await fetch(`https://api.resend.com/domains/${domainRecord.resend_domain_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
        });

        if (!deleteResponse.ok && deleteResponse.status !== 404) {
          console.warn("Failed to delete domain from Resend:", await deleteResponse.text());
        }
      }

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
