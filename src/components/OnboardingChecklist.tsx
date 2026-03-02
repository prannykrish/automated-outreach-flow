import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Circle, Rocket, ListChecks, SkipForward } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { useOnboardingContext, type OnboardingStep } from "@/contexts/OnboardingContext";
import { useAgent } from "@/contexts/AgentContext";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Floating bottom-right widget — the only onboarding UI
export function OnboardingFloatingWidget() {
  const {
    steps,
    completedSteps,
    isLoading,
    isSuperAdmin,
    skipTutorial,
  } = useOnboardingContext();
  const { user, organizationId } = useAuth();

  const storageKey = user?.id && organizationId ? `mora-checklist-open-${user.id}-${organizationId}` : null;

  // Default to open (expanded) on first visit, then persist user's preference
  const [isOpen, setIsOpen] = useState(() => {
    if (!storageKey) return true;
    const stored = localStorage.getItem(storageKey);
    return stored === null ? true : stored === "true";
  });

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => {
      const next = !prev;
      if (storageKey) localStorage.setItem(storageKey, String(next));
      return next;
    });
  }, [storageKey]);

  // Sync initial state when storageKey becomes available
  useEffect(() => {
    if (!storageKey) return;
    const stored = localStorage.getItem(storageKey);
    if (stored === null) {
      // First login — ensure expanded and persist
      setIsOpen(true);
      localStorage.setItem(storageKey, "true");
    }
  }, [storageKey]);

  const { toggleCommandBar } = useAgent();
  const navigate = useNavigate();
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  const allDone = completedSteps.length === steps.length;

  // Hide for super admins, while loading, or if tutorial was skipped/fully completed
  if (isLoading || isSuperAdmin || allDone) return null;

  const doneCount = completedSteps.filter((id) => steps.some((s) => s.id === id)).length;
  const totalSteps = steps.length;
  const progressPct = totalSteps > 0 ? (doneCount / totalSteps) * 100 : 0;

  function handleStepClick(step: OnboardingStep) {
    const isDone = completedSteps.includes(step.id);
    if (isDone) return;

    // Don't mark as complete — just navigate to the relevant page.
    // Steps get auto-completed by their action success handlers
    // (e.g., domain verified, template created, etc.)

    if (step.id === "campaign_agent") {
      toggleCommandBar();
      return;
    }

    if (step.href) {
      navigate(step.href);
      const hash = step.href.split("#")[1];
      if (hash) {
        setTimeout(() => {
          const el = document.getElementById(hash);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 300);
      }
    }
  }

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50">
        {isOpen && (
          <div className="mb-2 w-72 bg-background border rounded-lg shadow-lg p-3 animate-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Setup progress</span>
              <span className="text-xs text-muted-foreground">{doneCount}/{totalSteps}</span>
            </div>
            <Progress value={progressPct} className="h-1.5 mb-2" />
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {steps.map((step) => {
                const isDone = completedSteps.includes(step.id);
                return (
                  <div
                    key={step.id}
                    className={cn(
                      "flex items-center gap-2 py-1 px-1.5 rounded text-xs",
                      !isDone && "hover:bg-muted/60 cursor-pointer"
                    )}
                    onClick={() => handleStepClick(step)}
                  >
                    {isDone ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                    ) : (
                      <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    )}
                    <span className={cn("flex-1", isDone && "line-through text-muted-foreground")}>
                      {step.label}
                    </span>
                    {!isDone && step.id === "campaign_agent" && (
                      <Rocket className="h-3 w-3 text-primary shrink-0" />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-2 pt-2 border-t flex justify-end">
              <button
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSkipConfirm(true);
                }}
              >
                <SkipForward className="h-3 w-3" />
                Skip tutorial
              </button>
            </div>
          </div>
        )}
        <button
          onClick={toggleOpen}
          className="flex items-center gap-2 bg-primary text-primary-foreground rounded-full px-3 py-2 shadow-lg hover:opacity-90 transition-opacity text-sm"
        >
          <ListChecks className="h-4 w-4" />
          <span>{doneCount}/{totalSteps}</span>
          <Progress value={progressPct} className="w-12 h-1.5" />
        </button>
      </div>

      <AlertDialog open={showSkipConfirm} onOpenChange={setShowSkipConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip tutorial?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently hide the setup checklist. You can still access all features from the sidebar — you just won't see guided progress anymore.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                skipTutorial();
                setShowSkipConfirm(false);
                setIsOpen(false);
              }}
            >
              Skip tutorial
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
