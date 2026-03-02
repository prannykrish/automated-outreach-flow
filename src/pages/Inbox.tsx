import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Send, Mail, Clock, Eye, MessageSquare, AlertCircle, ChevronLeft, ChevronRight, Loader2, Inbox as InboxIcon, Plus, X, Users, PanelLeftClose, PanelLeft, ArrowDownLeft, ArrowUpRight, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";

interface UnifiedEmail {
  id: string;
  direction: "in" | "out";
  contactName: string | null;
  contactEmail: string;
  subject: string | null;
  timestamp: string;
  // Outbound-specific
  status?: string;
  openedAt?: string | null;
  repliedAt?: string | null;
  senderEmail?: string | null;
  body?: string | null;
  customerId?: string | null;
  errorMessage?: string | null;
  // Inbound-specific
  isRead?: boolean;
  html?: string | null;
  textBody?: string | null;
  toEmail?: string | null;
}

interface EmailThread {
  threadKey: string;
  contactEmail: string;
  contactName: string | null;
  lastTimestamp: string;
  lastSubject: string | null;
  emails: UnifiedEmail[];
  unreadCount: number;
  messageCount: number;
}

function normalizeSubject(subject: string | null): string {
  if (!subject) return "";
  // Strip Re:/Fwd:/Fw: prefixes (case-insensitive, repeated)
  return subject.replace(/^(re:\s*|fwd?:\s*)+/i, "").trim().toLowerCase();
}

function groupIntoThreads(emails: UnifiedEmail[]): EmailThread[] {
  // Group by contact email + normalized subject to keep separate conversations apart
  const threadGroups = new Map<string, UnifiedEmail[]>();
  for (const e of emails) {
    const contact = e.contactEmail.toLowerCase();
    const subjectKey = normalizeSubject(e.subject) || `_no_subject_${e.id}`;
    const key = `${contact}::${subjectKey}`;
    if (!threadGroups.has(key)) threadGroups.set(key, []);
    threadGroups.get(key)!.push(e);
  }

  const threads: EmailThread[] = [];
  for (const [key, threadEmails] of threadGroups) {
    threadEmails.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const latest = threadEmails[threadEmails.length - 1];
    const contactOut = threadEmails.find((e) => e.direction === "out");
    const contactIn = threadEmails.find((e) => e.direction === "in");
    const contactEmail = contactOut?.contactEmail || contactIn?.contactEmail || latest.contactEmail;

    threads.push({
      threadKey: key,
      contactEmail,
      contactName: contactOut?.contactName || contactIn?.contactName || latest.contactName,
      lastTimestamp: latest.timestamp,
      lastSubject: latest.subject,
      emails: threadEmails,
      unreadCount: threadEmails.filter((e) => e.direction === "in" && e.isRead === false).length,
      messageCount: threadEmails.length,
    });
  }

  threads.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
  return threads;
}

interface BulkRecipient {
  id: string;
  to: string;
  subject: string;
  body: string;
  senderId: string; // per-recipient sender override
}

function statusDot(status: string, openedAt: string | null, repliedAt: string | null) {
  if (repliedAt) return "bg-purple-500";
  if (openedAt) return "bg-green-500";
  if (status === "failed") return "bg-red-500";
  return "bg-gray-400";
}

function statusLabel(status: string, openedAt: string | null, repliedAt: string | null) {
  if (repliedAt) return "Replied";
  if (openedAt) return "Opened";
  if (status === "failed") return "Failed";
  if (status === "sent") return "Sent";
  return status;
}

