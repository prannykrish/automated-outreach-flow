import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Users, Globe, Mail, Plus, Trash2, Shield, CheckCircle, Eye, RefreshCw, Copy, Check, Clock, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function Organization() {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [showInviteDialog, setShowInviteDialog] = useState(false);
  
  const [newDomain, setNewDomain] = useState("");
  const [showDomainDialog, setShowDomainDialog] = useState(false);
  
  const [newEmailLocal, setNewEmailLocal] = useState("");
  const [newEmailDomain, setNewEmailDomain] = useState("");
  const [newEmailDisplayName, setNewEmailDisplayName] = useState("");
  const [newEmailReplyTo, setNewEmailReplyTo] = useState("");
  const [showEmailDialog, setShowEmailDialog] = useState(false);
  
  const [deleteTarget, setDeleteTarget] = useState<{ type: "member" | "domain" | "email"; id: string; name: string } | null>(null);

  // Domain DNS dialog state
  const [selectedDomain, setSelectedDomain] = useState<any>(null);
  const [showDnsDialog, setShowDnsDialog] = useState(false);
  const [verifyingDomainId, setVerifyingDomainId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Get current user's organization membership
  // Use isPending (not isLoading) so the loading state covers the gap when
  // `enabled` transitions from false→true but the fetch hasn't started yet.
  const { data: membership, isPending: membershipPending } = useQuery({
    queryKey: ["my-membership", user?.id, !!session],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from("organization_members")
        .select("*, organizations(*)")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id && !!session,
  });

  const isAdmin = membership?.role === "admin";
  const organization = membership?.organizations;

  // Get organization members
  const { data: members } = useQuery({
    queryKey: ["org-members", organization?.id, !!session],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from("organization_members")
        .select("*, users(*)")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id && !!session,
  });

  // Helper to call manage-domains edge function
  const callManageDomains = async (body: Record<string, any>) => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const controller = new AbortController();
    const timeoutMs = body.action === "verify" ? 30000 : 15000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/manage-domains`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || "Request failed");
      }
      return data;
    } catch (err: any) {
      if (err.name === "AbortError") {
        throw new Error("Request timed out. Please try again.");
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  };

  // Get organization domains
  // Auto-poll every 15s when any domain is unverified — calls edge function
  // to sync with Resend so status updates appear in real time
  const { data: domains } = useQuery({
    queryKey: ["org-domains", organization?.id, !!session],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from("organization_domains")
        .select("*")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id && !!session,
    refetchInterval: (query) => {
      const data = query.state.data as any[] | undefined;
      return data?.some((d) => !d.verified) ? 15000 : false;
    },
  });

  // Background sync: when unverified domains exist, periodically call
  // the edge function to sync status from Resend (not just read local DB)
  useEffect(() => {
    if (!organization?.id || !domains) return;
    const hasUnverified = domains.some((d: any) => !d.verified && d.resend_domain_id);
    if (!hasUnverified) return;

    const syncStatus = async () => {
      try {
        await callManageDomains({
          action: "sync-status",
          organization_id: organization.id,
        });
        queryClient.invalidateQueries({ queryKey: ["org-domains"] });
      } catch {
        // Silently ignore sync errors
      }
    };

    // Sync immediately once, then every 15s
    syncStatus();
    const interval = setInterval(syncStatus, 15000);
    return () => clearInterval(interval);
  }, [organization?.id, domains?.some((d: any) => !d.verified)]);

  // Keep the DNS dialog in sync when polling updates domain data
  useEffect(() => {
    if (selectedDomain && domains) {
      const updated = domains.find((d: any) => d.id === selectedDomain.id);
      if (
        updated &&
        (updated.verified !== selectedDomain.verified ||
          updated.status !== selectedDomain.status ||
          JSON.stringify(updated.dns_records) !== JSON.stringify(selectedDomain.dns_records))
      ) {
        setSelectedDomain(updated);
      }
    }
  }, [domains]);

  // Get organization emails
  const { data: emails } = useQuery({
    queryKey: ["org-emails", organization?.id, !!session],
    queryFn: async () => {
      if (!organization?.id) return [];
      const { data, error } = await supabase
        .from("organization_emails")
        .select("*")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!organization?.id && !!session,
  });

  // Invite member mutation
  const inviteMemberMutation = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) => {
      // First, find the user by email
      const { data: targetUser, error: userError } = await supabase
        .from("users")
        .select("id")
        .eq("email", email)
        .maybeSingle();

      if (userError) throw userError;
      if (!targetUser) throw new Error("User not found. They must create an account first.");

      // Check if already a member
      const { data: existing } = await supabase
        .from("organization_members")
        .select("id")
        .eq("organization_id", organization?.id)
        .eq("user_id", targetUser.id)
        .maybeSingle();

      if (existing) throw new Error("User is already a member of this organization.");

      // Add to organization
      const { error } = await supabase.from("organization_members").insert({
        organization_id: organization?.id,
        user_id: targetUser.id,
        role,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
      queryClient.invalidateQueries({ queryKey: ["org-members", organization?.id] });
      setShowInviteDialog(false);
      setInviteEmail("");
      setInviteRole("member");
      toast({ title: "Member added successfully" });
    },
    onError: (error) => {
      toast({ title: "Error adding member", description: error.message, variant: "destructive" });
    },
  });

  // Update member role mutation
  const updateRoleMutation = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: string }) => {
      const { error } = await supabase
        .from("organization_members")
        .update({ role })
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
      queryClient.invalidateQueries({ queryKey: ["org-members", organization?.id] });
      toast({ title: "Role updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating role", description: error.message, variant: "destructive" });
    },
  });

  // Add domain mutation - uses edge function to register with Resend
  const addDomainMutation = useMutation({
    mutationFn: async (domain: string) => {
      return callManageDomains({
        action: "add",
        domain: domain.toLowerCase().trim(),
        organization_id: organization?.id,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["org-domains"] });
      queryClient.invalidateQueries({ queryKey: ["org-domains", organization?.id] });
      setShowDomainDialog(false);
      setNewDomain("");

      if (data.domain?.verified || data.synced) {
        // Domain was already verified on Resend — just synced
        if (data.domain?.verified) {
          toast({ title: "Domain verified!", description: "This domain is already verified and ready to use." });
        } else {
          setSelectedDomain(data.domain);
          setShowDnsDialog(true);
          toast({ title: "Domain synced", description: "Domain was already on Resend. Please verify your DNS records." });
        }
      } else {
        // New domain — show DNS records
        setSelectedDomain(data.domain);
        setShowDnsDialog(true);
        toast({ title: "Domain added", description: "Please add the DNS records shown to verify your domain." });
      }
    },
    onError: (error: any) => {
      let message = error.message || "Failed to add domain";
      if (message.includes("plan includes")) {
        message = "Your Resend plan limit reached. Upgrade your plan to add more domains.";
      }
      toast({ title: "Error adding domain", description: message, variant: "destructive" });
    },
  });

  // Verify domain mutation
  const verifyDomainMutation = useMutation({
    mutationFn: async (domainId: string) => {
      return callManageDomains({
        action: "verify",
        domain_id: domainId,
        organization_id: organization?.id,
      });
    },
    onSuccess: (data) => {
      setVerifyingDomainId(null);

      // Immediately update the query cache with the returned domain data
      // so the UI reflects the new status without waiting for a refetch
      if (data.domain) {
        queryClient.setQueryData(
          ["org-domains", organization?.id, !!session],
          (old: any[] | undefined) =>
            old?.map((d) => (d.id === data.domain.id ? data.domain : d)) ?? old
        );
        // Update DNS dialog if open
        if (selectedDomain?.id === data.domain.id) {
          setSelectedDomain(data.domain);
        }
      }

      // Also invalidate to ensure eventual consistency
      queryClient.invalidateQueries({ queryKey: ["org-domains"] });

      const status = data.status;
      const dnsRecords = data.dns_records || [];
      const anyVerified = dnsRecords.some((r: any) => r.status === "verified");
      const anyPending = dnsRecords.some((r: any) => r.status === "pending" || r.status === "checking");

      if (data.verified) {
        toast({ title: "Domain verified!", description: "You can now send emails from this domain." });
      } else if (status === "not_started" || (!anyPending && !anyVerified && dnsRecords.length > 0)) {
        toast({
          title: "Verification not detected",
          description: "No DNS records were detected for this domain. Please double-check your DNS entries and try again.",
          variant: "destructive",
        });
      } else if (dnsRecords.length === 0 && status !== "verified") {
        toast({
          title: "Verification not detected",
          description: "No DNS records were returned. Ensure you've added the records exactly as shown, then try again.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Verification in progress",
          description: "DNS records are being checked. This may take a few minutes to propagate."
        });
      }
    },
    onError: (error) => {
      setVerifyingDomainId(null);
      toast({ title: "Verification failed", description: error.message, variant: "destructive" });
    },
  });

  // Add email mutation
  const addEmailMutation = useMutation({
    mutationFn: async ({ email, displayName, replyTo }: { email: string; displayName: string; replyTo: string }) => {
      const { error } = await supabase.from("organization_emails").insert({
        organization_id: organization?.id,
        email: email.toLowerCase().trim(),
        display_name: displayName.trim() || null,
        reply_to: replyTo.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-emails"] });
      queryClient.invalidateQueries({ queryKey: ["org-emails", organization?.id] });
      setShowEmailDialog(false);
      setNewEmailLocal("");
      setNewEmailDomain("");
      setNewEmailDisplayName("");
      setNewEmailReplyTo("");
      toast({ title: "Email added" });
    },
    onError: (error) => {
      toast({ title: "Error adding email", description: error.message, variant: "destructive" });
    },
  });

  // Delete mutation - uses edge function for domains to also delete from Resend
  const deleteMutation = useMutation({
    mutationFn: async ({ type, id }: { type: "member" | "domain" | "email"; id: string }) => {
      if (type === "domain") {
        // Use edge function to delete from Resend and database
        await callManageDomains({
          action: "delete",
          domain_id: id,
          organization_id: organization?.id,
        });
        return;
      }
      // For members and emails, use direct database deletion
      const table = type === "member" ? "organization_members" : "organization_emails";
      const { error } = await supabase.from(table).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { type }) => {
      // Invalidate both the generic list and the org-scoped list (which includes organization id in key)
      queryClient.invalidateQueries({ queryKey: [`org-${type}s`] });
      queryClient.invalidateQueries({ queryKey: [`org-${type}s`, organization?.id] });
      setDeleteTarget(null);
      toast({ title: `${type.charAt(0).toUpperCase() + type.slice(1)} removed` });
    },
    onError: (error) => {
      toast({ title: "Error removing", description: error.message, variant: "destructive" });
    },
  });

  // Set default email mutation
  const setDefaultEmailMutation = useMutation({
    mutationFn: async (emailId: string) => {
      // First, unset all defaults
      await supabase
        .from("organization_emails")
        .update({ is_default: false })
        .eq("organization_id", organization?.id);
      
      // Set the new default
      const { error } = await supabase
        .from("organization_emails")
        .update({ is_default: true })
        .eq("id", emailId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["org-emails"] });
      toast({ title: "Default email updated" });
    },
    onError: (error) => {
      toast({ title: "Error setting default", description: error.message, variant: "destructive" });
    },
  });

  if (membershipPending) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Organization</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <Loader2 className="h-12 w-12 mx-auto mb-4 text-muted-foreground animate-spin" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Organization</h1>
          <p className="text-muted-foreground">You are not part of any organization yet.</p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Contact an administrator to be added to an organization.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Organization</h1>
          <p className="text-muted-foreground">{organization.name}</p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">You need admin access to manage organization settings.</p>
            <Badge variant="outline" className="mt-4">Member</Badge>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Organization</h1>
        <p className="text-muted-foreground">Manage {organization.name}</p>
      </div>

      {/* Members Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Members
              </CardTitle>
              <CardDescription>{members?.length || 0} members in this organization</CardDescription>
            </div>
            <Dialog open={showInviteDialog} onOpenChange={setShowInviteDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Member
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Member</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Email</label>
                    <Input
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="user@example.com"
                      type="email"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Role</label>
                    <Select value={inviteRole} onValueChange={(v: "admin" | "member") => setInviteRole(v)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setShowInviteDialog(false)}>Cancel</Button>
                    <Button
                      onClick={() => inviteMemberMutation.mutate({ email: inviteEmail, role: inviteRole })}
                      disabled={!inviteEmail || inviteMemberMutation.isPending}
                    >
                      Add Member
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members?.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium text-primary">
                          {member.users?.first_name?.[0] || member.users?.email?.[0]?.toUpperCase() || "?"}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium">{member.users?.name || member.users?.first_name || "Unknown"}</p>
                        <p className="text-sm text-muted-foreground">{member.users?.email}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={member.role}
                      onValueChange={(role) => updateRoleMutation.mutate({ memberId: member.id, role })}
                      disabled={member.user_id === user?.id}
                    >
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="member">Member</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(member.created_at), "MMM d, yyyy")}
                  </TableCell>
                  <TableCell>
                    {member.user_id !== user?.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget({ type: "member", id: member.id, name: member.users?.email || "" })}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Domains Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5" />
                Domains
              </CardTitle>
              <CardDescription>Verified domains for sending emails</CardDescription>
            </div>
            <Dialog open={showDomainDialog} onOpenChange={setShowDomainDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Domain
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Domain</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Domain</label>
                    <Input
                      value={newDomain}
                      onChange={(e) => setNewDomain(e.target.value)}
                      placeholder="example.com"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Enter your domain (e.g., example.com). You'll receive DNS records to add.
                    </p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setShowDomainDialog(false)}>Cancel</Button>
                    <Button
                      onClick={() => addDomainMutation.mutate(newDomain)}
                      disabled={!newDomain || addDomainMutation.isPending}
                    >
                      Add Domain
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {domains?.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No domains added yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Domain</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {domains?.map((domain) => (
                  <TableRow key={domain.id}>
                    <TableCell className="font-mono">{domain.domain}</TableCell>
                    <TableCell>
                      {domain.verified ? (
                        <Badge className="bg-green-500">
                          <CheckCircle className="h-3 w-3 mr-1" />
                          Verified
                        </Badge>
                      ) : domain.status === "not_started" ? (
                        <Badge variant="outline" className="text-red-500 border-red-500">
                          <Clock className="h-3 w-3 mr-1" />
                          DNS Not Detected
                        </Badge>
                      ) : domain.status === "failed" || domain.status === "temporary_failure" ? (
                        <Badge variant="outline" className="text-red-500 border-red-500">
                          <Clock className="h-3 w-3 mr-1" />
                          Verification Failed
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          Verifying
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(domain.created_at), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {/* View DNS Records */}
                        {domain.dns_records && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="View DNS Records"
                            onClick={() => {
                              setSelectedDomain(domain);
                              setShowDnsDialog(true);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                        {/* Verify Button - only for unverified domains */}
                        {!domain.verified && domain.resend_domain_id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Check Verification"
                            onClick={() => {
                              setVerifyingDomainId(domain.id);
                              verifyDomainMutation.mutate(domain.id);
                            }}
                            disabled={verifyingDomainId === domain.id}
                          >
                            {verifyingDomainId === domain.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        {/* Delete Button */}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget({ type: "domain", id: domain.id, name: domain.domain })}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Emails Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Sending Emails
              </CardTitle>
              <CardDescription>
                {(() => {
                  const defaultEmail = emails?.find((e: any) => e.is_default);
                  if (defaultEmail) {
                    return (
                      <>
                        Default: <span className="font-medium text-foreground">{defaultEmail.display_name ? `${defaultEmail.display_name} <${defaultEmail.email}>` : defaultEmail.email}</span>
                      </>
                    );
                  }
                  return emails?.length ? "No default email set — select one below" : "Add email addresses for outreach";
                })()}
              </CardDescription>
            </div>
            <Dialog open={showEmailDialog} onOpenChange={setShowEmailDialog}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Email
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Sending Email</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Email Address</label>
                    {(() => {
                      const verifiedDomains = domains?.filter((d: any) => d.verified) || [];
                      if (verifiedDomains.length === 0) {
                        return (
                          <p className="text-sm text-muted-foreground mt-1">
                            No verified domains. Add and verify a domain first.
                          </p>
                        );
                      }
                      return (
                        <div className="flex items-center gap-1 mt-1">
                          <Input
                            value={newEmailLocal}
                            onChange={(e) => setNewEmailLocal(e.target.value.replace(/[@\s]/g, ""))}
                            placeholder="hello"
                            className="flex-1"
                          />
                          <span className="text-muted-foreground font-mono">@</span>
                          <Select value={newEmailDomain} onValueChange={setNewEmailDomain}>
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder="Select domain" />
                            </SelectTrigger>
                            <SelectContent>
                              {verifiedDomains.map((d: any) => (
                                <SelectItem key={d.id} value={d.domain}>{d.domain}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })()}
                  </div>
                  <div>
                    <label className="text-sm font-medium">Display Name (optional)</label>
                    <Input
                      value={newEmailDisplayName}
                      onChange={(e) => setNewEmailDisplayName(e.target.value)}
                      placeholder="John Smith"
                    />
                    {newEmailLocal && newEmailDomain && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Recipients will see: {newEmailDisplayName
                          ? `"${newEmailDisplayName} <${newEmailLocal}@${newEmailDomain}>"`
                          : `"${newEmailLocal}@${newEmailDomain}"`}
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="text-sm font-medium">Reply-To Email (optional)</label>
                    <Input
                      value={newEmailReplyTo}
                      onChange={(e) => setNewEmailReplyTo(e.target.value)}
                      placeholder="your-personal@gmail.com"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      When recipients reply, it goes to this address instead.
                    </p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setShowEmailDialog(false)}>Cancel</Button>
                    <Button
                      onClick={() => addEmailMutation.mutate({ email: `${newEmailLocal}@${newEmailDomain}`, displayName: newEmailDisplayName, replyTo: newEmailReplyTo })}
                      disabled={!newEmailLocal || !newEmailDomain || addEmailMutation.isPending}
                    >
                      Add Email
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {emails?.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No sending emails added yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Display Name</TableHead>
                  <TableHead>Reply-To</TableHead>
                  <TableHead>Default</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {emails?.map((email) => (
                  <TableRow key={email.id}>
                    <TableCell className="font-mono">{email.email}</TableCell>
                    <TableCell>{email.display_name || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-sm">{(email as any).reply_to || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      {email.is_default ? (
                        <Badge className="bg-primary">Default</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDefaultEmailMutation.mutate(email.id)}
                        >
                          Set as default
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget({ type: "email", id: email.id, name: email.email })}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* DNS Records Dialog */}
      <Dialog open={showDnsDialog} onOpenChange={setShowDnsDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>DNS Records for {selectedDomain?.domain}</DialogTitle>
            <DialogDescription>
              Add these DNS records to your domain's DNS settings (e.g., Cloudflare, GoDaddy, Namecheap) to verify ownership.
              DNS changes can take up to 48 hours to propagate, but usually complete within a few minutes.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {selectedDomain?.dns_records?.map((record: any, index: number) => (
              <Card key={index} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <Badge variant={record.status === "verified" ? "default" : "outline"}>
                    {record.record || record.type} Record
                  </Badge>
                  {record.status === "verified" ? (
                    <span className="text-green-500 text-sm flex items-center gap-1">
                      <CheckCircle className="h-4 w-4" /> Verified
                    </span>
                  ) : record.status === "not_started" ? (
                    <span className="text-red-500 text-sm flex items-center gap-1">
                      <Clock className="h-4 w-4" /> Not detected
                    </span>
                  ) : (
                    <span className="text-yellow-600 text-sm flex items-center gap-1">
                      <Loader2 className="h-4 w-4 animate-spin" /> Checking...
                    </span>
                  )}
                </div>
                <div className="grid gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Type</p>
                    <code className="bg-muted px-2 py-1 rounded text-sm">{record.type}</code>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Name / Host</p>
                    <div className="flex items-center gap-2">
                      <code className="bg-muted px-2 py-1 rounded text-sm flex-1 break-all">{record.name}</code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(record.name);
                          setCopiedField(`name-${index}`);
                          setTimeout(() => setCopiedField(null), 2000);
                        }}
                      >
                        {copiedField === `name-${index}` ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Value</p>
                    <div className="flex items-center gap-2">
                      <code className="bg-muted px-2 py-1 rounded text-sm flex-1 break-all max-h-20 overflow-y-auto">{record.value}</code>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          navigator.clipboard.writeText(record.value);
                          setCopiedField(`value-${index}`);
                          setTimeout(() => setCopiedField(null), 2000);
                        }}
                      >
                        {copiedField === `value-${index}` ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                  {record.priority !== undefined && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Priority</p>
                      <code className="bg-muted px-2 py-1 rounded text-sm">{record.priority}</code>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowDnsDialog(false)}>
              Close
            </Button>
            {selectedDomain && !selectedDomain.verified && (
              <Button
                onClick={() => {
                  setVerifyingDomainId(selectedDomain.id);
                  verifyDomainMutation.mutate(selectedDomain.id);
                }}
                disabled={verifyingDomainId === selectedDomain?.id}
              >
                {verifyingDomainId === selectedDomain?.id ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Checking...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Check Verification
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteTarget?.type}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-3 justify-end">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate({ type: deleteTarget.type, id: deleteTarget.id })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}