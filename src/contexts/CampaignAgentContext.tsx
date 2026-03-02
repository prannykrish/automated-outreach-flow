import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAgent } from "@/contexts/AgentContext";
import type {
  CampaignPlan,
  Prospect,
  EmailDraft,
  ActivityLogEntry,
  CampaignState,
  SearchStats,
} from "@/hooks/useCampaignAgent";

export interface CampaignHistoryItem {
  id: string;
  title: string;
  status: string;
  user_prompt: string | null;
  created_at: string;
}

export interface CompanyProfile {
  id?: string;
  company_description: string;
  problem_solved: string;
  tone: string;
  key_message: string;
  target_roles: string[];
  target_industries: string[];
  company_size: string;
  company_stage: string;
  icp_keywords: string[];
  messaging_notes: string;
  preferred_sources: string[];
}

export type SendMode = "immediate" | "scheduled" | "per_prospect";

export type EmailMode = "auto" | "template";

export interface OrgEmail {
  id: string;
  email: string;
  display_name: string | null;
}

export interface SpamRiskResult {
  warnings: string[];
  stats: { dailySent: number; hourlySent: number; bounceRate: number; complaintRate: number };
}

interface CampaignAgentContextValue {
  campaignState: CampaignState;
  isRunning: boolean;
  streamingText: string;
  currentStep: string | null;
  runCampaign: (userPrompt: string, opts?: { selectedSequenceId?: string; emailMode?: EmailMode; senderEmailOverride?: string; sendMode?: SendMode }) => Promise<void>;
  approveCampaign: (senderEmailOverride?: string, singleProspectId?: string, sendMode?: SendMode) => Promise<void>;
  saveAsTemplates: () => Promise<void>;
  isSavingTemplates: boolean;
  stopAgent: () => void;
  reset: () => void;
  loadCampaign: (campaignId: string) => Promise<void>;
  campaignHistory: CampaignHistoryItem[];
  isLoadingHistory: boolean;
  refetchHistory: () => void;
  senderEmail: string | null;
  orgEmails: OrgEmail[];
  companyProfile: CompanyProfile | null;
  isLoadingProfile: boolean;
  saveCompanyProfile: (profile: CompanyProfile) => Promise<void>;
  isSavingProfile: boolean;
  searchStats: SearchStats | null;
  spamWarnings: string[];
  checkSpamRisk: () => Promise<SpamRiskResult | null>;
  domainVerification: { hasAnyDomain: boolean; hasVerified: boolean; unverifiedDomains: string[] } | undefined;
}

const CampaignAgentContext = createContext<CampaignAgentContextValue | undefined>(undefined);

