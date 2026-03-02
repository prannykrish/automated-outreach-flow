import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAgent } from "@/contexts/AgentContext";
import { useCampaignAgentContext, type CompanyProfile, type EmailMode, type SendMode } from "@/contexts/CampaignAgentContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import MoraIcon from "@/components/MoraIcon";
import {
  Send,
  Square,
  X,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Search,
  Sparkles,
  FileText,
  Mail,
  Shield,
  XCircle,
  History,
  Clock,
  ArrowRight,
  Settings2,
  Wand2,
  FileEdit,
  Save,
  BookTemplate,
  ChevronDown,
  Check,
} from "lucide-react";

const STEP_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  // Multi-agent pipeline steps
  icp_interpreter: { label: "Interpreting ICP", icon: <Sparkles className="h-3.5 w-3.5" /> },
  source_discovery: { label: "Discovering sources", icon: <Search className="h-3.5 w-3.5" /> },
  prospect_harvester: { label: "Harvesting prospects", icon: <FileText className="h-3.5 w-3.5" /> },
  qualification: { label: "Qualifying prospects", icon: <Shield className="h-3.5 w-3.5" /> },
  research_summary: { label: "Generating summaries", icon: <FileText className="h-3.5 w-3.5" /> },
  drafting: { label: "Drafting emails", icon: <Mail className="h-3.5 w-3.5" /> },
  approval: { label: "Ready for approval", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  executing: { label: "Sending emails", icon: <Send className="h-3.5 w-3.5" /> },
  completed: { label: "Campaign complete", icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  failed: { label: "Campaign failed", icon: <XCircle className="h-3.5 w-3.5" /> },
  error: { label: "Error", icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  // Legacy labels (for older campaigns loaded from history)
  planning: { label: "Planning campaign", icon: <Sparkles className="h-3.5 w-3.5" /> },
  researching: { label: "Researching prospects", icon: <Search className="h-3.5 w-3.5" /> },
  enriching: { label: "Enriching profiles", icon: <FileText className="h-3.5 w-3.5" /> },
  review: { label: "Ready for review", icon: <Shield className="h-3.5 w-3.5" /> },
};

interface SequenceOption {
  id: string;
  name: string;
  description: string | null;
}

export default function MoraCommandBar() {
  const { organizationId } = useAuth();
  const { isCommandBarOpen, closeCommandBar } = useAgent();
  const {
    campaignState,
    isRunning,
    currentStep,
    runCampaign,
    approveCampaign,
    saveAsTemplates,
    isSavingTemplates,
    stopAgent,
    reset,
    loadCampaign,
    campaignHistory,
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
  } = useCampaignAgentContext();

  const [input, setInput] = useState("");
  const [activityExpanded, setActivityExpanded] = useState(true);
  const [selectedProspect, setSelectedProspect] = useState<string | null>(null);
  const [emailMode, setEmailMode] = useState<EmailMode>("auto");
  const [showSettings, setShowSettings] = useState(false);
  const [profileForm, setProfileForm] = useState<CompanyProfile>({
    company_description: "",
    problem_solved: "",
    tone: "professional",
    key_message: "",
    target_roles: [],
    target_industries: [],
    company_size: "",
    company_stage: "",
    icp_keywords: [],
    messaging_notes: "",
    preferred_sources: [],
  });
  const [profileDirty, setProfileDirty] = useState(false);
  // Raw text state for comma-separated fields (convert to array on blur)
  const [rawRoles, setRawRoles] = useState("");
  const [rawIndustries, setRawIndustries] = useState("");
  const [rawKeywords, setRawKeywords] = useState("");
  const [selectedSequenceId, setSelectedSequenceId] = useState<string | null>(null);
  const [showSequencePicker, setShowSequencePicker] = useState(false);
  const [selectedSenderEmail, setSelectedSenderEmail] = useState<string | null>(null);
  const [showSenderPicker, setShowSenderPicker] = useState(false);
  const [sendMode, setSendMode] = useState<SendMode>("immediate");
  const [settingsGateError, setSettingsGateError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch available sequences when in template mode
  const { data: sequences = [], isLoading: isLoadingSequences } = useQuery({
    queryKey: ["sequences-for-campaign", organizationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("email_sequences")
        .select("id, name, description")
        .eq("organization_id", organizationId!)
        .order("name", { ascending: true });
      return (data || []) as SequenceOption[];
    },
    enabled: !!organizationId && emailMode === "template",
  });
  const activityEndRef = useRef<HTMLDivElement>(null);

  // Sync profile form when loaded from DB
  useEffect(() => {
    if (companyProfile) {
      setProfileForm({
        company_description: companyProfile.company_description || "",
        problem_solved: companyProfile.problem_solved || "",
        tone: companyProfile.tone || "professional",
        key_message: companyProfile.key_message || "",
        target_roles: companyProfile.target_roles || [],
        target_industries: companyProfile.target_industries || [],
        company_size: companyProfile.company_size || "",
        company_stage: companyProfile.company_stage || "",
        icp_keywords: companyProfile.icp_keywords || [],
        messaging_notes: companyProfile.messaging_notes || "",
        preferred_sources: companyProfile.preferred_sources || [],
      });
      setProfileDirty(false);
      setRawRoles((companyProfile.target_roles || []).join(", "));
      setRawIndustries((companyProfile.target_industries || []).join(", "));
      setRawKeywords((companyProfile.icp_keywords || []).join(", "));
    }
  }, [companyProfile]);

  // Check spam risk when entering review
  useEffect(() => {
    if (campaignState.status === "review") {
      checkSpamRisk();
    }
  }, [campaignState.status, checkSpamRisk]);

  // Auto-focus input when opened
  useEffect(() => {
    if (isCommandBarOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isCommandBarOpen]);

  // Auto-scroll activity log
  useEffect(() => {
    activityEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [campaignState.activityLog]);

  if (!isCommandBarOpen) return null;

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || isRunning) return;
    if (emailMode === "template" && !selectedSequenceId) return;

    // Settings gate: require ICP and company settings before running
    const missingFields: string[] = [];
    if (!companyProfile?.company_description) missingFields.push("company description");
    if (!companyProfile?.tone) missingFields.push("tone");
    if (!companyProfile?.target_roles?.length) missingFields.push("target roles");
    if (!companyProfile?.target_industries?.length) missingFields.push("target industries");
    if (missingFields.length > 0) {
      setSettingsGateError("Please complete your ICP and company settings before running a campaign.");
      setShowSettings(true);
      return;
    }
    setSettingsGateError(null);

    setInput("");
    runCampaign(text, {
      emailMode,
      ...(emailMode === "template" && selectedSequenceId ? { selectedSequenceId } : {}),
      ...(selectedSenderEmail ? { senderEmailOverride: selectedSenderEmail } : {}),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      closeCommandBar();
    }
  };

  const handleSaveProfile = async () => {
    await saveCompanyProfile(profileForm);
    setProfileDirty(false);
  };

  const updateProfileField = (field: keyof CompanyProfile, value: string | string[]) => {
    setProfileForm((prev) => ({ ...prev, [field]: value }));
    setProfileDirty(true);
  };

  const activeSenderEmail = selectedSenderEmail || senderEmail;

  const isIdle = campaignState.status === "idle";
  const isReview = campaignState.status === "review";
  const isCompleted = campaignState.status === "completed";
  const hasFailed = campaignState.status === "failed";

  const prospectDrafts = (prospectId: string) =>
    campaignState.drafts.filter((d) => d.prospect_id === prospectId);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[2px]"
        onClick={() => closeCommandBar()}
      />

      {/* Always-expanded command bar */}
      <div className="fixed bottom-0 left-0 right-0 z-50 h-[70vh]">
        <div className="mx-auto max-w-4xl h-full flex flex-col">
          {/* Main content area */}
          <div className="flex-1 min-h-0 rounded-t-2xl border border-b-0 bg-background/95 backdrop-blur-xl shadow-2xl overflow-hidden flex flex-col">
            {/* Header */}
            <div className="px-4 py-3 border-b flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <MoraIcon className="h-4 w-4" />
                <span className="text-sm font-medium">Mora Campaign Agent</span>
                {currentStep && STEP_LABELS[currentStep] && (
                  <Badge variant="outline" className="text-[10px] gap-1">
                    {isRunning && <Loader2 className="h-3 w-3 animate-spin" />}
                    {STEP_LABELS[currentStep].label}
                  </Badge>
                )}
                {!isIdle && !isRunning && (
                  <Badge
                    variant="outline"
                    className={`text-[10px] gap-1 ${
                      isCompleted ? "border-green-500/30 text-green-600" :
                      hasFailed ? "border-red-500/30 text-red-600" :
                      isReview ? "border-blue-500/30 text-blue-600" :
                      ""
                    }`}
                  >
                    {STEP_LABELS[campaignState.status]?.label || campaignState.status}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant={showSettings ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => setShowSettings(!showSettings)}
                >
                  <Settings2 className="h-3.5 w-3.5" />
                  {showSettings ? "Back" : "Settings"}
                </Button>
                {campaignState.status !== "idle" && !isRunning && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={reset}>
                    New Campaign
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => closeCommandBar()}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 flex overflow-hidden">
              {showSettings ? (
                /* Company Profile Settings Panel */
                <ScrollArea className="flex-1">
                  <div className="p-6 max-w-lg mx-auto space-y-5">
                    <div>
                      <h3 className="text-sm font-semibold mb-1">Company Profile</h3>
                      <p className="text-xs text-muted-foreground">
                        This context is used by the AI to write personalized, relevant emails for your campaigns.
                      </p>
                    </div>

                    {isLoadingProfile ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <>
                        <div className="space-y-1.5">
                          <Label className="text-xs">What does your company do?</Label>
                          <Textarea
                            value={profileForm.company_description}
                            onChange={(e) => updateProfileField("company_description", e.target.value)}
                            placeholder="e.g. We build AI-powered sales tools for B2B SaaS companies"
                            className="text-sm min-h-[60px] resize-none"
                            rows={2}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">What problem do you solve?</Label>
                          <Textarea
                            value={profileForm.problem_solved}
                            onChange={(e) => updateProfileField("problem_solved", e.target.value)}
                            placeholder="e.g. Founders waste hours manually researching prospects and writing cold emails"
                            className="text-sm min-h-[60px] resize-none"
                            rows={2}
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Email tone</Label>
                          <div className="flex gap-2">
                            {["professional", "casual", "friendly", "direct"].map((t) => (
                              <button
                                key={t}
                                onClick={() => updateProfileField("tone", t)}
                                className={`text-xs px-3 py-1.5 rounded-full border transition-colors capitalize ${
                                  profileForm.tone === t
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "hover:bg-accent border-muted-foreground/20"
                                }`}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Key message / value proposition</Label>
                          <Textarea
                            value={profileForm.key_message}
                            onChange={(e) => updateProfileField("key_message", e.target.value)}
                            placeholder="e.g. Save 10+ hours per week on outreach with AI that finds and writes to your ideal customers"
                            className="text-sm min-h-[60px] resize-none"
                            rows={2}
                          />
                        </div>

                        <div className="pt-4 border-t">
                          <h3 className="text-sm font-semibold mb-1">Ideal Customer Profile (ICP)</h3>
                          <p className="text-xs text-muted-foreground mb-3">
                            Define who your ideal customers are. The agent uses this for research and outreach.
                          </p>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Target Roles</Label>
                          <Input
                            value={rawRoles}
                            onChange={(e) => { setRawRoles(e.target.value); setProfileDirty(true); }}
                            onBlur={() => updateProfileField("target_roles", rawRoles.split(",").map(s => s.trim()).filter(Boolean))}
                            placeholder="e.g. CEO, CPA, Doctor, Lawyer"
                            className="text-sm"
                          />
                          <p className="text-[10px] text-muted-foreground">Comma-separated list of roles to target</p>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Target Industries</Label>
                          <Input
                            value={rawIndustries}
                            onChange={(e) => { setRawIndustries(e.target.value); setProfileDirty(true); }}
                            onBlur={() => updateProfileField("target_industries", rawIndustries.split(",").map(s => s.trim()).filter(Boolean))}
                            placeholder="e.g. SaaS, Healthcare, Legal"
                            className="text-sm"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Company Size / Stage</Label>
                          <div className="flex gap-2">
                            <Input
                              value={profileForm.company_size || ""}
                              onChange={(e) => updateProfileField("company_size", e.target.value)}
                              placeholder="e.g. 10-200 employees"
                              className="text-sm flex-1"
                            />
                            <Input
                              value={profileForm.company_stage || ""}
                              onChange={(e) => updateProfileField("company_stage", e.target.value)}
                              placeholder="e.g. Series A, Growth"
                              className="text-sm flex-1"
                            />
                          </div>
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">ICP Keywords</Label>
                          <Input
                            value={rawKeywords}
                            onChange={(e) => { setRawKeywords(e.target.value); setProfileDirty(true); }}
                            onBlur={() => updateProfileField("icp_keywords", rawKeywords.split(",").map(s => s.trim()).filter(Boolean))}
                            placeholder="e.g. AI, automation, B2B, tax planning"
                            className="text-sm"
                          />
                        </div>

                        <div className="space-y-1.5">
                          <Label className="text-xs">Messaging Notes</Label>
                          <Textarea
                            value={profileForm.messaging_notes || ""}
                            onChange={(e) => updateProfileField("messaging_notes", e.target.value)}
                            placeholder="Any additional context for how emails should be written..."
                            className="text-sm min-h-[60px] resize-none"
                            rows={2}
                          />
                        </div>

                        <Button
                          size="sm"
                          className="w-full gap-1.5"
                          onClick={handleSaveProfile}
                          disabled={!profileDirty || isSavingProfile}
                        >
                          {isSavingProfile ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          {isSavingProfile ? "Saving..." : profileDirty ? "Save Profile" : "Saved"}
                        </Button>
                      </>
                    )}
                  </div>
                </ScrollArea>
              ) : (
                <>
                  {/* Left panel */}
                  <div className="flex-1 min-w-0 min-h-0 flex flex-col border-r">
                    {/* User prompt */}
                    {campaignState.userPrompt && (
                      <div className="px-4 py-3 border-b bg-muted/20 shrink-0">
                        <p className="text-[10px] font-medium text-muted-foreground mb-1">YOUR PROMPT</p>
                        <p className="text-sm">{campaignState.userPrompt}</p>
                      </div>
                    )}

                    {/* Sender email info — clickable to change */}
                    {activeSenderEmail && campaignState.status !== "idle" && (
                      <div className="border-b bg-muted/10 shrink-0">
                        <button
                          className="w-full px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => orgEmails.length > 1 && setShowSenderPicker(!showSenderPicker)}
                        >
                          <Mail className="h-3 w-3 shrink-0" />
                          <span>Sending from: <span className="font-medium text-foreground">{activeSenderEmail}</span></span>
                          {orgEmails.length > 1 && <ChevronDown className="h-3 w-3 ml-auto shrink-0" />}
                        </button>
                        {showSenderPicker && orgEmails.length > 1 && (
                          <div className="px-4 pb-2 space-y-0.5">
                            {orgEmails.map((oe) => (
                              <button
                                key={oe.id}
                                onClick={() => { setSelectedSenderEmail(oe.email); setShowSenderPicker(false); }}
                                className={`w-full text-left px-3 py-1.5 rounded-md text-xs flex items-center justify-between transition-colors ${
                                  (selectedSenderEmail || senderEmail) === oe.email ? "bg-primary/10 text-primary" : "hover:bg-accent"
                                }`}
                              >
                                <span>{oe.display_name ? `${oe.display_name} (${oe.email})` : oe.email}</span>
                                {(selectedSenderEmail || senderEmail) === oe.email && <Check className="h-3 w-3 shrink-0" />}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Prospects list */}
                    {campaignState.prospects.length > 0 && (() => {
                      // Only show valid prospects with emails
                      const validProspects = campaignState.prospects.filter((p) => p.email && p.name);
                      if (validProspects.length === 0) return null;
                      return (
                        <ScrollArea className="flex-1">
                          <div className="p-3 space-y-1">
                            <p className="text-xs font-medium text-muted-foreground px-2 mb-1">
                              Prospects ({validProspects.length})
                            </p>
                            {searchStats && (
                              <p className="text-[10px] text-muted-foreground px-2 mb-2">
                                {searchStats.queriesUsed} searches · {validProspects.length} with verified emails
                              </p>
                            )}
                            {validProspects.map((prospect) => (
                              <button
                                key={prospect.id}
                                onClick={() => setSelectedProspect(prospect.id === selectedProspect ? null : prospect.id)}
                                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                                  selectedProspect === prospect.id ? "bg-accent" : "hover:bg-accent/50"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="font-medium truncate">{prospect.name}</p>
                                      <span className="text-[10px] text-muted-foreground truncate shrink-0">{prospect.email}</span>
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate">
                                      {prospect.company ? `${prospect.title || ""} at ${prospect.company}`.trim() : prospect.summary || ""}
                                    </p>
                                  </div>
                                  {prospect.confidence_score != null && (
                                    <Badge
                                      variant="outline"
                                      className={`text-[10px] px-1.5 py-0 shrink-0 ${
                                        prospect.confidence_score >= 0.7
                                          ? "border-green-500/30 text-green-600"
                                          : prospect.confidence_score >= 0.4
                                            ? "border-yellow-500/30 text-yellow-600"
                                            : "border-red-500/30 text-red-600"
                                      }`}
                                    >
                                      {Math.round(prospect.confidence_score * 100)}%
                                    </Badge>
                                  )}
                                </div>
                              </button>
                            ))}
                          </div>
                        </ScrollArea>
                      );
                    })()}

                    {/* Activity log — always scrollable */}
                    {campaignState.activityLog.length > 0 && (
                      <div className={`flex flex-col ${campaignState.prospects.length > 0 ? "max-h-[200px] shrink-0" : "flex-1 min-h-0"}`}>
                        <button
                          className="w-full px-4 py-2 flex items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground shrink-0 border-t"
                          onClick={() => setActivityExpanded(!activityExpanded)}
                        >
                          <span>Activity Log ({campaignState.activityLog.length})</span>
                          {activityExpanded ? <XCircle className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
                        </button>
                        {activityExpanded && (
                          <div className="flex-1 min-h-0 overflow-y-auto">
                            <div className="px-4 pb-3 space-y-1.5">
                              {campaignState.activityLog.map((entry) => {
                                const stepInfo = STEP_LABELS[entry.step];
                                // Render URLs in messages as clickable links
                                const renderMessage = (msg: string) => {
                                  const urlPattern = /(https?:\/\/[^\s)]+)/g;
                                  const parts = msg.split(urlPattern);
                                  if (parts.length === 1) return msg;
                                  return parts.map((part, i) =>
                                    urlPattern.test(part) ? (
                                      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline break-all">{part}</a>
                                    ) : part
                                  );
                                };
                                return (
                                  <div key={entry.id} className="flex items-start gap-2 text-xs">
                                    <span className="text-muted-foreground shrink-0 mt-0.5">
                                      {stepInfo?.icon || <Loader2 className="h-3 w-3" />}
                                    </span>
                                    <span className="text-muted-foreground">{renderMessage(entry.message)}</span>
                                  </div>
                                );
                              })}
                              <div ref={activityEndRef} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Empty state / Campaign history */}
                    {campaignState.prospects.length === 0 && campaignState.activityLog.length === 0 && (
                      <div className="flex-1 min-h-0 flex flex-col">
                        {campaignHistory.length > 0 ? (
                          <div className="flex-1 min-h-0 overflow-y-auto">
                            <div className="p-3 space-y-1">
                              <p className="text-xs font-medium text-muted-foreground px-2 mb-2 flex items-center gap-1.5">
                                <History className="h-3.5 w-3.5" />
                                Recent Campaigns
                              </p>
                              {campaignHistory.map((c) => (
                                <button
                                  key={c.id}
                                  onClick={() => { loadCampaign(c.id); }}
                                  className="w-full text-left px-3 py-2.5 rounded-lg text-sm hover:bg-accent/50 transition-colors"
                                >
                                  <div className="min-w-0">
                                    <p className="font-medium truncate">{c.user_prompt || c.title}</p>
                                    <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                      <Clock className="h-3 w-3" />
                                      {new Date(c.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                                    </p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-center px-8">
                            <div>
                              <MoraIcon className="h-8 w-8 mx-auto mb-3 opacity-30" />
                              <p className="text-sm text-muted-foreground">
                                Issue a command below to start a campaign
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right: Email preview for selected prospect */}
                  <div className="w-[45%] flex flex-col">
                    {selectedProspect ? (
                      <ScrollArea className="flex-1">
                        <div className="p-4 space-y-3">
                          {(() => {
                            const prospect = campaignState.prospects.find((p) => p.id === selectedProspect);
                            if (!prospect) return null;
                            const drafts = prospectDrafts(prospect.id);

                            return (
                              <>
                                {/* Prospect detail */}
                                <div className="space-y-2">
                                  <h3 className="text-sm font-semibold">{prospect.name}</h3>
                                  {prospect.summary && (
                                    <p className="text-xs text-muted-foreground">{prospect.summary}</p>
                                  )}
                                  <div className="text-xs text-muted-foreground space-y-0.5">
                                    {prospect.email ? (
                                      <div className="flex items-center gap-1.5">
                                        <Mail className="h-3 w-3" />
                                        <span className="font-medium text-foreground">{prospect.email}</span>
                                        {prospect.email_source_location && (
                                          <span className="text-[10px] opacity-70">({prospect.email_source_location})</span>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-1.5 text-red-500">
                                        <AlertTriangle className="h-3 w-3" />
                                        <span>No email found — needs manual lookup</span>
                                      </div>
                                    )}
                                    {prospect.company && <p>{prospect.title} at {prospect.company}</p>}
                                    {prospect.source_url && (
                                      <a href={prospect.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline block truncate">
                                        Source: {(() => { try { return new URL(prospect.source_url).hostname; } catch { return prospect.source_url; } })()}
                                      </a>
                                    )}
                                    {prospect.linkedin_url && (
                                      <a href={prospect.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">LinkedIn</a>
                                    )}
                                  </div>

                                  {prospect.evidence_of_fit && (
                                    <div className="border rounded-lg p-3 space-y-1.5 bg-muted/30">
                                      <p className="text-xs font-medium">Why they match</p>
                                      <p className="text-xs">{prospect.evidence_of_fit}</p>
                                    </div>
                                  )}

                                  {prospect.risk_flags.length > 0 && (
                                    <div className="flex flex-wrap gap-1">
                                      {prospect.risk_flags.map((flag, i) => (
                                        <Badge key={i} variant="outline" className="text-[10px] border-yellow-500/30 text-yellow-600">
                                          <AlertTriangle className="h-3 w-3 mr-1" />
                                          {flag}
                                        </Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {/* Email drafts with timeline */}
                                {drafts.length > 0 && (
                                  <div className="space-y-2">
                                    <p className="text-xs font-medium text-muted-foreground">
                                      Email Sequence ({drafts.length} {drafts.length === 1 ? "email" : "emails"})
                                    </p>
                                    {drafts.map((draft) => {
                                      const delayDays = draft.delay_days || 0;
                                      const sendDate = draft.send_at ? new Date(draft.send_at) : (() => {
                                        const d = new Date();
                                        d.setDate(d.getDate() + delayDays);
                                        d.setHours(10, 0, 0, 0);
                                        return d;
                                      })();
                                      const isImmediate = draft.step_number === 1 && sendMode === "immediate";

                                      return (
                                        <div key={draft.id} className="border rounded-lg overflow-hidden">
                                          <div className="px-3 py-2 bg-muted/30 border-b space-y-1">
                                            <div className="flex items-center justify-between">
                                              <span className="text-xs font-medium">
                                                {isImmediate ? "Initial Email" : `Follow-up ${draft.step_number - 1}`}
                                              </span>
                                              <Badge
                                                variant="outline"
                                                className={`text-[10px] px-1.5 py-0 ${
                                                  isImmediate
                                                    ? "border-green-500/30 text-green-600"
                                                    : "border-blue-500/30 text-blue-600"
                                                }`}
                                              >
                                                {isImmediate ? "Sends immediately" : delayDays > 0 ? `+${delayDays} days` : "Step 1"}
                                              </Badge>
                                            </div>
                                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                              <Clock className="h-3 w-3" />
                                              <span>
                                                {isImmediate
                                                  ? "Today upon approval"
                                                  : sendDate.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                                                }
                                              </span>
                                            </div>
                                            {activeSenderEmail && (
                                              <div className="text-[10px] text-muted-foreground space-y-0.5">
                                                <p>From: {activeSenderEmail}</p>
                                                <p>To: {prospect.email || "—"}</p>
                                              </div>
                                            )}
                                            <p className="text-xs font-medium">{draft.subject}</p>
                                          </div>
                                          <div className="p-3">
                                            <p className="text-xs whitespace-pre-wrap leading-relaxed">{draft.body}</p>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}

                                {drafts.length === 0 && (
                                  <p className="text-xs text-muted-foreground italic">
                                    No email drafts yet for this prospect.
                                  </p>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </ScrollArea>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-center px-8">
                        <p className="text-xs text-muted-foreground">
                          {campaignState.prospects.length > 0
                            ? "Select a prospect to preview emails"
                            : isIdle
                              ? "Prospect details and email previews will appear here"
                              : "Waiting for prospects..."
                          }
                        </p>
                      </div>
                    )}

                    {/* Warnings + Approve/Save buttons */}
                    {(isReview || isCompleted) && (
                      <div className="border-t p-3 space-y-2 shrink-0">
                        {campaignState.warnings.length > 0 && isReview && (
                          <div className="space-y-1">
                            {campaignState.warnings.map((w, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs text-yellow-600">
                                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                {w}
                              </div>
                            ))}
                          </div>
                        )}
                        {spamWarnings.length > 0 && isReview && (
                          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-2.5 space-y-1.5">
                            <p className="text-xs font-medium text-yellow-700 dark:text-yellow-400 flex items-center gap-1.5">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Deliverability Warning
                            </p>
                            {spamWarnings.map((w, i) => (
                              <p key={i} className="text-[11px] text-yellow-600 dark:text-yellow-400/80 leading-relaxed">{w}</p>
                            ))}
                          </div>
                        )}
                        {isReview && (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs text-muted-foreground shrink-0">Send:</span>
                              <button
                                onClick={() => setSendMode("immediate")}
                                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                                  sendMode === "immediate"
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "hover:bg-accent border-muted-foreground/20"
                                }`}
                              >
                                Send immediately
                              </button>
                              <button
                                onClick={() => setSendMode("scheduled")}
                                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                                  sendMode === "scheduled"
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "hover:bg-accent border-muted-foreground/20"
                                }`}
                              >
                                Schedule all
                              </button>
                              <button
                                onClick={() => setSendMode("per_prospect")}
                                className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                                  sendMode === "per_prospect"
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "hover:bg-accent border-muted-foreground/20"
                                }`}
                              >
                                Per-prospect
                              </button>
                            </div>
                            {sendMode === "immediate" && (
                              <p className="text-[10px] text-muted-foreground">
                                Step 1 emails send now. Follow-ups are scheduled automatically.
                              </p>
                            )}
                            {sendMode === "scheduled" && (
                              <p className="text-[10px] text-muted-foreground">
                                All emails (including step 1) will be scheduled at the times shown in the timeline.
                              </p>
                            )}
                            {sendMode === "per_prospect" && !selectedProspect && (
                              <p className="text-[10px] text-yellow-600">
                                Select a prospect on the left to send to them individually.
                              </p>
                            )}
                            {sendMode === "per_prospect" && selectedProspect && (
                              <p className="text-[10px] text-muted-foreground">
                                Will only send to: <span className="font-medium text-foreground">{campaignState.prospects.find(p => p.id === selectedProspect)?.name}</span>
                              </p>
                            )}
                            <Button
                              className="w-full"
                              size="sm"
                              onClick={() => approveCampaign(
                                selectedSenderEmail || undefined,
                                sendMode === "per_prospect" ? selectedProspect || undefined : undefined,
                                sendMode
                              )}
                              disabled={isRunning || (sendMode === "per_prospect" && !selectedProspect)}
                            >
                              {isRunning ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4 mr-2" />
                              )}
                              {sendMode === "immediate" ? "Approve & Send All" :
                               sendMode === "scheduled" ? "Approve & Schedule All" :
                               "Send to Selected Prospect"}
                            </Button>
                          </div>
                        )}
                        {campaignState.drafts.length > 0 && (
                          <Button
                            variant="outline"
                            className="w-full"
                            size="sm"
                            onClick={saveAsTemplates}
                            disabled={isSavingTemplates}
                          >
                            {isSavingTemplates ? (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <BookTemplate className="h-4 w-4 mr-2" />
                            )}
                            {isSavingTemplates ? "Saving..." : "Save as Templates"}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Bottom input bar — pinned, solid background, above content */}
            {!showSettings && (
              <div className="relative z-10 border-t bg-background shrink-0 px-4 py-3">
                {/* Email mode selector for idle state */}
                {isIdle && (
                  <div className="space-y-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground shrink-0">Mode:</span>
                      <button
                        onClick={() => { setEmailMode("auto"); setSelectedSequenceId(null); setShowSequencePicker(false); }}
                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                          emailMode === "auto"
                            ? "bg-primary text-primary-foreground border-primary"
                            : "hover:bg-accent border-muted-foreground/20"
                        }`}
                        title="AI generates unique personalized emails for each prospect based on research"
                      >
                        <Wand2 className="h-3 w-3" />
                        Generate unique emails
                      </button>
                      <button
                        onClick={() => { setEmailMode("template"); setShowSequencePicker(true); }}
                        className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                          emailMode === "template"
                            ? "bg-primary text-primary-foreground border-primary"
                            : "hover:bg-accent border-muted-foreground/20"
                        }`}
                        title="Use your existing template word-for-word, only filling in placeholders"
                      >
                        <FileEdit className="h-3 w-3" />
                        Use selected template
                      </button>
                    </div>

                    {/* Sequence picker (shown when template mode is selected) */}
                    {emailMode === "template" && showSequencePicker && (
                      <div className="border rounded-lg bg-muted/30 p-2 space-y-1 max-h-[150px] overflow-y-auto">
                        {isLoadingSequences ? (
                          <div className="flex items-center justify-center py-3">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : sequences.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-3">
                            No sequences found. Create one on the Sequences page first.
                          </p>
                        ) : (
                          <>
                            <p className="text-[10px] font-medium text-muted-foreground px-2 mb-1">Pick a sequence:</p>
                            {sequences.map((seq) => (
                              <button
                                key={seq.id}
                                onClick={() => { setSelectedSequenceId(seq.id); setShowSequencePicker(false); }}
                                className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors flex items-center justify-between gap-2 ${
                                  selectedSequenceId === seq.id
                                    ? "bg-primary/10 text-primary"
                                    : "hover:bg-accent"
                                }`}
                              >
                                <div className="min-w-0">
                                  <p className="font-medium truncate">{seq.name}</p>
                                  {seq.description && (
                                    <p className="text-[10px] text-muted-foreground truncate">{seq.description}</p>
                                  )}
                                </div>
                                {selectedSequenceId === seq.id && (
                                  <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                                )}
                              </button>
                            ))}
                          </>
                        )}
                      </div>
                    )}

                    {/* Show selected sequence as a chip when picker is collapsed */}
                    {emailMode === "template" && !showSequencePicker && selectedSequenceId && (
                      <button
                        onClick={() => setShowSequencePicker(true)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors"
                      >
                        <FileEdit className="h-3 w-3" />
                        {sequences.find((s) => s.id === selectedSequenceId)?.name || "Selected sequence"}
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}

                {/* Deliverability warning */}
                {isIdle && domainVerification && !domainVerification.hasVerified && domainVerification.hasAnyDomain && (
                  <div className="flex items-start gap-2 text-xs text-yellow-600 bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-2.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>Your sending domain is not verified. Emails may go to spam. <a href="/organization" className="underline font-medium">Verify Domain</a></span>
                  </div>
                )}
                {isIdle && domainVerification && !domainVerification.hasAnyDomain && (
                  <div className="flex items-start gap-2 text-xs text-yellow-600 bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-2.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>No sending domain configured. <a href="/organization" className="underline font-medium">Add a domain</a> to improve deliverability.</span>
                  </div>
                )}

                {/* Settings gate error */}
                {settingsGateError && (
                  <div className="flex items-start gap-2 text-xs text-red-600 bg-red-500/5 border border-red-500/20 rounded-lg p-2.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{settingsGateError}</span>
                  </div>
                )}

                {/* Input row */}
                <div className="flex items-end gap-2">
                  <Textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={isIdle ? "Tell Mora what campaign to run..." : "Send a follow-up command..."}
                    className="min-h-[40px] max-h-[100px] resize-none rounded-xl border-muted-foreground/20 px-4 py-2.5 text-sm"
                    rows={1}
                    disabled={isRunning}
                  />
                  {isRunning ? (
                    <Button variant="outline" size="icon" className="h-[40px] w-[40px] shrink-0 rounded-xl" onClick={stopAgent}>
                      <Square className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button size="icon" className="h-[40px] w-[40px] shrink-0 rounded-xl" onClick={handleSubmit} disabled={!input.trim() || (emailMode === "template" && !selectedSequenceId)}>
                      <Send className="h-4 w-4" />
                    </Button>
                  )}
                </div>

              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