export default function Inbox() {
  const { user, session, organizationId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null);
  const [senderFilter, setSenderFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeSenderId, setComposeSenderId] = useState<string>("");
  const [topComposeOpen, setTopComposeOpen] = useState(false);
  const [topComposeMode, setTopComposeMode] = useState<"single" | "bulk">("single");
  const [topComposeTo, setTopComposeTo] = useState("");
  const [topComposeSubject, setTopComposeSubject] = useState("");
  const [topComposeBody, setTopComposeBody] = useState("");
  const [bulkRecipients, setBulkRecipients] = useState<BulkRecipient[]>([
    { id: crypto.randomUUID(), to: "", subject: "", body: "", senderId: "" },
  ]);
  const [bulkIndividualSenders, setBulkIndividualSenders] = useState(false);
  const [bulkMessageMode, setBulkMessageMode] = useState<"shared" | "individual">("shared");
  const [bulkSharedSubject, setBulkSharedSubject] = useState("");
  const [bulkSharedBody, setBulkSharedBody] = useState("");
  const [bulkSending, setBulkSending] = useState(false);
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const itemsPerPage = 25;

  // Fetch all emails for this org
  const { data: emails, isLoading } = useQuery({
    queryKey: ["inbox-emails", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_logs")
        .select("id, customer_id, customer_email, customer_name, subject, body, sender_email, status, sent_at, opened_at, replied_at, resend_id, error_message, template_id, created_at")
        .eq("organization_id", organizationId!)
        .order("sent_at", { ascending: false, nullsFirst: false })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId,
    refetchInterval: 15000,
  });

  // Fetch org's sender emails for filter dropdown
  const { data: orgEmails } = useQuery({
    queryKey: ["inbox-org-emails", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_emails")
        .select("id, email, display_name, is_default")
        .eq("organization_id", organizationId!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId,
  });

  // Fetch inbound emails
  const { data: inboundEmails } = useQuery({
    queryKey: ["inbox-inbound", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inbound_emails")
        .select("id, from_email, from_name, to_email, subject, html, text_body, customer_id, is_read, created_at")
        .eq("organization_id", organizationId!)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId,
    refetchInterval: 15000,
  });

  // Build unified email list (outbound + inbound) with full data for thread view
  const unifiedList: UnifiedEmail[] = [
    ...(emails || []).map((e: any) => ({
      id: e.id,
      direction: "out" as const,
      contactName: e.customer_name,
      contactEmail: e.customer_email || "",
      subject: e.subject,
      timestamp: e.sent_at || e.created_at || "",
      status: e.status,
      openedAt: e.opened_at,
      repliedAt: e.replied_at,
      senderEmail: e.sender_email,
      body: e.body,
      customerId: e.customer_id,
      errorMessage: e.error_message,
    })),
    ...(inboundEmails || []).map((e: any) => ({
      id: e.id,
      direction: "in" as const,
      contactName: e.from_name,
      contactEmail: e.from_email,
      subject: e.subject,
      timestamp: e.created_at || "",
      isRead: e.is_read,
      html: e.html,
      textBody: e.text_body,
      customerId: e.customer_id,
      toEmail: e.to_email,
    })),
  ];

  // Group into threads
  const allThreads = groupIntoThreads(unifiedList);

  // Filter & search at thread level
  const filteredThreads = allThreads.filter((thread) => {
    const matchesSender = senderFilter === "all" || thread.emails.some((e) =>
      e.contactEmail.includes(senderFilter) || (e.senderEmail || "").includes(senderFilter)
    );
    const query = searchQuery.toLowerCase();
    const matchesSearch = !query || thread.emails.some((e) =>
      (e.contactName || "").toLowerCase().includes(query) ||
      e.contactEmail.toLowerCase().includes(query) ||
      (e.subject || "").toLowerCase().includes(query)
    );
    return matchesSender && matchesSearch;
  });

  // Pagination
  const totalPages = Math.ceil(filteredThreads.length / itemsPerPage);
  const paginatedThreads = filteredThreads.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  // Selected thread
  const selectedThread = selectedThreadKey ? allThreads.find((t) => t.threadKey === selectedThreadKey) || null : null;

  // For compose: get customer info from thread
  const threadCustomerId = selectedThread?.emails.find((e) => e.customerId)?.customerId || null;

  // Fetch next scheduled send for selected thread's customer
  const { data: nextScheduled } = useQuery({
    queryKey: ["inbox-next-scheduled", threadCustomerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scheduled_sends")
        .select("id, scheduled_for, status, sequence_steps(step_order, email_templates(name, subject))")
        .eq("customer_id", threadCustomerId!)
        .eq("status", "pending")
        .order("scheduled_for", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!threadCustomerId,
  });

  // Send direct email mutation (reply within thread)
  const sendEmailMutation = useMutation({
    mutationFn: async () => {
      if (!selectedThread || !composeSenderId) return;
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const response = await fetch(`${supabaseUrl}/functions/v1/send-inbox-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
          "apikey": supabaseKey,
        },
        body: JSON.stringify({
          to: selectedThread.contactEmail,
          subject: composeSubject,
          html: composeBody.replace(/\n/g, "<br>"),
          organization_email_id: composeSenderId,
          customer_id: threadCustomerId,
          organization_id: organizationId,
          user_id: user?.id,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to send");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-emails"] });
      queryClient.invalidateQueries({ queryKey: ["inbox-inbound"] });
      toast({ title: "Email sent" });
      setComposeOpen(false);
      setComposeSubject("");
      setComposeBody("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    },
  });

  // Send a single top-level compose email
  const sendTopComposeMutation = useMutation({
    mutationFn: async () => {
      if (!composeSenderId) throw new Error("Select a sender");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const response = await fetch(`${supabaseUrl}/functions/v1/send-inbox-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session?.access_token}`,
          "apikey": supabaseKey,
        },
        body: JSON.stringify({
          to: topComposeTo.trim(),
          subject: topComposeSubject,
          html: topComposeBody.replace(/\n/g, "<br>"),
          organization_email_id: composeSenderId,
          organization_id: organizationId,
          user_id: user?.id,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to send");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inbox-emails"] });
      toast({ title: "Email sent" });
      setTopComposeOpen(false);
      setTopComposeTo("");
      setTopComposeSubject("");
      setTopComposeBody("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    },
  });

  // Send bulk emails (one per recipient)
  const sendBulkEmails = async () => {
    const validRecipients = bulkMessageMode === "shared"
      ? bulkRecipients.filter((r) => r.to.trim()).map((r) => ({ ...r, subject: bulkSharedSubject, body: bulkSharedBody }))
      : bulkRecipients.filter((r) => r.to.trim() && r.subject.trim() && r.body.trim());
    if (validRecipients.length === 0) return;
    if (bulkMessageMode === "shared" && (!bulkSharedSubject.trim() || !bulkSharedBody.trim())) {
      toast({ title: "Please fill in subject and message", variant: "destructive" });
      return;
    }
    if (!composeSenderId) {
      toast({ title: "Select a sender email", variant: "destructive" });
      return;
    }

    setBulkSending(true);
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    let successCount = 0;
    let failCount = 0;

    for (const recipient of validRecipients) {
      try {
        const senderIdForRecipient = recipient.senderId || composeSenderId;
        const response = await fetch(`${supabaseUrl}/functions/v1/send-inbox-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session?.access_token}`,
            "apikey": supabaseKey,
          },
          body: JSON.stringify({
            to: recipient.to.trim(),
            subject: recipient.subject,
            html: recipient.body.replace(/\n/g, "<br>"),
            organization_email_id: senderIdForRecipient,
            organization_id: organizationId,
            user_id: user?.id,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        successCount++;
      } catch {
        failCount++;
      }
    }

    setBulkSending(false);
    queryClient.invalidateQueries({ queryKey: ["inbox-emails"] });

    if (failCount === 0) {
      toast({ title: `${successCount} email${successCount > 1 ? "s" : ""} sent` });
      setTopComposeOpen(false);
      setBulkRecipients([{ id: crypto.randomUUID(), to: "", subject: "", body: "", senderId: "" }]);
      setBulkSharedSubject("");
      setBulkSharedBody("");
    } else {
      toast({
        title: `${successCount} sent, ${failCount} failed`,
        variant: "destructive",
      });
    }
  };

  // Set default sender when orgEmails load
  if (orgEmails && orgEmails.length > 0 && !composeSenderId) {
    const defaultEmail = orgEmails.find((e) => e.is_default) || orgEmails[0];
    setComposeSenderId(defaultEmail.id);
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] -m-6">
      {/* Left Panel — Thread List */}
      <div className={`border-r flex flex-col bg-background transition-[width] duration-200 ease-linear ${leftPanelCollapsed ? "w-0 overflow-hidden border-r-0" : "w-[40%]"}`}>
        {/* Header */}
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">Inbox</h1>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ["inbox-emails"] });
                  queryClient.invalidateQueries({ queryKey: ["inbox-inbound"] });
                }}
                title="Refresh inbox"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                onClick={() => {
                  setTopComposeOpen(true);
                  setSelectedThreadKey(null);
                  setTopComposeMode("single");
                  setTopComposeTo("");
                  setTopComposeSubject("");
                  setTopComposeBody("");
                }}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Compose
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setLeftPanelCollapsed(true)}
                title="Collapse panel"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, subject..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                className="pl-9 h-9"
              />
            </div>
            <Select value={senderFilter} onValueChange={(v) => { setSenderFilter(v); setCurrentPage(1); }}>
              <SelectTrigger className="w-[180px] h-9">
                <SelectValue placeholder="All senders" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All senders</SelectItem>
                {(orgEmails || []).map((oe) => (
                  <SelectItem key={oe.id} value={oe.email}>
                    {oe.display_name ? `${oe.display_name} (${oe.email})` : oe.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Thread List */}
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredThreads.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-6">
              <InboxIcon className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No emails found</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Emails will appear here once you start sending sequences.</p>
            </div>
          ) : (
            <div>
              {paginatedThreads.map((thread) => {
                const lastEmail = thread.emails[thread.emails.length - 1];
                const hasReplied = thread.emails.some((e) => e.repliedAt);
                const hasOpened = thread.emails.some((e) => e.openedAt);
                const hasFailed = thread.emails.some((e) => e.status === "failed");
                return (
                  <button
                    key={thread.threadKey}
                    onClick={() => {
                      setSelectedThreadKey(thread.threadKey);
                      setComposeOpen(false);
                      setTopComposeOpen(false);
                      // Mark all unread inbound emails in thread as read
                      const unreadIds = thread.emails
                        .filter((e) => e.direction === "in" && e.isRead === false)
                        .map((e) => e.id);
                      if (unreadIds.length > 0) {
                        supabase.from("inbound_emails").update({ is_read: true }).in("id", unreadIds).then(() => {
                          queryClient.invalidateQueries({ queryKey: ["inbox-inbound"] });
                        });
                      }
                    }}
                    className={`w-full text-left px-4 py-3 border-b hover:bg-accent/50 transition-colors ${
                      selectedThreadKey === thread.threadKey ? "bg-accent" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {thread.unreadCount > 0 ? (
                        <div className="w-2 h-2 rounded-full mt-2 shrink-0 bg-blue-500" />
                      ) : (
                        <div className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                          hasReplied ? "bg-purple-500" : hasOpened ? "bg-green-500" : hasFailed ? "bg-red-500" : "bg-gray-400"
                        }`} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-sm truncate ${thread.unreadCount > 0 ? "font-semibold" : "font-medium"}`}>
                            {thread.contactName
                              ? <>{thread.contactName} <span className="text-muted-foreground font-normal">{thread.contactEmail}</span></>
                              : thread.contactEmail || "Unknown"}
                          </p>
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {thread.lastTimestamp
                              ? formatDistanceToNow(new Date(thread.lastTimestamp), { addSuffix: true })
                              : "—"}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground truncate mt-0.5">
                          {lastEmail.direction === "in" ? "↙ " : "↗ "}
                          {thread.lastSubject || "(no subject)"}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {thread.messageCount > 1 && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {thread.messageCount}
                            </Badge>
                          )}
                          {thread.unreadCount > 0 && (
                            <Badge className="text-[10px] px-1.5 py-0 bg-blue-500 text-white">
                              {thread.unreadCount} new
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <span className="text-xs text-muted-foreground">
                    {filteredThreads.length} conversations
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={currentPage === 1}
                      onClick={() => setCurrentPage(currentPage - 1)}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground px-2">
                      {currentPage} / {totalPages}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={currentPage === totalPages}
                      onClick={() => setCurrentPage(currentPage + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* Right Panel — Detail or Compose */}
      <div className="flex-1 flex flex-col min-w-0 bg-background">
        {topComposeOpen ? (
          <ScrollArea className="flex-1">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {leftPanelCollapsed && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setLeftPanelCollapsed(false)}
                      title="Show inbox list"
                    >
                      <PanelLeft className="h-4 w-4" />
                    </Button>
                  )}
                  <h2 className="text-lg font-semibold">New Email</h2>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setTopComposeOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Mode toggle */}
              <div className="flex gap-2">
                <Button
                  variant={topComposeMode === "single" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTopComposeMode("single")}
                >
                  <Mail className="h-4 w-4 mr-1.5" />
                  Single
                </Button>
                <Button
                  variant={topComposeMode === "bulk" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTopComposeMode("bulk")}
                >
                  <Users className="h-4 w-4 mr-1.5" />
                  Bulk
                </Button>
              </div>

              {/* Sender select — always shown for single; shown in bulk only when "same sender" */}
              {(topComposeMode === "single" || !bulkIndividualSenders) && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground w-12">From:</span>
                  <Select value={composeSenderId} onValueChange={setComposeSenderId}>
                    <SelectTrigger className="h-8 flex-1">
                      <SelectValue placeholder="Select sender" />
                    </SelectTrigger>
                    <SelectContent>
                      {(orgEmails || []).map((oe) => (
                        <SelectItem key={oe.id} value={oe.id}>
                          {oe.display_name ? `${oe.display_name} <${oe.email}>` : oe.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {topComposeMode === "single" ? (
                <div className="space-y-3">
                  <Input
                    placeholder="Recipient email address"
                    value={topComposeTo}
                    onChange={(e) => setTopComposeTo(e.target.value)}
                    className="h-9"
                  />
                  <Input
                    placeholder="Subject"
                    value={topComposeSubject}
                    onChange={(e) => setTopComposeSubject(e.target.value)}
                    className="h-9"
                  />
                  <Textarea
                    placeholder="Write your email..."
                    value={topComposeBody}
                    onChange={(e) => setTopComposeBody(e.target.value)}
                    className="min-h-[180px] resize-none"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={
                        !topComposeTo.trim() ||
                        !topComposeSubject.trim() ||
                        !topComposeBody.trim() ||
                        sendTopComposeMutation.isPending
                      }
                      onClick={() => sendTopComposeMutation.mutate()}
                    >
                      {sendTopComposeMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      <Send className="h-4 w-4 mr-1.5" />
                      Send
                    </Button>
                  </div>
                </div>
              ) : (
                /* Bulk mode */
                <div className="space-y-4">
                  {/* <p className="text-sm text-muted-foreground">
                    Add multiple recipients with individual messages. Each person gets their own unique email.
                  </p> */}

                  <div className="flex gap-3">
                    <Select value={bulkMessageMode} onValueChange={(v: "shared" | "individual") => setBulkMessageMode(v)}>
                      <SelectTrigger className="h-8 text-sm w-auto">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="shared">Same message</SelectItem>
                        <SelectItem value="individual">Individual messages</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={bulkIndividualSenders ? "individual" : "same"} onValueChange={(v) => setBulkIndividualSenders(v === "individual")}>
                      <SelectTrigger className="h-8 text-sm w-auto">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="same">Same sender</SelectItem>
                        <SelectItem value="individual">Individual senders</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Shared subject & body (shown in "same message" mode) */}
                  {bulkMessageMode === "shared" && (
                    <div className="space-y-2 border rounded-lg p-4">
                      <Input
                        placeholder="Subject"
                        value={bulkSharedSubject}
                        onChange={(e) => setBulkSharedSubject(e.target.value)}
                        className="h-8 text-sm"
                      />
                      <Textarea
                        placeholder="Write your email..."
                        value={bulkSharedBody}
                        onChange={(e) => setBulkSharedBody(e.target.value)}
                        className="min-h-[120px] resize-none text-sm"
                      />
                    </div>
                  )}

                  {bulkRecipients.map((recipient, index) => (
                    <div key={recipient.id} className={`border rounded-lg p-4 space-y-2 relative ${bulkMessageMode === "shared" ? "py-2" : ""}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          Recipient {index + 1}
                        </span>
                        {bulkRecipients.length > 1 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            onClick={() =>
                              setBulkRecipients((prev) => prev.filter((r) => r.id !== recipient.id))
                            }
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      <Input
                        placeholder="Email address"
                        value={recipient.to}
                        onChange={(e) =>
                          setBulkRecipients((prev) =>
                            prev.map((r) => (r.id === recipient.id ? { ...r, to: e.target.value } : r))
                          )
                        }
                        className="h-8 text-sm"
                      />
                      {bulkIndividualSenders && (
                        <Select
                          value={recipient.senderId || composeSenderId}
                          onValueChange={(v) =>
                            setBulkRecipients((prev) =>
                              prev.map((r) => (r.id === recipient.id ? { ...r, senderId: v } : r))
                            )
                          }
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="Select sender" />
                          </SelectTrigger>
                          <SelectContent>
                            {(orgEmails || []).map((oe) => (
                              <SelectItem key={oe.id} value={oe.id}>
                                {oe.display_name ? `${oe.display_name} <${oe.email}>` : oe.email}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                      {bulkMessageMode === "individual" && (
                        <>
                          <Input
                            placeholder="Subject"
                            value={recipient.subject}
                            onChange={(e) =>
                              setBulkRecipients((prev) =>
                                prev.map((r) => (r.id === recipient.id ? { ...r, subject: e.target.value } : r))
                              )
                            }
                            className="h-8 text-sm"
                          />
                          <Textarea
                            placeholder="Write your email..."
                            value={recipient.body}
                            onChange={(e) =>
                              setBulkRecipients((prev) =>
                                prev.map((r) => (r.id === recipient.id ? { ...r, body: e.target.value } : r))
                              )
                            }
                            className="min-h-[100px] resize-none text-sm"
                          />
                        </>
                      )}
                    </div>
                  ))}

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() =>
                      setBulkRecipients((prev) => [
                        ...prev,
                        { id: crypto.randomUUID(), to: "", subject: "", body: "", senderId: "" },
                      ])
                    }
                  >
                    <Plus className="h-4 w-4 mr-1.5" />
                    Add Recipient
                  </Button>

                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      {bulkMessageMode === "shared"
                        ? `${bulkRecipients.filter((r) => r.to.trim()).length} of ${bulkRecipients.length} ready to send`
                        : `${bulkRecipients.filter((r) => r.to.trim() && r.subject.trim() && r.body.trim()).length} of ${bulkRecipients.length} ready to send`
                      }
                    </span>
                    <Button
                      size="sm"
                      disabled={
                        bulkSending ||
                        (bulkMessageMode === "shared"
                          ? !bulkSharedSubject.trim() || !bulkSharedBody.trim() || bulkRecipients.filter((r) => r.to.trim()).length === 0
                          : bulkRecipients.filter((r) => r.to.trim() && r.subject.trim() && r.body.trim()).length === 0)
                      }
                      onClick={sendBulkEmails}
                    >
                      {bulkSending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      <Send className="h-4 w-4 mr-1.5" />
                      Send All
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        ) : !selectedThread ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-8 relative">
            {leftPanelCollapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-3 left-3 h-8 w-8"
                onClick={() => setLeftPanelCollapsed(false)}
                title="Show inbox list"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            )}
            <Mail className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <p className="text-muted-foreground">Select a conversation to view</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Thread header */}
            <div className="px-6 py-4 border-b shrink-0">
              <div className="flex items-center gap-2">
                {leftPanelCollapsed && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setLeftPanelCollapsed(false)}
                    title="Show inbox list"
                  >
                    <PanelLeft className="h-4 w-4" />
                  </Button>
                )}
                <div className="min-w-0 flex-1">
                  <h2 className="text-lg font-semibold truncate">
                    {selectedThread.contactName || selectedThread.contactEmail}
                  </h2>
                  {selectedThread.contactName && (
                    <p className="text-sm text-muted-foreground">{selectedThread.contactEmail}</p>
                  )}
                </div>
                <Badge variant="outline" className="shrink-0">
                  {selectedThread.messageCount} email{selectedThread.messageCount !== 1 ? "s" : ""}
                </Badge>
              </div>
            </div>

            {/* Thread emails — scrollable */}
            <ScrollArea className="flex-1">
              <div className="p-6 space-y-4">
                {selectedThread.emails.map((email) => (
                  <div
                    key={`${email.direction}-${email.id}`}
                    className={`border rounded-lg overflow-hidden ${
                      email.direction === "in" ? "border-blue-500/20" : ""
                    }`}
                  >
                    {/* Email card header */}
                    <div className={`px-4 py-2.5 flex items-center justify-between gap-3 ${
                      email.direction === "in" ? "bg-blue-500/5" : "bg-muted/30"
                    }`}>
                      <div className="flex items-center gap-2 min-w-0">
                        {email.direction === "in" ? (
                          <ArrowDownLeft className="h-3.5 w-3.5 shrink-0 text-blue-500" />
                        ) : (
                          <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="text-sm font-medium truncate">
                          {email.direction === "in"
                            ? `${email.contactName || email.contactEmail}`
                            : `You${email.senderEmail ? ` (${email.senderEmail})` : ""}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {email.direction === "out" && (
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${
                            email.repliedAt ? "border-purple-500/30 text-purple-600" :
                            email.openedAt ? "border-green-500/30 text-green-600" :
                            email.status === "failed" ? "border-red-500/30 text-red-600" :
                            "border-border"
                          }`}>
                            {statusLabel(email.status || "sent", email.openedAt || null, email.repliedAt || null)}
                          </Badge>
                        )}
                        {email.direction === "in" && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-blue-500/30 text-blue-600">
                            Received
                          </Badge>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {email.timestamp ? format(new Date(email.timestamp), "MMM d, h:mm a") : "—"}
                        </span>
                      </div>
                    </div>

                    {/* Subject line */}
                    {email.subject && (
                      <div className="px-4 py-1.5 border-b text-sm font-medium">
                        {email.subject}
                      </div>
                    )}

                    {/* Email body */}
                    <div className="px-4 py-3">
                      {email.direction === "out" ? (
                        email.body ? (
                          <div
                            className="prose prose-sm dark:prose-invert max-w-none text-sm"
                            dangerouslySetInnerHTML={{ __html: email.body }}
                          />
                        ) : (
                          <p className="text-sm text-muted-foreground italic">Email body not available.</p>
                        )
                      ) : (
                        email.html ? (
                          <div
                            className="prose prose-sm dark:prose-invert max-w-none text-sm"
                            dangerouslySetInnerHTML={{ __html: email.html }}
                          />
                        ) : email.textBody ? (
                          <p className="text-sm whitespace-pre-wrap">{email.textBody}</p>
                        ) : (
                          <p className="text-sm text-muted-foreground italic">Email body not available.</p>
                        )
                      )}
                    </div>

                    {/* Error message for failed outbound */}
                    {email.direction === "out" && email.errorMessage && (
                      <div className="px-4 py-2 border-t bg-red-500/5 flex items-center gap-2 text-sm text-red-600">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        {email.errorMessage}
                      </div>
                    )}

                    {/* Tracking info for outbound */}
                    {email.direction === "out" && (email.openedAt || email.repliedAt) && (
                      <div className="px-4 py-2 border-t bg-muted/20 flex items-center gap-4 text-xs text-muted-foreground">
                        {email.openedAt && (
                          <span className="flex items-center gap-1">
                            <Eye className="h-3 w-3 text-green-500" />
                            Opened {format(new Date(email.openedAt), "MMM d 'at' h:mm a")}
                          </span>
                        )}
                        {email.repliedAt && (
                          <span className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3 text-purple-500" />
                            Replied {format(new Date(email.repliedAt), "MMM d 'at' h:mm a")}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Next Scheduled */}
                {nextScheduled && (
                  <div className="border rounded-lg bg-blue-500/5 border-blue-500/20">
                    <div className="px-4 py-2 border-b border-blue-500/20">
                      <span className="text-xs font-medium text-blue-600 flex items-center gap-1.5">
                        <Clock className="h-3.5 w-3.5" />
                        Next Scheduled Email
                      </span>
                    </div>
                    <div className="p-4 text-sm space-y-1">
                      <p className="font-medium">
                        Step {(nextScheduled.sequence_steps?.step_order ?? 0) + 1}: {nextScheduled.sequence_steps?.email_templates?.name || "Untitled"}
                      </p>
                      <p className="text-muted-foreground">
                        Subject: {nextScheduled.sequence_steps?.email_templates?.subject || "—"}
                      </p>
                      <p className="text-muted-foreground">
                        Scheduled for {format(new Date(nextScheduled.scheduled_for), "MMM d, yyyy 'at' h:mm a")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>

            {/* Reply bar at bottom */}
            {!composeOpen ? (
              <div className="px-6 py-3 border-t shrink-0 flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setComposeOpen(true);
                    const lastSubject = selectedThread.emails[selectedThread.emails.length - 1]?.subject || "";
                    setComposeSubject(lastSubject.startsWith("Re:") ? lastSubject : `Re: ${lastSubject}`);
                  }}
                >
                  <MessageSquare className="h-4 w-4 mr-2" />
                  Reply
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setComposeOpen(true);
                    setComposeSubject("");
                  }}
                >
                  <Mail className="h-4 w-4 mr-2" />
                  New Email
                </Button>
              </div>
            ) : (
              <div className="px-6 py-3 border-t shrink-0 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Compose Email</span>
                  <Button variant="ghost" size="sm" onClick={() => setComposeOpen(false)}>
                    Cancel
                  </Button>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground w-12">To:</span>
                    <span>{selectedThread.contactEmail}</span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground w-12">From:</span>
                    <Select value={composeSenderId} onValueChange={setComposeSenderId}>
                      <SelectTrigger className="h-8 flex-1">
                        <SelectValue placeholder="Select sender" />
                      </SelectTrigger>
                      <SelectContent>
                        {(orgEmails || []).map((oe) => (
                          <SelectItem key={oe.id} value={oe.id}>
                            {oe.display_name ? `${oe.display_name} <${oe.email}>` : oe.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Input
                    placeholder="Subject"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    className="h-9"
                  />
                  <Textarea
                    placeholder="Write your email..."
                    value={composeBody}
                    onChange={(e) => setComposeBody(e.target.value)}
                    className="min-h-[120px] resize-none"
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={!composeSubject.trim() || !composeBody.trim() || sendEmailMutation.isPending}
                      onClick={() => sendEmailMutation.mutate()}
                    >
                      {sendEmailMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      <Send className="h-4 w-4 mr-2" />
                      Send
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
