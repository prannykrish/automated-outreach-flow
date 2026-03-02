import React, { createContext, useContext, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

export interface OnboardingStep {
  id: string;
  label: string;
  description: string;
  href: string | null;
  required: boolean;
}

const ADMIN_STEPS: OnboardingStep[] = [
  { id: "domain_setup", label: "Set up a domain", description: "Add and verify your sending domain for better deliverability", href: "/organization#domains", required: true },
  { id: "email_connection", label: "Connect a sending email", description: "Add a sending email address to your organization", href: "/organization#emails", required: true },
  { id: "create_template", label: "Create a template", description: "Write your first outreach email template", href: "/templates", required: true },
  { id: "create_sequence", label: "Create a sequence", description: "Build a follow-up sequence with your template", href: "/sequences", required: true },
  { id: "add_prospect", label: "Add a prospect", description: "Add your first potential customer to the pipeline", href: "/customers", required: true },
  { id: "view_pipeline", label: "Explore the pipeline", description: "See how prospects move through your outreach stages", href: "/pipeline", required: false },
  { id: "view_inbox", label: "Check your inbox", description: "See replies from prospects in one unified inbox", href: "/inbox", required: false },
  { id: "campaign_agent", label: "Run a campaign", description: "Use the AI agent to find prospects and send targeted outreach", href: null, required: false },
  { id: "invite_member", label: "Invite a team member", description: "Add your colleagues to collaborate on outreach", href: "/organization#members", required: false },
];

const MEMBER_STEPS: OnboardingStep[] = [
  { id: "view_inbox", label: "Check your inbox", description: "See replies from prospects in one unified inbox", href: "/inbox", required: true },
  { id: "view_pipeline", label: "Explore the pipeline", description: "See how prospects move through outreach stages", href: "/pipeline", required: true },
  { id: "view_templates", label: "Browse templates", description: "Explore email templates your team has created", href: "/templates", required: false },
  { id: "create_template", label: "Create a template", description: "Write your first outreach email template", href: "/templates", required: false },
  { id: "campaign_agent", label: "Run a campaign", description: "Use the AI agent to find prospects and send targeted outreach", href: null, required: false },
];

const PAGE_TO_STEP: Record<string, string> = {
  "/pipeline": "view_pipeline",
  "/inbox": "view_inbox",
  "/templates": "view_templates",
};

interface OnboardingContextValue {
  steps: OnboardingStep[];
  completedSteps: string[];
  isLoading: boolean;
  membership: "admin" | "member" | null;
  allRequiredDone: boolean;
  requiredDoneCount: number;
  requiredTotal: number;
  isDismissed: boolean;
  isSuperAdmin: boolean;
  completeStep: (stepId: string) => void;
  dismiss: () => void;
  skipTutorial: () => void;
  emailUsage: number;
  emailLimit: number;
  isTrialOrg: boolean;
}

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined);

