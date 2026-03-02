import { useAgent } from "@/contexts/AgentContext";
import { useCampaignAgentContext } from "@/contexts/CampaignAgentContext";
import MoraIcon from "@/components/MoraIcon";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useEffect, useState, useRef } from "react";

export default function CampaignProgressBar() {
  const { isCommandBarOpen, openCommandBar, isAgentRunning, agentStatusText } = useAgent();
  const { campaignState } = useCampaignAgentContext();
  const [showCompleted, setShowCompleted] = useState(false);
  const wasRunning = useRef(false);

  // Show a brief "completed" bar only when agent transitions from running → finished
  useEffect(() => {
    if (isAgentRunning) {
      wasRunning.current = true;
    } else if (wasRunning.current && (campaignState.status === "completed" || campaignState.status === "failed" || campaignState.status === "review")) {
      wasRunning.current = false;
      setShowCompleted(true);
      const timer = setTimeout(() => setShowCompleted(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [isAgentRunning, campaignState.status]);

  const shouldShow = (!isCommandBarOpen) && (isAgentRunning || showCompleted);
  if (!shouldShow) return null;

  const isComplete = !isAgentRunning && campaignState.status === "completed";
  const isFailed = !isAgentRunning && campaignState.status === "failed";
  const isReview = !isAgentRunning && campaignState.status === "review";

  // Colored bars (green/red/blue) have white text → white logo
  // Default bar uses bg-primary which is dark in light mode / light in dark mode → invert from auto
  const logoVariant = (isComplete || isFailed || isReview) ? "white" as const : "invert" as const;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 cursor-pointer"
      onClick={openCommandBar}
    >
      <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-full shadow-lg text-sm transition-colors ${
        isComplete
          ? "bg-green-600 text-white"
          : isFailed
            ? "bg-red-600 text-white"
            : isReview
              ? "bg-blue-600 text-white"
              : "bg-primary text-primary-foreground"
      } hover:opacity-90`}>
        <MoraIcon className="h-4 w-4" variant={logoVariant} />
        {isAgentRunning ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="max-w-[300px] truncate">{agentStatusText || "Agent working..."}</span>
          </>
        ) : isComplete ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Campaign complete — click to view</span>
          </>
        ) : isFailed ? (
          <>
            <XCircle className="h-3.5 w-3.5" />
            <span>Campaign encountered an issue — click to view</span>
          </>
        ) : isReview ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Campaign ready for review — click to approve</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