export const CampaignAgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, organizationId, user } = useAuth();
  const { setAgentRunning } = useAgent();
  const queryClient = useQueryClient();

  const [campaignState, setCampaignState] = useState<CampaignState>({
    campaignId: null,
    status: "idle",
    userPrompt: null,
    plan: null,
    prospects: [],
    drafts: [],
    activityLog: [],
    warnings: [],
  });

  const [isRunning, setIsRunning] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [searchStats, setSearchStats] = useState<SearchStats | null>(null);
  const [isSavingTemplates, setIsSavingTemplates] = useState(false);
  const [spamWarnings, setSpamWarnings] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch all org emails
  const { data: orgEmails = [] } = useQuery({
    queryKey: ["org-emails", organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("organization_emails")
        .select("id, email, display_name, is_default")
        .eq("organization_id", organizationId!)
        .order("is_default", { ascending: false });
      return (data || []) as (OrgEmail & { is_default?: boolean })[];
    },
    enabled: !!organizationId,
  });

  // Default sender email (first default, or first available)
  const senderEmail = orgEmails.length > 0 ? orgEmails[0].email : null;

  // Domain verification status (for deliverability warnings)
  const { data: domainVerification } = useQuery({
    queryKey: ["domain-verification", organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("organization_domains")
        .select("domain, verified")
        .eq("organization_id", organizationId!);
      const domains = data || [];
      const hasVerified = domains.some((d: any) => d.verified);
      const unverified = domains.filter((d: any) => !d.verified).map((d: any) => d.domain);
      return { hasAnyDomain: domains.length > 0, hasVerified, unverifiedDomains: unverified };
    },
    enabled: !!organizationId,
  });

  // Fetch company profile
  const { data: companyProfile = null, isLoading: isLoadingProfile } = useQuery({
    queryKey: ["company-profile", organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("company_profiles")
        .select("*")
        .eq("organization_id", organizationId!)
        .maybeSingle();
      return data as CompanyProfile | null;
    },
    enabled: !!organizationId,
  });

  // Save company profile
  const { mutateAsync: saveCompanyProfile, isPending: isSavingProfile } = useMutation({
    mutationFn: async (profile: CompanyProfile) => {
      const { error } = await supabase
        .from("company_profiles")
        .upsert({
          organization_id: organizationId!,
          company_description: profile.company_description,
          problem_solved: profile.problem_solved,
          tone: profile.tone,
          key_message: profile.key_message,
          target_roles: profile.target_roles || [],
          target_industries: profile.target_industries || [],
          company_size: profile.company_size || "",
          company_stage: profile.company_stage || "",
          icp_keywords: profile.icp_keywords || [],
          messaging_notes: profile.messaging_notes || "",
          preferred_sources: profile.preferred_sources || [],
          updated_at: new Date().toISOString(),
        }, { onConflict: "organization_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-profile", organizationId] });
    },
  });

  // Fetch campaign history from DB
  const { data: campaignHistory = [], isLoading: isLoadingHistory, refetch: refetchHistory } = useQuery({
    queryKey: ["campaign-history", organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("agent_campaigns")
        .select("id, title, status, user_prompt, created_at")
        .eq("organization_id", organizationId!)
        .order("created_at", { ascending: false })
        .limit(20);
      return (data || []) as CampaignHistoryItem[];
    },
    enabled: !!organizationId,
  });

  const addActivity = useCallback((step: string, message: string) => {
    setCampaignState((prev) => ({
      ...prev,
      activityLog: [...prev.activityLog, {
        id: crypto.randomUUID(),
        step,
        message,
        created_at: new Date().toISOString(),
      }],
    }));
  }, []);

  // Load a past campaign from the database
  const loadCampaign = useCallback(async (campaignId: string) => {
    const [
      { data: campaign },
      { data: prospects },
      { data: drafts },
      { data: activityLog },
    ] = await Promise.all([
      supabase.from("agent_campaigns").select("*").eq("id", campaignId).single(),
      supabase.from("agent_prospects").select("*").eq("campaign_id", campaignId).neq("status", "rejected").order("confidence_score", { ascending: false }),
      supabase.from("agent_email_drafts").select("id, prospect_id, step_number, subject, body, status, delay_days, scheduled_for, send_at").eq("campaign_id", campaignId).order("step_number", { ascending: true }),
      supabase.from("agent_activity_log").select("id, step, message, detail, created_at").eq("campaign_id", campaignId).order("created_at", { ascending: true }),
    ]);

    if (!campaign) return;

    setCampaignState({
      campaignId: campaign.id,
      status: campaign.status,
      userPrompt: campaign.user_prompt,
      plan: campaign.plan as CampaignPlan | null,
      prospects: (prospects || []).map((p: any) => ({ ...p, risk_flags: p.risk_flags || [] })),
      drafts: (drafts || []) as EmailDraft[],
      activityLog: (activityLog || []) as ActivityLogEntry[],
      warnings: (campaign.warnings as string[]) || [],
    });

    // Restore search stats if available
    if (campaign.search_stats && typeof campaign.search_stats === "object") {
      const ss = campaign.search_stats as any;
      setSearchStats({
        queriesUsed: ss.queries_used || 0,
        pagesScraped: ss.pages_scraped || 0,
        prospectsFound: ss.prospects_found || 0,
        targetCount: campaign.max_prospects || 20,
        stoppedReason: ss.stopped_reason || null,
      });
    }

    setIsRunning(false);
    setCurrentStep(null);
    setStreamingText("");
  }, []);

  // Run the full campaign pipeline
  const runCampaign = useCallback(async (
    userPrompt: string,
    opts?: { selectedSequenceId?: string; emailMode?: EmailMode; senderEmailOverride?: string; sendMode?: SendMode }
  ) => {
    if (!organizationId || !session || !user) return;
    setIsRunning(true);
    setStreamingText("");
    setCurrentStep("planning");
    setSearchStats(null);
    setCampaignState({
      campaignId: null,
      status: "planning",
      userPrompt,
      plan: null,
      prospects: [],
      drafts: [],
      activityLog: [],
      warnings: [],
    });

    addActivity("planning", "Starting campaign planning...");
    setAgentRunning(true, "Planning campaign...");

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/mora-campaign-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": supabaseAnonKey,
        },
        body: JSON.stringify({
          userPrompt,
          organizationId,
          userId: user.id,
          ...(opts?.selectedSequenceId && { selectedSequenceId: opts.selectedSequenceId }),
          emailMode: opts?.emailMode || "auto",
          ...(opts?.senderEmailOverride && { senderEmail: opts.senderEmailOverride }),
          ...(opts?.sendMode && { sendMode: opts.sendMode }),
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `Request failed: ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let receivedDone = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const event = JSON.parse(data);

            switch (event.type) {
              case "user_prompt":
                setCampaignState((prev) => ({ ...prev, userPrompt: event.text }));
                break;
              case "step":
                setCurrentStep(event.step);
                addActivity(event.step, event.message);
                setAgentRunning(true, event.message);
                break;
              case "plan":
                setCampaignState((prev) => ({
                  ...prev,
                  campaignId: event.campaignId,
                  status: "researching",
                  plan: event.plan,
                }));
                addActivity("icp_interpreter", "ICP filters parsed and campaign plan ready.");
                break;
              case "prospects":
                setCampaignState((prev) => ({
                  ...prev,
                  status: "drafting",
                  prospects: event.prospects,
                }));
                addActivity("research_summary", `Found ${event.prospects.length} qualified prospects with research summaries.`);
                break;
              case "drafts":
                setCampaignState((prev) => ({
                  ...prev,
                  status: "review",
                  drafts: event.drafts,
                  warnings: event.warnings || [],
                }));
                addActivity("drafting", `Generated ${event.drafts.length} email drafts.`);
                break;
              case "search_stats":
                setSearchStats(event.stats);
                break;
              case "text":
                setStreamingText((prev) => prev + event.text);
                break;
              case "status":
                addActivity(currentStep || "processing", event.text);
                break;
              case "error": {
                // Clean up technical error messages for users
                const rawMsg = event.error || "Something went wrong";
                const userMsg = rawMsg.includes("timeout") || rawMsg.includes("Timeout")
                  ? "Campaign took too long to complete. Try requesting fewer prospects."
                  : rawMsg.includes("RESEND") || rawMsg.includes("resend")
                    ? "Email service is temporarily unavailable. Please try again shortly."
                    : rawMsg.includes("rate limit") || rawMsg.includes("429")
                      ? "Too many requests. Please wait a moment and try again."
                      : `Campaign could not be completed: ${rawMsg.replace(/Campaign failed: /i, "")}`;
                addActivity("error", userMsg);
                setCampaignState((prev) => ({ ...prev, status: "failed" }));
                break;
              }
              case "done":
                receivedDone = true;
                break;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
      // If the stream ended without a proper "done" event, the edge function likely timed out
      if (!receivedDone) {
        setCampaignState((prev) => {
          if (prev.prospects.length > 0 && prev.status !== "review" && prev.status !== "completed") {
            addActivity("completed", "Search complete. You can review and approve the prospects found so far.");
            return { ...prev, status: "review", warnings: [...prev.warnings, "Some results may be incomplete. You can still approve what was found."] };
          }
          if (prev.status !== "review" && prev.status !== "completed" && prev.status !== "idle") {
            addActivity("error", "Campaign took too long to complete. Try requesting fewer prospects or a more specific audience.");
            return { ...prev, status: "failed" };
          }
          return prev;
        });
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        const msg = err.message?.includes("fetch")
          ? "Network error. Check your connection and try again."
          : err.message || "Something went wrong. Please try again.";
        addActivity("error", msg);
        setCampaignState((prev) => ({ ...prev, status: "failed" }));
      }
    } finally {
      setIsRunning(false);
      setCurrentStep(null);
      setAgentRunning(false);
      abortRef.current = null;
      refetchHistory();
    }
  }, [organizationId, session, user, addActivity, currentStep, refetchHistory, setAgentRunning]);

  const approveCampaign = useCallback(async (senderEmailOverride?: string, singleProspectId?: string, sendMode?: SendMode) => {
    if (!campaignState.campaignId || !session || !user) return;

    setIsRunning(true);
    setCurrentStep("executing");
    addActivity("executing", "Sending approved emails...");
    setAgentRunning(true, "Sending emails...");

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/mora-campaign-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": supabaseAnonKey,
        },
        body: JSON.stringify({
          action: "approve",
          campaignId: campaignState.campaignId,
          organizationId,
          userId: user.id,
          ...(senderEmailOverride && { senderEmail: senderEmailOverride }),
          ...(singleProspectId && { singleProspectId }),
          ...(sendMode && { sendMode }),
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to execute campaign");
      }

      const result = await response.json();
      setCampaignState((prev) => ({ ...prev, status: "completed" }));

      const failedMsg = result.failed > 0 ? ` ${result.failed} failed.` : "";
      const scheduledMsg = result.scheduled > 0 ? ` ${result.scheduled} follow-ups scheduled.` : "";
      addActivity("executing", `Campaign complete. ${result.sent || 0} emails sent.${scheduledMsg}${failedMsg}`);

      queryClient.invalidateQueries({ queryKey: ["inbox-emails"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-customers"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      refetchHistory();
    } catch (err: any) {
      addActivity("error", err.message);
      setCampaignState((prev) => ({ ...prev, status: "failed" }));
    } finally {
      setIsRunning(false);
      setCurrentStep(null);
      setAgentRunning(false);
    }
  }, [campaignState.campaignId, session, user, organizationId, addActivity, queryClient, refetchHistory, setAgentRunning]);

  // Save campaign drafts as reusable templates
  const saveAsTemplates = useCallback(async () => {
    if (!campaignState.campaignId || !session || !user) return;
    setIsSavingTemplates(true);

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/mora-campaign-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": supabaseAnonKey,
        },
        body: JSON.stringify({
          action: "create_templates",
          campaignId: campaignState.campaignId,
          organizationId,
          userId: user.id,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to create templates");
      }

      const result = await response.json();
      addActivity("completed", `Saved ${result.templates_created} templates to your Templates page.`);

      queryClient.invalidateQueries({ queryKey: ["email-templates"] });
      queryClient.invalidateQueries({ queryKey: ["template-folders"] });
    } catch (err: any) {
      addActivity("error", `Failed to save templates: ${err.message}`);
    } finally {
      setIsSavingTemplates(false);
    }
  }, [campaignState.campaignId, session, user, organizationId, addActivity, queryClient]);

  const stopAgent = useCallback(() => {
    abortRef.current?.abort();
    setAgentRunning(false);
  }, [setAgentRunning]);

  const checkSpamRisk = useCallback(async (): Promise<SpamRiskResult | null> => {
    if (!session || !organizationId) return null;
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(`${supabaseUrl}/functions/v1/mora-campaign-agent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`,
          "apikey": supabaseAnonKey,
        },
        body: JSON.stringify({ action: "check_spam_risk", organizationId }),
      });
      if (!response.ok) return null;
      const result = await response.json() as SpamRiskResult;
      setSpamWarnings(result.warnings);
      return result;
    } catch {
      return null;
    }
  }, [session, organizationId]);

  const reset = useCallback(() => {
    setCampaignState({
      campaignId: null,
      status: "idle",
      userPrompt: null,
      plan: null,
      prospects: [],
      drafts: [],
      activityLog: [],
      warnings: [],
    });
    setStreamingText("");
    setCurrentStep(null);
    setIsRunning(false);
    setSearchStats(null);
    setSpamWarnings([]);
  }, []);

  return (
    <CampaignAgentContext.Provider
      value={{
        campaignState,
        isRunning,
        streamingText,
        currentStep,
        runCampaign,
        approveCampaign,
        saveAsTemplates,
        isSavingTemplates,
        stopAgent,
        reset,
        loadCampaign,
        campaignHistory,
        isLoadingHistory,
        refetchHistory,
        senderEmail,
        orgEmails,
        companyProfile,
        isLoadingProfile,
        saveCompanyProfile,
        isSavingProfile,
        searchStats,
        spamWarnings,
        checkSpamRisk,
        domainVerification,
      }}
    >
      {children}
    </CampaignAgentContext.Provider>
  );
};

export const useCampaignAgentContext = () => {
  const ctx = useContext(CampaignAgentContext);
  if (!ctx) throw new Error("useCampaignAgentContext must be used within CampaignAgentProvider");
  return ctx;
};
