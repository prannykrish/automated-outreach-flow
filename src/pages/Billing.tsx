import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CreditCard, Mail, Clock, CheckCircle, AlertTriangle, Loader2, Globe, Users, Target } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

const STARTER_PRICE_ID = import.meta.env.VITE_STRIPE_STARTER_PRICE_ID;
const GROWTH_PRICE_ID = import.meta.env.VITE_STRIPE_GROWTH_PRICE_ID;

const planDetails: Record<string, { name: string; price: string }> = {
  trial: { name: "Free Trial", price: "Free" },
  starter: { name: "Starter", price: "$19/mo" },
  growth: { name: "Plus", price: "$49/mo" },
  enterprise: { name: "Enterprise", price: "Custom" },
  canceled: { name: "Canceled", price: "—" },
};

function statusBadge(status: string) {
  switch (status) {
    case "active":
      return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Active</Badge>;
    case "trialing":
      return <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">Trial</Badge>;
    case "past_due":
      return <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">Past Due</Badge>;
    case "canceled":
      return <Badge className="bg-red-500/10 text-red-600 border-red-500/20">Canceled</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function UsageBar({ label, used, limit, icon }: { label: string; used: number; limit: number; icon: React.ReactNode }) {
  const percent = Math.min((used / limit) * 100, 100);
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="flex items-center gap-1.5">{icon}{label}</span>
        <span className="text-muted-foreground">{used} / {limit}</span>
      </div>
      <Progress value={percent} className="h-1.5" />
    </div>
  );
}

export default function Billing() {
  const { organizationId, session } = useAuth();
  const { toast } = useToast();
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const justSubscribed = searchParams.get("success") === "true";

  const { data: org, isLoading: orgLoading } = useQuery({
    queryKey: ["billing-org", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organizations")
        .select("*")
        .eq("id", organizationId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
    // After Stripe checkout redirect, poll until the webhook updates the plan
    refetchInterval:
      justSubscribed && organizationId
        ? (query) => {
            const plan = query.state.data?.plan;
            // Stop polling once plan is no longer trial (webhook has fired)
            return plan === "trial" || !plan ? 2000 : false;
          }
        : false,
  });

  const currentMonth = new Date().toISOString().slice(0, 7);
  const { data: emailUsage } = useQuery({
    queryKey: ["email-usage", organizationId, currentMonth, org?.plan],
    queryFn: async () => {
      if (org?.plan === "trial") {
        // Trial: sum ALL months for lifetime cap
        const { data } = await supabase
          .from("email_usage")
          .select("emails_sent")
          .eq("organization_id", organizationId!);
        return (data || []).reduce((sum: number, row: any) => sum + (row.emails_sent || 0), 0);
      }
      // Paid: current month only
      const { data } = await supabase
        .from("email_usage")
        .select("emails_sent")
        .eq("organization_id", organizationId!)
        .eq("month", currentMonth)
        .maybeSingle();
      return data?.emails_sent || 0;
    },
    enabled: !!organizationId && !!org,
  });

  // Campaign usage
  const { data: campaignUsage } = useQuery({
    queryKey: ["campaign-usage", organizationId, currentMonth],
    queryFn: async () => {
      const { data } = await supabase
        .from("campaign_usage")
        .select("campaigns_run, prospects_researched")
        .eq("organization_id", organizationId!)
        .eq("month", currentMonth)
        .maybeSingle();
      return { campaigns_run: data?.campaigns_run || 0, prospects_researched: data?.prospects_researched || 0 };
    },
    enabled: !!organizationId,
  });

  // Resource counts
  const { data: resourceCounts } = useQuery({
    queryKey: ["billing-resources", organizationId],
    queryFn: async () => {
      const [domains, emails, members] = await Promise.all([
        supabase.from("organization_domains").select("id", { count: "exact", head: true }).eq("organization_id", organizationId!),
        supabase.from("organization_emails").select("id", { count: "exact", head: true }).eq("organization_id", organizationId!),
        supabase.from("organization_members").select("id", { count: "exact", head: true }).eq("organization_id", organizationId!),
      ]);
      return {
        domains: domains.count || 0,
        emails: emails.count || 0,
        members: members.count || 0,
      };
    },
    enabled: !!organizationId,
  });

  const handleSubscribe = async (priceId: string) => {
    if (!organizationId || !session) return;
    setLoadingPlan(priceId);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/stripe-checkout`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ price_id: priceId, organization_id: organizationId }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create checkout session");

      window.location.href = data.url;
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setLoadingPlan(null);
    }
  };

  if (orgLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!org) return null;

  const plan = planDetails[org.plan] || planDetails.trial;
  const emailsSent = emailUsage || 0;
  const emailLimit = org.plan === "trial"
    ? (org.trial_email_total_limit || 200)
    : (org.plan_email_limit || 1000);

  const trialEndsAt = org.trial_ends_at ? new Date(org.trial_ends_at) : null;
  const now = new Date();
  const trialDaysLeft = trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))) : 0;
  const trialExpired = org.plan === "trial" && trialEndsAt && trialEndsAt < now;

  const isSubscribed = ["starter", "growth", "enterprise"].includes(org.plan) && org.billing_status === "active";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-muted-foreground">Manage your subscription and usage.</p>
      </div>

      {justSubscribed && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4 flex items-center gap-3">
          <CheckCircle className="h-5 w-5 text-green-600" />
          <p className="text-sm text-green-700 dark:text-green-400">
            Subscription activated! Your plan has been updated.
          </p>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Current Plan */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Current Plan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{plan.name}</p>
                <p className="text-muted-foreground">{plan.price}</p>
              </div>
              {statusBadge(org.billing_status)}
            </div>

            {org.plan === "trial" && (
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-muted-foreground" />
                {trialExpired ? (
                  <span className="text-red-600 font-medium">Trial expired</span>
                ) : (
                  <span>{trialDaysLeft} days left in trial</span>
                )}
              </div>
            )}

            {org.current_period_end && isSubscribed && (
              <p className="text-sm text-muted-foreground">
                Renews on {new Date(org.current_period_end).toLocaleDateString()}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Resource Usage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Usage
            </CardTitle>
            <CardDescription>
              {org.plan === "trial"
                ? "Free trial (200 email lifetime cap)"
                : new Date().toLocaleString("default", { month: "long", year: "numeric" })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <UsageBar
              label="Emails sent"
              used={emailsSent}
              limit={emailLimit}
              icon={<Mail className="h-3.5 w-3.5 text-muted-foreground" />}
            />
            <UsageBar
              label="Campaign runs"
              used={campaignUsage?.campaigns_run || 0}
              limit={org.plan_campaign_limit || 5}
              icon={<Target className="h-3.5 w-3.5 text-muted-foreground" />}
            />
            <UsageBar
              label="Domains"
              used={resourceCounts?.domains || 0}
              limit={org.plan_domain_limit || 1}
              icon={<Globe className="h-3.5 w-3.5 text-muted-foreground" />}
            />
            <UsageBar
              label="Sending emails"
              used={resourceCounts?.emails || 0}
              limit={org.plan_email_address_limit || 2}
              icon={<Mail className="h-3.5 w-3.5 text-muted-foreground" />}
            />
            <UsageBar
              label="Team members"
              used={resourceCounts?.members || 0}
              limit={org.plan_member_limit || 3}
              icon={<Users className="h-3.5 w-3.5 text-muted-foreground" />}
            />
          </CardContent>
        </Card>
      </div>

      {/* Plan Options */}
      {!isSubscribed && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Choose a Plan</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Starter */}
            <Card className={org.plan === "starter" ? "border-primary" : ""}>
              <CardHeader>
                <CardTitle>Starter</CardTitle>
                <CardDescription>For small teams getting started</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-3xl font-bold">$19<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />1,000 emails / month</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />5 campaign runs / month</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />5 prospects per campaign</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />1 domain</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />2 sending emails</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />3 team members</li>
                </ul>
                <Button
                  className="w-full"
                  variant={org.plan === "starter" ? "outline" : "default"}
                  disabled={org.plan === "starter" || loadingPlan === STARTER_PRICE_ID}
                  onClick={() => handleSubscribe(STARTER_PRICE_ID)}
                >
                  {loadingPlan === STARTER_PRICE_ID && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {org.plan === "starter" ? "Current Plan" : "Subscribe"}
                </Button>
              </CardContent>
            </Card>

            {/* Plus */}
            <Card className="border-primary relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-primary text-primary-foreground">Popular</Badge>
              </div>
              <CardHeader>
                <CardTitle>Plus</CardTitle>
                <CardDescription>For scaling teams</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-3xl font-bold">$49<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />5,000 emails / month</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />20 campaign runs / month</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />5 prospects per campaign</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />3 domains</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />5 sending emails</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />10 team members</li>
                </ul>
                <Button
                  className="w-full"
                  disabled={org.plan === "growth" || loadingPlan === GROWTH_PRICE_ID}
                  onClick={() => handleSubscribe(GROWTH_PRICE_ID)}
                >
                  {loadingPlan === GROWTH_PRICE_ID && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {org.plan === "growth" ? "Current Plan" : "Subscribe"}
                </Button>
              </CardContent>
            </Card>

            {/* Enterprise — commented out for now
            <Card>
              <CardHeader>
                <CardTitle>Enterprise</CardTitle>
                <CardDescription>For large organizations</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-3xl font-bold">Custom</p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />Unlimited emails</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />Unlimited campaign runs</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />Custom domains</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />Unlimited members</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />Dedicated support</li>
                </ul>
                <Button variant="outline" className="w-full" asChild>
                  <a href="mailto:support@mora.app">Contact Us</a>
                </Button>
              </CardContent>
            </Card>
            */}
          </div>
        </div>
      )}

      {/* Upgrade option for existing subscribers */}
      {org.plan === "starter" && org.billing_status === "active" && (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="font-medium">Need more capacity?</p>
              <p className="text-sm text-muted-foreground">Upgrade to Plus for 5,000 emails, 20 campaign runs, 3 domains, and 10 members.</p>
            </div>
            <Button
              disabled={loadingPlan === GROWTH_PRICE_ID}
              onClick={() => handleSubscribe(GROWTH_PRICE_ID)}
            >
              {loadingPlan === GROWTH_PRICE_ID && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Upgrade to Plus
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
