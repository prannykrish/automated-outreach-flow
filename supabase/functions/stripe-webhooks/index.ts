// @ts-nocheck
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.x?target=deno";

declare const Deno: any;

serve(async (req: Request) => {
  // No CORS — Stripe calls this directly
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
      return new Response("Missing environment variables", { status: 500 });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

    // Verify signature using raw body
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return new Response("Missing stripe-signature header", { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return new Response("Invalid signature", { status: 400 });
    }

    // Price ID to plan mapping
    const STARTER_PRICE = Deno.env.get("STRIPE_STARTER_PRICE_ID");
    const GROWTH_PRICE = Deno.env.get("STRIPE_GROWTH_PRICE_ID");

    const priceToPlan = (priceId: string) => {
      if (priceId === STARTER_PRICE) return { plan: "starter", limit: 1000, domainLimit: 1, emailAddressLimit: 2, memberLimit: 3 };
      if (priceId === GROWTH_PRICE) return { plan: "growth", limit: 5000, domainLimit: 3, emailAddressLimit: 5, memberLimit: 10 };
      return { plan: "enterprise", limit: 99999, domainLimit: 100, emailAddressLimit: 100, memberLimit: 999 };
    };

    // Helper to find org by stripe_customer_id
    const findOrgByCustomer = async (customerId: string) => {
      const { data } = await supabase
        .from("organizations")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .single();
      return data?.id;
    };

    // Helper to find org from subscription metadata
    const getOrgId = async (subscription: any) => {
      // First try metadata
      if (subscription.metadata?.organization_id) {
        return subscription.metadata.organization_id;
      }
      // Fallback: look up by customer
      if (subscription.customer) {
        const custId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
        return await findOrgByCustomer(custId);
      }
      return null;
    };

    console.log("Stripe event:", event.type);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription" || !session.subscription) break;

        const subscriptionId = typeof session.subscription === "string"
          ? session.subscription
          : session.subscription.id;

        // Fetch the full subscription to get price info
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const orgId = await getOrgId(subscription);
        if (!orgId) {
          console.error("Could not find org for checkout session");
          break;
        }

        const priceId = subscription.items.data[0]?.price?.id;
        const { plan, limit, domainLimit, emailAddressLimit, memberLimit } = priceToPlan(priceId || "");

        await supabase.from("organizations").update({
          stripe_subscription_id: subscriptionId,
          plan,
          plan_email_limit: limit,
          plan_domain_limit: domainLimit,
          plan_email_address_limit: emailAddressLimit,
          plan_member_limit: memberLimit,
          billing_status: "active",
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        }).eq("id", orgId);

        console.log(`Org ${orgId} subscribed to ${plan}`);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const orgId = await getOrgId(subscription);
        if (!orgId) break;

        const priceId = subscription.items.data[0]?.price?.id;
        const { plan, limit, domainLimit, emailAddressLimit, memberLimit } = priceToPlan(priceId || "");

        const statusMap: Record<string, string> = {
          active: "active",
          past_due: "past_due",
          canceled: "canceled",
          unpaid: "past_due",
          trialing: "trialing",
        };

        await supabase.from("organizations").update({
          plan,
          plan_email_limit: limit,
          plan_domain_limit: domainLimit,
          plan_email_address_limit: emailAddressLimit,
          plan_member_limit: memberLimit,
          billing_status: statusMap[subscription.status] || "active",
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        }).eq("id", orgId);

        console.log(`Org ${orgId} subscription updated to ${plan}, status: ${subscription.status}`);
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const orgId = await getOrgId(subscription);
        if (!orgId) break;

        await supabase.from("organizations").update({
          plan: "canceled",
          billing_status: "canceled",
        }).eq("id", orgId);

        console.log(`Org ${orgId} subscription canceled`);
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        if (!customerId) break;

        const orgId = await findOrgByCustomer(customerId);
        if (!orgId) break;

        await supabase.from("organizations").update({
          billing_status: "past_due",
        }).eq("id", orgId);

        console.log(`Org ${orgId} payment failed`);
        break;
      }

      default:
        console.log(`Unhandled event: ${event.type}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