export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const { user, organizationId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const location = useLocation();
  const notifiedNearLimit = useRef(false);
  const notifiedComplete = useRef(false);
  const notifiedExpired = useRef(false);

  // Check if user is super admin
  const { data: isSuperAdmin } = useQuery({
    queryKey: ["onboarding-super-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("users")
        .select("is_super_admin")
        .eq("id", user!.id)
        .maybeSingle();
      return data?.is_super_admin === true;
    },
    enabled: !!user?.id,
  });

  // Fetch user's org role
  const { data: membership } = useQuery({
    queryKey: ["onboarding-membership", user?.id, organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("organization_members")
        .select("role")
        .eq("user_id", user!.id)
        .eq("organization_id", organizationId!)
        .maybeSingle();
      return (data?.role as "admin" | "member") || null;
    },
    enabled: !!user?.id && !!organizationId,
  });

  // Fetch org info for trial checks
  const { data: org } = useQuery({
    queryKey: ["onboarding-org", organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("organizations")
        .select("plan, trial_ends_at, trial_email_total_limit")
        .eq("id", organizationId!)
        .single();
      return data;
    },
    enabled: !!organizationId,
  });

  // Fetch lifetime email usage for trial orgs
  const { data: emailUsage } = useQuery({
    queryKey: ["onboarding-email-usage", organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("email_usage")
        .select("emails_sent")
        .eq("organization_id", organizationId!);
      return (data || []).reduce((sum: number, row: any) => sum + (row.emails_sent || 0), 0);
    },
    enabled: !!organizationId && org?.plan === "trial",
    refetchInterval: 60000,
  });

  // Fetch onboarding progress
  const { data: progress, isLoading } = useQuery({
    queryKey: ["onboarding-progress", user?.id, organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("onboarding_progress")
        .select("*")
        .eq("user_id", user!.id)
        .eq("organization_id", organizationId!)
        .maybeSingle();
      return data;
    },
    enabled: !!user?.id && !!organizationId,
  });

  // Init progress row if it doesn't exist
  const initMutation = useMutation({
    mutationFn: async (role: "admin" | "member") => {
      await supabase.from("onboarding_progress").upsert(
        {
          user_id: user!.id,
          organization_id: organizationId!,
          role,
          completed_steps: [],
          dismissed: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,organization_id", ignoreDuplicates: true }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-progress", user?.id, organizationId] });
    },
  });

  // Complete a step
  const completeStepMutation = useMutation({
    mutationFn: async (stepId: string) => {
      if (!progress) return;
      const currentSteps = progress.completed_steps || [];
      if (currentSteps.includes(stepId)) return; // already done

      const newSteps = [...currentSteps, stepId];
      const steps = membership === "admin" ? ADMIN_STEPS : MEMBER_STEPS;
      const requiredSteps = steps.filter((s) => s.required).map((s) => s.id);
      const allRequiredDone = requiredSteps.every((id) => newSteps.includes(id));

      await supabase
        .from("onboarding_progress")
        .update({
          completed_steps: newSteps,
          completed_at: allRequiredDone ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", user!.id)
        .eq("organization_id", organizationId!);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-progress", user?.id, organizationId] });
    },
  });

  // Dismiss checklist
  const dismissMutation = useMutation({
    mutationFn: async () => {
      await supabase
        .from("onboarding_progress")
        .update({ dismissed: true, updated_at: new Date().toISOString() })
        .eq("user_id", user!.id)
        .eq("organization_id", organizationId!);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-progress", user?.id, organizationId] });
    },
  });

  // Skip tutorial entirely
  const skipMutation = useMutation({
    mutationFn: async () => {
      await supabase
        .from("onboarding_progress")
        .update({ dismissed: true, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("user_id", user!.id)
        .eq("organization_id", organizationId!);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["onboarding-progress", user?.id, organizationId] });
    },
  });

  // Init row when membership is known and no row exists
  useEffect(() => {
    if (membership && !progress && !isLoading && user?.id && organizationId) {
      initMutation.mutate(membership);
    }
  }, [membership, progress, isLoading, user?.id, organizationId]);

  // Auto-complete page-visit steps
  useEffect(() => {
    const stepId = PAGE_TO_STEP[location.pathname];
    if (stepId && progress && !(progress.completed_steps || []).includes(stepId) && !progress.dismissed) {
      completeStepMutation.mutate(stepId);
    }
  }, [location.pathname, progress]);

  // Toast: near trial limit
  useEffect(() => {
    if (
      !notifiedNearLimit.current &&
      org?.plan === "trial" &&
      emailUsage !== undefined &&
      emailUsage !== null
    ) {
      const limit = org.trial_email_total_limit || 200;
      if (emailUsage >= Math.floor(limit * 0.75) && emailUsage < limit) {
        notifiedNearLimit.current = true;
        toast({
          title: "Approaching trial limit",
          description: `You've sent ${emailUsage} of your ${limit} free trial emails. Upgrade to keep sending.`,
        });
      }
    }
  }, [emailUsage, org]);

  // Toast: onboarding complete
  useEffect(() => {
    if (!notifiedComplete.current && progress?.completed_at && !progress.dismissed) {
      notifiedComplete.current = true;
      toast({ title: "Setup complete!", description: "You're all set up. Time to start reaching out." });
    }
  }, [progress?.completed_at]);

  // Toast: trial expired
  useEffect(() => {
    if (!notifiedExpired.current && org?.plan === "trial" && org.trial_ends_at) {
      if (new Date(org.trial_ends_at) < new Date()) {
        notifiedExpired.current = true;
        toast({
          title: "Trial expired",
          description: "Your free trial has ended. Upgrade to continue sending emails.",
          variant: "destructive",
        });
      }
    }
  }, [org]);

  const steps = membership === "admin" ? ADMIN_STEPS : MEMBER_STEPS;
  const completedSteps = progress?.completed_steps || [];
  const requiredSteps = steps.filter((s) => s.required);
  const requiredDoneCount = requiredSteps.filter((s) => completedSteps.includes(s.id)).length;
  const allRequiredDone = requiredSteps.every((s) => completedSteps.includes(s.id));

  const value: OnboardingContextValue = {
    steps,
    completedSteps,
    isLoading,
    membership: membership || null,
    allRequiredDone,
    requiredDoneCount,
    requiredTotal: requiredSteps.length,
    isDismissed: progress?.dismissed ?? false,
    isSuperAdmin: isSuperAdmin === true,
    completeStep: (stepId: string) => completeStepMutation.mutate(stepId),
    dismiss: () => dismissMutation.mutate(),
    skipTutorial: () => skipMutation.mutate(),
    emailUsage: emailUsage ?? 0,
    emailLimit: org?.trial_email_total_limit ?? 200,
    isTrialOrg: org?.plan === "trial",
  };

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboardingContext() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboardingContext must be used within OnboardingProvider");
  return ctx;
}
