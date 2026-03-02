import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface CampaignPlan {
  icp: {
    roles: string[];
    industries: string[];
    company_size: string;
    geography: string;
    other_criteria: string;
  };
  desired_person_count: number;
  campaign_structure: {
    sequence_length: number;
    tone: string;
    key_value_prop: string;
  };
  personalization_fields: string[];
}

export interface Prospect {
  id: string;
  name: string | null;
  email: string | null;
  company: string | null;
  title: string | null;
  source: string;
  source_url: string | null;
  email_source_location: string | null;
  evidence_of_fit: string | null;
  summary: string | null;
  confidence_score: number | null;
  linkedin_url: string | null;
  enrichment: {
    evidence_of_fit: string;
    summary: string;
    source_url: string;
  } | null;
  risk_flags: string[];
  status: string;
}

export interface EmailDraft {
  id: string;
  prospect_id: string;
  step_number: number;
  subject: string;
  body: string;
  status: string;
  delay_days?: number;
  scheduled_for?: string;
  send_at?: string;
}

export interface ActivityLogEntry {
  id: string;
  step: string;
  message: string;
  detail?: any;
  created_at: string;
}

export interface SearchStats {
  queriesUsed: number;
  pagesScraped: number;
  prospectsFound: number;
  targetCount: number;
  stoppedReason: string | null;
}

export interface CampaignState {
  campaignId: string | null;
  status: string;
  userPrompt: string | null;
  plan: CampaignPlan | null;
  prospects: Prospect[];
  drafts: EmailDraft[];
  activityLog: ActivityLogEntry[];
  warnings: string[];
}

export function useCampaignAgent() {
  const { session, organizationId, user } = useAuth();
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
  const abortRef = useRef<AbortController | null>(null);

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

  // Run the full campaign pipeline
  const runCampaign = useCallback(async (userPrompt: string, selectedSequenceId?: string) => {
    if (!organizationId || !session || !user) return;
    setIsRunning(true);
    setStreamingText("");
    setCurrentStep("planning");
    setCampaignState({
      campaignId: null,
      status: "planning",
      userPrompt: null,
      plan: null,
      prospects: [],
      drafts: [],
      activityLog: [],
      warnings: [],
    });

    addActivity("planning", "Starting campaign planning...");

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
          ...(selectedSequenceId && { selectedSequenceId }),
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `Request failed: ${response.status}`);
      }

      // Parse SSE stream
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
                break;

              case "plan":
                setCampaignState((prev) => ({
                  ...prev,
                  campaignId: event.campaignId,
                  status: "researching",
                  plan: event.plan,
                }));
                addActivity("planning", "Campaign plan ready.");
                break;

              case "prospects":
                setCampaignState((prev) => ({
                  ...prev,
                  status: "drafting",
                  prospects: event.prospects,
                }));
                addActivity("researching", `Found ${event.prospects.length} valid prospects.`);
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

              case "text":
                setStreamingText((prev) => prev + event.text);
                break;

              case "status":
                addActivity(currentStep || "processing", event.text);
                break;

              case "error":
                addActivity("error", event.error);
                setCampaignState((prev) => ({ ...prev, status: "failed" }));
                break;

              case "done":
                break;
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        addActivity("error", err.message || "Campaign failed");
        setCampaignState((prev) => ({ ...prev, status: "failed" }));
      }
    } finally {
      setIsRunning(false);
      setCurrentStep(null);
      abortRef.current = null;
    }
  }, [organizationId, session, user, addActivity, currentStep]);

  // Approve the campaign — triggers execution
  const approveCampaign = useCallback(async () => {
    if (!campaignState.campaignId || !session) return;

    setIsRunning(true);
    setCurrentStep("executing");
    addActivity("executing", "Sending approved emails...");

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
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to execute campaign");
      }

      const result = await response.json();
      setCampaignState((prev) => ({ ...prev, status: "completed" }));
      addActivity("executing", `Campaign complete. ${result.sent || 0} emails sent.`);

      // Refresh inbox/email data
      queryClient.invalidateQueries({ queryKey: ["inbox-emails"] });
      queryClient.invalidateQueries({ queryKey: ["pipeline-customers"] });
    } catch (err: any) {
      addActivity("error", err.message);
      setCampaignState((prev) => ({ ...prev, status: "failed" }));
    } finally {
      setIsRunning(false);
      setCurrentStep(null);
    }
  }, [campaignState.campaignId, session, organizationId, addActivity, queryClient]);

  const stopAgent = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    setCampaignState({
      campaignId: null,
      status: "idle",
      plan: null,
      prospects: [],
      drafts: [],
      activityLog: [],
      warnings: [],
    });
    setStreamingText("");
    setCurrentStep(null);
    setIsRunning(false);
  }, []);

  return {
    campaignState,
    isRunning,
    streamingText,
    currentStep,
    runCampaign,
    approveCampaign,
    stopAgent,
    reset,
  };
}
