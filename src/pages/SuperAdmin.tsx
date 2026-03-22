import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Building, Users, Shield, Plus, Trash2, UserPlus, Mail, Globe, ShieldCheck, Send, Eye, ArrowRightLeft, CreditCard, DollarSign } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function SuperAdmin() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [showCreateOrgDialog, setShowCreateOrgDialog] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  
  const [showAddUserToOrgDialog, setShowAddUserToOrgDialog] = useState(false);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);
  const [userEmailToAdd, setUserEmailToAdd] = useState("");
  const [userRoleToAdd, setUserRoleToAdd] = useState<"admin" | "member">("member");
  
  const [viewingOrg, setViewingOrg] = useState<any | null>(null);
  
  const [deleteTarget, setDeleteTarget] = useState<{ type: "org" | "user" | "member"; id: string; name: string } | null>(null);

  // Move user to org dialog state
  const [moveTarget, setMoveTarget] = useState<{ userId: string; userName: string; currentOrgId?: string } | null>(null);
  const [moveToOrgId, setMoveToOrgId] = useState<string>("");
  const [moveRole, setMoveRole] = useState<"admin" | "member">("member");

  // Check if current user is super admin
  const { data: isSuperAdmin, isLoading: checkingAdmin } = useQuery({
    queryKey: ["is-super-admin", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data, error } = await supabase
        .from("users")
        .select("is_super_admin")
        .eq("id", user.id)
        .single();
      if (error) return false;
      return data?.is_super_admin === true;
    },
    enabled: !!user?.id,
  });

  // Fetch all organizations
  const { data: organizations } = useQuery({
    queryKey: ["all-organizations"],
    queryFn: async () => {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const { data, error } = await supabase
        .from("organizations")
        .select(`
          *,
          organization_members(count),
          organization_domains(count),
          organization_emails(count),
          email_usage(emails_sent, month)
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Attach current month usage to each org
      return (data || []).map((org: any) => ({
        ...org,
        current_month_usage: (org.email_usage || []).find((u: any) => u.month === currentMonth)?.emails_sent || 0,
      }));
    },
    enabled: isSuperAdmin === true,
  });

  // Fetch detailed org info when viewing
  const { data: orgDetails } = useQuery({
    queryKey: ["org-details", viewingOrg?.id],
    queryFn: async () => {
      if (!viewingOrg?.id) return null;
      
      // Get members with email stats
      const { data: members } = await supabase
        .from("organization_members")
        .select("*, users(*)")
        .eq("organization_id", viewingOrg.id);
      
      // Get domains
      const { data: domains } = await supabase
        .from("organization_domains")
        .select("*")
        .eq("organization_id", viewingOrg.id);
      
      // Get emails
      const { data: emails } = await supabase
        .from("organization_emails")
        .select("*")
        .eq("organization_id", viewingOrg.id);
      
      // Get email stats per user
      const memberStats = await Promise.all(
        (members || []).map(async (member) => {
          const { count: sentCount } = await supabase
            .from("email_logs")
            .select("*", { count: "exact", head: true })
            .eq("user_id", member.user_id)
            .eq("status", "sent");
          
          const { count: failedCount } = await supabase
            .from("email_logs")
            .select("*", { count: "exact", head: true })
            .eq("user_id", member.user_id)
            .eq("status", "failed");
          
          return {
            ...member,
            emailsSent: sentCount || 0,
            emailsFailed: failedCount || 0,
          };
        })
      );
      
      // Get total org email stats
      const userIds = members?.map(m => m.user_id) || [];
      let totalSent = 0;
      let totalFailed = 0;
      
      if (userIds.length > 0) {
        const { count: sent } = await supabase
          .from("email_logs")
          .select("*", { count: "exact", head: true })
          .in("user_id", userIds)
          .eq("status", "sent");
        
        const { count: failed } = await supabase
          .from("email_logs")
          .select("*", { count: "exact", head: true })
          .in("user_id", userIds)
          .eq("status", "failed");
        
        totalSent = sent || 0;
        totalFailed = failed || 0;
      }
      
      return {
        members: memberStats,
        domains,
        emails,
        stats: {
          totalSent,
          totalFailed,
        },
      };
    },
    enabled: !!viewingOrg?.id,
  });

  // Fetch all users
  const { data: allUsers } = useQuery({
    queryKey: ["all-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: isSuperAdmin === true,
  });

  // Fetch all organization members with details
  const { data: allMembers } = useQuery({
    queryKey: ["all-org-members"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select(`
          *,
          users(*),
          organizations(*)
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: isSuperAdmin === true,
  });

  // Create organization mutation
  const createOrgMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await supabase
        .from("organizations")
        .insert({ name })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-organizations"] });
      setShowCreateOrgDialog(false);
      setNewOrgName("");
      toast({ title: "Organization created" });
    },
    onError: (error) => {
      toast({ title: "Error creating organization", description: error.message, variant: "destructive" });
    },
  });

  // Add user to organization mutation
  const addUserToOrgMutation = useMutation({
    mutationFn: async ({ orgId, email, role }: { orgId: string; email: string; role: string }) => {
      // Find user by email
      const { data: targetUser, error: userError } = await supabase
        .from("users")
        .select("id")
        .eq("email", email)
        .single();

      if (userError || !targetUser) {
        throw new Error("User not found. They must create an account first.");
      }

      // Check if already a member
      const { data: existing } = await supabase
        .from("organization_members")
        .select("id")
        .eq("organization_id", orgId)
        .eq("user_id", targetUser.id)
        .maybeSingle();

      if (existing) {
        throw new Error("User is already a member of this organization.");
      }

      // Add to organization
      const { error } = await supabase.from("organization_members").insert({
        organization_id: orgId,
        user_id: targetUser.id,
        role,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-org-members"] });
      queryClient.invalidateQueries({ queryKey: ["all-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["org-details"] });
      setShowAddUserToOrgDialog(false);
      setUserEmailToAdd("");
      setUserRoleToAdd("member");
      setSelectedOrgId(null);
      toast({ title: "User added to organization" });
    },
    onError: (error) => {
      toast({ title: "Error adding user", description: error.message, variant: "destructive" });
    },
  });

  // Move user to a different org (remove from current, add to new)
  const moveUserToOrgMutation = useMutation({
    mutationFn: async ({ userId, newOrgId, role }: { userId: string; newOrgId: string; role: string }) => {
      // Remove all existing memberships for this user
      const { error: deleteError } = await supabase
        .from("organization_members")
        .delete()
        .eq("user_id", userId);
      if (deleteError) throw deleteError;

      // Add to new org
      const { error: insertError } = await supabase
        .from("organization_members")
        .insert({ organization_id: newOrgId, user_id: userId, role });
      if (insertError) throw insertError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-org-members"] });
      queryClient.invalidateQueries({ queryKey: ["all-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["org-details"] });
      setMoveTarget(null);
      setMoveToOrgId("");
      setMoveRole("member");
      toast({ title: "User moved to organization" });
    },
    onError: (error) => {
      toast({ title: "Error moving user", description: error.message, variant: "destructive" });
    },
  });

  // Helper to call edge functions with the user's auth token
  const callEdgeFunction = async (functionName: string, body: Record<string, any>) => {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    if (!currentSession?.access_token) {
      throw new Error("No active session. Please sign in again.");
    }
    const response = await fetch(`${supabaseUrl}/functions/v1/${functionName}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${currentSession.access_token}`,
        "apikey": supabaseKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...body, access_token: currentSession.access_token }),
    });
    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(data.error || "Request failed");
    }
    return data;
  };

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async ({ type, id }: { type: "org" | "user" | "member"; id: string }) => {
      if (type === "user") {
        // Use edge function for full user cleanup (related records + auth.users)
        await callEdgeFunction("admin-delete-user", { user_id: id });
        return;
      }

      let error;
      if (type === "org") {
        ({ error } = await supabase.from("organizations").delete().eq("id", id));
      } else if (type === "member") {
        ({ error } = await supabase.from("organization_members").delete().eq("id", id));
      }

      if (error) throw error;
    },
    onSuccess: (_, { type }) => {
      if (type === "org") {
        queryClient.invalidateQueries({ queryKey: ["all-organizations"] });
      } else if (type === "user") {
        queryClient.invalidateQueries({ queryKey: ["all-users"] });
        queryClient.invalidateQueries({ queryKey: ["all-org-members"] });
        queryClient.invalidateQueries({ queryKey: ["all-organizations"] });
      } else if (type === "member") {
        queryClient.invalidateQueries({ queryKey: ["all-org-members"] });
        queryClient.invalidateQueries({ queryKey: ["all-organizations"] });
        queryClient.invalidateQueries({ queryKey: ["org-details"] });
      }
      setDeleteTarget(null);
      toast({ title: "Deleted successfully" });
    },
    onError: (error) => {
      toast({ title: "Error deleting", description: error.message, variant: "destructive" });
    },
  });

  const PLAN_CONFIGS: Record<string, { plan_email_limit: number; plan_domain_limit: number; plan_email_address_limit: number; plan_member_limit: number; plan_campaign_limit: number; billing_status: string }> = {
    trial: { plan_email_limit: 200, plan_domain_limit: 1, plan_email_address_limit: 2, plan_member_limit: 3, plan_campaign_limit: 5, billing_status: "active" },
    starter: { plan_email_limit: 2000, plan_domain_limit: 1, plan_email_address_limit: 2, plan_member_limit: 3, plan_campaign_limit: 9999, billing_status: "active" },
    growth: { plan_email_limit: 10000, plan_domain_limit: 3, plan_email_address_limit: 5, plan_member_limit: 10, plan_campaign_limit: 9999, billing_status: "active" },
    enterprise: { plan_email_limit: 99999, plan_domain_limit: 100, plan_email_address_limit: 100, plan_member_limit: 999, plan_campaign_limit: 9999, billing_status: "active" },
  };

  const setPlanMutation = useMutation({
    mutationFn: async ({ orgId, plan }: { orgId: string; plan: string }) => {
      const config = PLAN_CONFIGS[plan];
      if (!config) throw new Error("Invalid plan");
      const { error } = await supabase
        .from("organizations")
        .update({ plan, ...config })
        .eq("id", orgId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-organizations"] });
      queryClient.invalidateQueries({ queryKey: ["org-details"] });
      toast({ title: "Plan updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating plan", description: error.message, variant: "destructive" });
    },
  });

  if (checkingAdmin) {
    return <div className="p-10">Loading...</div>;
  }

  if (!isSuperAdmin) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Access Denied</h1>
          <p className="text-muted-foreground">You do not have super admin privileges.</p>
        </div>
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">This page is only accessible to super administrators.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const PLAN_PRICES: Record<string, number> = { starter: 19, growth: 49, enterprise: 199 };
  const payingOrgsList = organizations?.filter(o => ["starter", "growth", "enterprise"].includes(o.plan) && o.billing_status === "active" && o.name?.toLowerCase() !== "my company") || [];
  const monthlyRevenue = payingOrgsList.reduce((sum, o) => sum + (PLAN_PRICES[o.plan] || 0), 0);

  const stats = {
    totalOrgs: organizations?.length || 0,
    totalUsers: allUsers?.length || 0,
    superAdmins: allUsers?.filter(u => u.is_super_admin).length || 0,
    payingOrgs: payingOrgsList.length,
    monthlyRevenue,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <ShieldCheck className="h-8 w-8" />
          Super Admin Dashboard
        </h1>
        <p className="text-muted-foreground">Manage all organizations, users, and system settings</p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <Building className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{stats.totalOrgs}</p>
                <p className="text-sm text-muted-foreground">Organizations</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <Users className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{stats.totalUsers}</p>
                <p className="text-sm text-muted-foreground">Total Users</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <DollarSign className="h-8 w-8 text-green-600" />
              <div>
                <p className="text-2xl font-bold">${stats.monthlyRevenue}</p>
                <p className="text-sm text-muted-foreground">Monthly Revenue</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <CreditCard className="h-8 w-8 text-green-600" />
              <div>
                <p className="text-2xl font-bold">{stats.payingOrgs}</p>
                <p className="text-sm text-muted-foreground">Paying Orgs</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <Shield className="h-8 w-8 text-primary" />
              <div>
                <p className="text-2xl font-bold">{stats.superAdmins}</p>
                <p className="text-sm text-muted-foreground">Super Admins</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="organizations" className="space-y-4">
        <TabsList>
          <TabsTrigger value="organizations">Organizations</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
        </TabsList>

        {/* Organizations Tab */}
        <TabsContent value="organizations">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Building className="h-5 w-5" />
                    All Organizations
                  </CardTitle>
                  <CardDescription>{organizations?.length || 0} organizations in the system</CardDescription>
                </div>
                <Dialog open={showCreateOrgDialog} onOpenChange={setShowCreateOrgDialog}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      Create Organization
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Create Organization</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium">Organization Name</label>
                        <Input
                          value={newOrgName}
                          onChange={(e) => setNewOrgName(e.target.value)}
                          placeholder="Acme Corp"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setShowCreateOrgDialog(false)}>Cancel</Button>
                        <Button
                          onClick={() => createOrgMutation.mutate(newOrgName)}
                          disabled={!newOrgName || createOrgMutation.isPending}
                        >
                          Create
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
                    <TableHead>Name</TableHead>
                    <TableHead>Members</TableHead>
                    <TableHead>Domains</TableHead>
                    <TableHead>Emails</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Usage</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {organizations?.map((org) => (
                    <TableRow 
                      key={org.id} 
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setViewingOrg(org)}
                    >
                      <TableCell className="font-medium">{org.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          <Users className="h-3 w-3 mr-1" />
                          {org.organization_members?.[0]?.count || 0}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          <Globe className="h-3 w-3 mr-1" />
                          {org.organization_domains?.[0]?.count || 0}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          <Mail className="h-3 w-3 mr-1" />
                          {org.organization_emails?.[0]?.count || 0}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">{org.plan || "trial"}</Badge>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const used = org.current_month_usage || 0;
                          const limit = org.plan_email_limit || 1000;
                          const pct = limit > 0 ? (used / limit) * 100 : 0;
                          const color = pct >= 90 ? "text-red-600" : pct >= 75 ? "text-yellow-600" : "text-muted-foreground";
                          return <span className={`text-sm ${color}`}>{used} / {limit}</span>;
                        })()}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            org.billing_status === "active" ? "text-green-600 border-green-500/30" :
                            org.billing_status === "past_due" ? "text-yellow-600 border-yellow-500/30" :
                            org.billing_status === "canceled" ? "text-red-600 border-red-500/30" :
                            ""
                          }
                        >
                          {org.billing_status || "trialing"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {format(new Date(org.created_at), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setViewingOrg(org)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedOrgId(org.id);
                              setShowAddUserToOrgDialog(true);
                            }}
                          >
                            <UserPlus className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget({ type: "org", id: org.id, name: org.name })}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Users Tab */}
        <TabsContent value="users">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                All Users
              </CardTitle>
              <CardDescription>{allUsers?.length || 0} users in the system</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Organization</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allUsers?.map((u) => {
                    const membership = allMembers?.find((m) => m.user_id === u.id);
                    return (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                              <span className="text-sm font-medium text-primary">
                                {u.first_name?.[0] || u.email?.[0]?.toUpperCase() || "?"}
                              </span>
                            </div>
                            <div>
                              <p className="font-medium">{u.name || `${u.first_name || ""} ${u.last_name || ""}`.trim() || "No name"}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{u.email}</TableCell>
                        <TableCell>
                          {membership ? (
                            <span className="text-sm">{membership.organizations?.name}</span>
                          ) : (
                            <span className="text-muted-foreground text-sm">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {u.is_super_admin ? (
                            <Badge className="bg-purple-600">Super Admin</Badge>
                          ) : membership?.role === "admin" ? (
                            <Badge variant="default">Admin</Badge>
                          ) : membership ? (
                            <Badge variant="outline">Member</Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(u.created_at), "MMM d, yyyy")}
                        </TableCell>
                        <TableCell>
                          {u.id !== user?.id && (
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Move to organization"
                                onClick={() => {
                                  setMoveTarget({ userId: u.id, userName: u.email, currentOrgId: membership?.organization_id });
                                  setMoveToOrgId(membership?.organization_id || "");
                                  setMoveRole((membership?.role as "admin" | "member") || "member");
                                }}
                              >
                                <ArrowRightLeft className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Delete user"
                                onClick={() => setDeleteTarget({ type: "user", id: u.id, name: u.email })}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Revenue Tab */}
        <TabsContent value="revenue">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Revenue Overview
              </CardTitle>
              <CardDescription>
                {payingOrgsList.length} paying organization{payingOrgsList.length !== 1 ? "s" : ""} &middot; ${stats.monthlyRevenue}/mo
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Next Billing</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {organizations
                    ?.filter((o) => o.plan !== "trial" && o.name?.toLowerCase() !== "my company")
                    .sort((a, b) => (PLAN_PRICES[b.plan] || 0) - (PLAN_PRICES[a.plan] || 0))
                    .map((org) => (
                    <TableRow key={org.id}>
                      <TableCell>
                        <p className="font-medium">{org.name}</p>
                      </TableCell>
                      <TableCell>
                        <Badge variant={org.billing_status === "active" ? "default" : "outline"} className="capitalize">
                          {org.plan}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        ${PLAN_PRICES[org.plan] || 0}/mo
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            org.billing_status === "active"
                              ? "border-green-500/30 text-green-600"
                              : org.billing_status === "past_due"
                              ? "border-yellow-500/30 text-yellow-600"
                              : "border-red-500/30 text-red-600"
                          }
                        >
                          {org.billing_status === "active" ? "Active" : org.billing_status === "past_due" ? "Past Due" : "Canceled"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {org.current_period_end
                          ? format(new Date(org.current_period_end), "MMM d, yyyy")
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {organizations?.filter((o) => o.plan !== "trial" && o.name?.toLowerCase() !== "my company").length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No paying organizations yet
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Organization Details Dialog */}
      <Dialog open={!!viewingOrg} onOpenChange={(open) => !open && setViewingOrg(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building className="h-5 w-5" />
              {viewingOrg?.name}
            </DialogTitle>
          </DialogHeader>
          
          {orgDetails && (
            <div className="space-y-6">
              {/* Stats Summary */}
              <div className="grid grid-cols-4 gap-4">
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold">{orgDetails.members?.length || 0}</p>
                      <p className="text-xs text-muted-foreground">Members</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold">{orgDetails.domains?.length || 0}</p>
                      <p className="text-xs text-muted-foreground">Domains</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-green-600">{orgDetails.stats.totalSent}</p>
                      <p className="text-xs text-muted-foreground">Emails Sent</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 pb-4">
                    <div className="text-center">
                      <p className="text-2xl font-bold text-red-600">{orgDetails.stats.totalFailed}</p>
                      <p className="text-xs text-muted-foreground">Failed</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Plan & Limits */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold flex items-center gap-2">
                    <CreditCard className="h-4 w-4" />
                    Plan & Limits
                  </h3>
                  <div className="flex items-center gap-2">
                    <Badge variant={viewingOrg?.plan === "enterprise" ? "default" : "outline"}>
                      {viewingOrg?.plan || "trial"}
                    </Badge>
                    <Select
                      value={viewingOrg?.plan || "trial"}
                      onValueChange={(plan) => {
                        if (viewingOrg?.id) {
                          setPlanMutation.mutate({ orgId: viewingOrg.id, plan });
                          setViewingOrg({ ...viewingOrg, plan, ...PLAN_CONFIGS[plan] });
                        }
                      }}
                    >
                      <SelectTrigger className="w-32 h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="trial">Trial</SelectItem>
                        <SelectItem value="starter">Starter</SelectItem>
                        <SelectItem value="growth">Growth</SelectItem>
                        <SelectItem value="enterprise">Enterprise</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-3 text-sm">
                  <div className="border rounded-lg p-3">
                    <p className="text-muted-foreground text-xs mb-1">Emails this month</p>
                    <p className="font-medium">{viewingOrg?.current_month_usage || 0} / {viewingOrg?.plan_email_limit || 1000}</p>
                  </div>
                  <div className="border rounded-lg p-3">
                    <p className="text-muted-foreground text-xs mb-1">Members</p>
                    <p className="font-medium">{orgDetails.members?.length || 0} / {viewingOrg?.plan_member_limit || 3}</p>
                  </div>
                  <div className="border rounded-lg p-3">
                    <p className="text-muted-foreground text-xs mb-1">Domains</p>
                    <p className="font-medium">{orgDetails.domains?.length || 0} / {viewingOrg?.plan_domain_limit || 1}</p>
                  </div>
                  <div className="border rounded-lg p-3">
                    <p className="text-muted-foreground text-xs mb-1">Email addresses</p>
                    <p className="font-medium">{orgDetails.emails?.length || 0} / {viewingOrg?.plan_email_address_limit || 2}</p>
                  </div>
                </div>
              </div>

              {/* Members */}
              <div>
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Members
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Emails Sent</TableHead>
                      <TableHead>Failed</TableHead>
                      <TableHead>Joined</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orgDetails.members?.map((member: any) => (
                      <TableRow key={member.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{member.users?.name || member.users?.first_name || "Unknown"}</p>
                            <p className="text-sm text-muted-foreground">{member.users?.email}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={member.role === "admin" ? "default" : "outline"}>
                            {member.role}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-green-600">
                            <Send className="h-3 w-3 mr-1" />
                            {member.emailsSent}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {member.emailsFailed > 0 ? (
                            <Badge variant="outline" className="text-red-600">
                              {member.emailsFailed}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(member.created_at), "MMM d, yyyy")}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Domains */}
              <div>
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  Domains
                </h3>
                {orgDetails.domains?.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No domains configured</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Domain</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Added</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orgDetails.domains?.map((domain: any) => (
                        <TableRow key={domain.id}>
                          <TableCell className="font-mono">{domain.domain}</TableCell>
                          <TableCell>
                            {domain.verified ? (
                              <Badge className="bg-green-500">Verified</Badge>
                            ) : (
                              <Badge variant="outline" className="text-yellow-600">Pending</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {format(new Date(domain.created_at), "MMM d, yyyy")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              {/* Sending Emails */}
              <div>
                <h3 className="font-semibold mb-2 flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Sending Emails
                </h3>
                {orgDetails.emails?.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No emails configured</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Display Name</TableHead>
                        <TableHead>Default</TableHead>
                        <TableHead>Added</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orgDetails.emails?.map((email: any) => (
                        <TableRow key={email.id}>
                          <TableCell className="font-mono">{email.email}</TableCell>
                          <TableCell>{email.display_name || <span className="text-muted-foreground">—</span>}</TableCell>
                          <TableCell>
                            {email.is_default && <Badge>Default</Badge>}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {format(new Date(email.created_at), "MMM d, yyyy")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add User to Org Dialog */}
      <Dialog open={showAddUserToOrgDialog} onOpenChange={setShowAddUserToOrgDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add User to Organization</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">User Email</label>
              <Input
                value={userEmailToAdd}
                onChange={(e) => setUserEmailToAdd(e.target.value)}
                placeholder="user@example.com"
                type="email"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Role</label>
              <Select value={userRoleToAdd} onValueChange={(v: "admin" | "member") => setUserRoleToAdd(v)}>
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
              <Button variant="outline" onClick={() => setShowAddUserToOrgDialog(false)}>Cancel</Button>
              <Button
                onClick={() => selectedOrgId && addUserToOrgMutation.mutate({ 
                  orgId: selectedOrgId, 
                  email: userEmailToAdd, 
                  role: userRoleToAdd 
                })}
                disabled={!userEmailToAdd || !selectedOrgId || addUserToOrgMutation.isPending}
              >
                Add User
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Move User to Org Dialog */}
      <Dialog open={!!moveTarget} onOpenChange={(open) => { if (!open) setMoveTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move User to Organization</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Assign <strong>{moveTarget?.userName}</strong> to an organization. This will remove them from their current org if they have one.
            </p>
            <div>
              <label className="text-sm font-medium">Organization</label>
              <Select value={moveToOrgId} onValueChange={setMoveToOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an organization" />
                </SelectTrigger>
                <SelectContent>
                  {organizations?.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium">Role</label>
              <Select value={moveRole} onValueChange={(v: "admin" | "member") => setMoveRole(v)}>
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
              <Button variant="outline" onClick={() => setMoveTarget(null)}>Cancel</Button>
              <Button
                onClick={() => moveTarget && moveToOrgId && moveUserToOrgMutation.mutate({
                  userId: moveTarget.userId,
                  newOrgId: moveToOrgId,
                  role: moveRole,
                })}
                disabled={!moveToOrgId || moveUserToOrgMutation.isPending}
              >
                {moveUserToOrgMutation.isPending ? "Moving..." : "Move User"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteTarget?.type === "org" ? "Organization" : deleteTarget?.type === "user" ? "User" : "Membership"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? 
              {deleteTarget?.type === "org" && " This will also delete all members, domains, and emails associated with this organization."}
              {deleteTarget?.type === "user" && " This will also remove them from all organizations."}
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-3 justify-end">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate({ type: deleteTarget.type, id: deleteTarget.id })}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}