import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CreditCard, Mail, Clock, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

const STARTER_PRICE_ID = import.meta.env.VITE_STRIPE_STARTER_PRICE_ID;
const GROWTH_PRICE_ID = import.meta.env.VITE_STRIPE_GROWTH_PRICE_ID;

const planDetails: Record<string, { name: string; price: string; emails: string }> = {
  trial: { name: "Free Trial", price: "Free", emails: "500 / month" },
  starter: { name: "Starter", price: "$10/mo", emails: "500 / month" },
  growth: { name: "Growth", price: "$29/mo", emails: "2,000 / month" },
  enterprise: { name: "Enterprise", price: "Custom", emails: "Unlimited" },
  canceled: { name: "Canceled", price: "—", emails: "—" },
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
  });

  const currentMonth = new Date().toISOString().slice(0, 7);
  const { data: usage } = useQuery({
    queryKey: ["email-usage", organizationId, currentMonth],
    queryFn: async () => {
      const { data } = await supabase
        .from("email_usage")
        .select("emails_sent")
        .eq("organization_id", organizationId!)
        .eq("month", currentMonth)
        .maybeSingle();
      return data?.emails_sent || 0;
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
  const emailsSent = usage || 0;
  const emailLimit = org.plan_email_limit || 500;
  const usagePercent = Math.min((emailsSent / emailLimit) * 100, 100);

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

        {/* Usage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Email Usage
            </CardTitle>
            <CardDescription>
              {new Date().toLocaleString("default", { month: "long", year: "numeric" })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span>{emailsSent.toLocaleString()} sent</span>
                <span>{emailLimit.toLocaleString()} limit</span>
              </div>
              <Progress value={usagePercent} className="h-2" />
            </div>
            {usagePercent >= 90 && (
              <div className="flex items-center gap-2 text-sm text-yellow-600">
                <AlertTriangle className="h-4 w-4" />
                {usagePercent >= 100 ? "Monthly limit reached" : "Approaching monthly limit"}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Plan Options */}
      {!isSubscribed && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Choose a Plan</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {/* Starter */}
            <Card className={org.plan === "starter" ? "border-primary" : ""}>
              <CardHeader>
                <CardTitle>Starter</CardTitle>
                <CardDescription>For small teams getting started</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-3xl font-bold">$10<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />500 emails / month</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />Unlimited sequences</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />Team collaboration</li>
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

            {/* Growth */}
            <Card className="border-primary relative">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <Badge className="bg-primary text-primary-foreground">Popular</Badge>
              </div>
              <CardHeader>
                <CardTitle>Growth</CardTitle>
                <CardDescription>For scaling teams</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-3xl font-bold">$29<span className="text-sm font-normal text-muted-foreground">/mo</span></p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />2,000 emails / month</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />Unlimited sequences</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />Team collaboration</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />Priority support</li>
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

            {/* Enterprise */}
            <Card>
              <CardHeader>
                <CardTitle>Enterprise</CardTitle>
                <CardDescription>For large organizations</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-3xl font-bold">Custom</p>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />Unlimited emails</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />Unlimited sequences</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />Dedicated support</li>
                  <li className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-green-500" />Custom integrations</li>
                </ul>
                <Button variant="outline" className="w-full" asChild>
                  <a href="mailto:support@mora.app">Contact Us</a>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Upgrade option for existing subscribers */}
      {org.plan === "starter" && org.billing_status === "active" && (
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="font-medium">Need more emails?</p>
              <p className="text-sm text-muted-foreground">Upgrade to Growth for 2,000 emails/month.</p>
            </div>
            <Button
              disabled={loadingPlan === GROWTH_PRICE_ID}
              onClick={() => handleSubscribe(GROWTH_PRICE_ID)}
            >
              {loadingPlan === GROWTH_PRICE_ID && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Upgrade to Growth
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
