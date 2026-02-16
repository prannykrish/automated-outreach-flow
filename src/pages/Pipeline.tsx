import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Search, Filter, Pause, Play, SkipForward, Mail, Clock, Building, Trash2, Eye, MessageSquare, Send, Calendar, CheckCircle, XCircle, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, formatDistanceToNow } from "date-fns";

const STATUSES = [
  { value: "new", label: "New", color: "bg-blue-500" },
  { value: "contacted", label: "Contacted", color: "bg-yellow-500" },
  { value: "responded", label: "Responded", color: "bg-green-500" },
  { value: "meeting_scheduled", label: "Meeting Scheduled", color: "bg-purple-500" },
  { value: "closed_won", label: "Closed Won", color: "bg-emerald-500" },
  { value: "closed_lost", label: "Closed Lost", color: "bg-red-500" },
];

export default function Pipeline() {
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { user, organizationId } = useAuth();

  const { data: customers, isLoading } = useQuery({
    queryKey: ["customers", organizationId ?? "none"],
    queryFn: async () => {
      let query: any = supabase
        .from("customers")
        .select(`
          *,
          email_sequences(name),
          sequence_steps(step_order, email_templates(name))
        `)
        .order("created_at", { ascending: false });

      if (organizationId) {
        query = query.eq("organization_id", organizationId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as any;
    },
    enabled: !!organizationId,
  });

  // Get email logs for selected customer (sent emails)
  const { data: emailLogs } = useQuery({
    queryKey: ["email-logs", selectedCustomer?.id],
    queryFn: async () => {
      if (!selectedCustomer) return [];
      const { data, error } = await supabase
        .from("email_logs")
        .select("*, email_templates(name, subject, body)")
        .eq("customer_id", selectedCustomer.id)
        .order("sent_at", { ascending: true });
      if (error) throw error;
      return data as any;
    },
    enabled: !!selectedCustomer,
  });

  // Get scheduled sends for selected customer (pending emails)
  const { data: scheduledSends } = useQuery({
    queryKey: ["scheduled-sends", selectedCustomer?.id],
    queryFn: async () => {
      if (!selectedCustomer) return [];
      const { data, error } = await supabase
        .from("scheduled_sends")
        .select("*, sequence_steps(step_order, template_id)")
        .eq("customer_id", selectedCustomer.id)
        .eq("status", "pending")
        .order("scheduled_for", { ascending: true });
      if (error) throw error;
      return data as any;
    },
    enabled: !!selectedCustomer,
  });

  // Get sequence steps for skip functionality
  const { data: sequenceSteps } = useQuery({
    queryKey: ["sequence-steps", selectedCustomer?.sequence_id],
    queryFn: async () => {
      if (!selectedCustomer?.sequence_id) return [];
      const { data, error } = await supabase
        .from("sequence_steps")
        .select("*, email_templates(name)")
        .eq("sequence_id", selectedCustomer.sequence_id)
        .order("step_order", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!selectedCustomer?.sequence_id,
  });

  // Get all templates to map IDs to names
  const { data: templates } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("email_templates").select("*");
      if (error) throw error;
      return data as any;
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from("customers").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast({ title: "Status updated" });
    },
    onError: (error) => {
      toast({ title: "Error updating status", description: error.message, variant: "destructive" });
    },
  });

  const togglePauseMutation = useMutation({
    mutationFn: async ({ id, paused }: { id: string; paused: boolean }) => {
      const { error } = await supabase.from("customers").update({ paused }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setSelectedCustomer((prev: any) => prev ? { ...prev, paused: variables.paused } : null);
      toast({ title: variables.paused ? "Sequence paused" : "Sequence resumed" });
    },
    onError: (error) => {
      toast({ title: "Error updating sequence", description: error.message, variant: "destructive" });
    },
  });

  const updateNotesMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const { error } = await supabase.from("customers").update({ notes }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast({ title: "Notes saved" });
    },
    onError: (error) => {
      toast({ title: "Error saving notes", description: error.message, variant: "destructive" });
    },
  });

  const deleteCustomerMutation = useMutation({
    mutationFn: async (id: string) => {
      // Delete scheduled sends first (foreign key constraint)
      await supabase.from("scheduled_sends").delete().eq("customer_id", id);
      // Email logs are preserved for historic stats (customer_id set to NULL via FK ON DELETE SET NULL)
      const { error } = await supabase.from("customers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      setSelectedCustomer(null);
      setDeleteConfirmId(null);
      toast({ title: "Customer removed from pipeline" });
    },
    onError: (error) => {
      toast({ title: "Error deleting customer", description: error.message, variant: "destructive" });
    },
  });

  const skipToNextMutation = useMutation({
    mutationFn: async (customerId: string) => {
      if (!selectedCustomer?.sequence_id || !sequenceSteps) {
        throw new Error("No sequence assigned");
      }

      // Find current step order
      const currentStep = sequenceSteps.find((s) => s.id === selectedCustomer.current_step_id);
      const currentOrder = currentStep?.step_order ?? -1;

      // Find next step
      const nextStep = sequenceSteps.find((s) => s.step_order === currentOrder + 1);

      if (!nextStep) {
        throw new Error("No more steps in sequence");
      }

      // Cancel any pending scheduled sends for this customer
      await supabase
        .from("scheduled_sends")
        .update({ status: "skipped" })
        .eq("customer_id", customerId)
        .eq("status", "pending");

      // Update customer's current step
      const { error: updateError } = await supabase
        .from("customers")
        .update({ current_step_id: nextStep.id })
        .eq("id", customerId);

      if (updateError) throw updateError;

      // Schedule the next email for 5 minutes from now
      const scheduledFor = new Date();
      scheduledFor.setMinutes(scheduledFor.getMinutes() + 5);

      const { error: scheduleError } = await supabase
        .from("scheduled_sends")
        .insert({
          customer_id: customerId,
          step_id: nextStep.id,
          scheduled_for: scheduledFor.toISOString(),
          status: "pending",
        });

      if (scheduleError) throw scheduleError;

      return nextStep;
    },
    onSuccess: (nextStep) => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["scheduled-sends", selectedCustomer?.id] });
      setSelectedCustomer((prev: any) => prev ? { ...prev, current_step_id: nextStep.id } : null);
      toast({ title: "Skipped to next step", description: `Now on: ${nextStep.email_templates?.name}` });
    },
    onError: (error) => {
      toast({ title: "Error skipping step", description: error.message, variant: "destructive" });
    },
  });

  const markEmailRepliedMutation = useMutation({
    mutationFn: async (emailLogId: string) => {
      const { error } = await supabase
        .from("email_logs")
        .update({ replied_at: new Date().toISOString() })
        .eq("id", emailLogId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-logs", selectedCustomer?.id] });
      toast({ title: "Marked as replied" });
    },
    onError: (error) => {
      toast({ title: "Error marking reply", description: error.message, variant: "destructive" });
    },
  });

  const filteredCustomers = customers?.filter((customer: any) => {
    const matchesSearch =
      customer.first_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (customer.last_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.firm_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customer.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || customer.status === statusFilter;
    return matchesSearch && matchesStatus;
  }) || [];

  // Calculate pagination values
  const totalItems = filteredCustomers.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedCustomers = filteredCustomers.slice(startIndex, endIndex);

  // Reset to page 1 when search or filter changes
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setCurrentPage(1);
  };

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    setCurrentPage(1);
  };

  const getStatusBadge = (status: string) => {
    const statusInfo = STATUSES.find((s) => s.value === status);
    return (
      <Badge className={`${statusInfo?.color} text-white`}>
        {statusInfo?.label || status}
      </Badge>
    );
  };

  const getCurrentStep = (customer: any) => {
    if (customer.sequence_steps) {
      return `Step ${(customer.sequence_steps.step_order || 0) + 1}`;
    }
    return "Not assigned";
  };

  // Build combined timeline from email logs and scheduled sends
  const buildTimeline = () => {
    const items: any[] = [];

    // Add sent/failed emails from email_logs
    emailLogs?.forEach((log: any) => {
      items.push({
        id: `log-${log.id}`,
        type: log.status === "sent" ? "sent" : "failed",
        date: new Date(log.sent_at || log.created_at),
        templateName: log.email_templates?.name || "Email",
        subject: log.email_templates?.subject,
        status: log.status,
        openedAt: log.opened_at,
        repliedAt: log.replied_at,
      });
    });

    // Add scheduled sends
    scheduledSends?.forEach((scheduled: any) => {
      const stepTemplate = templates?.find((t: any) => t.id === scheduled.sequence_steps?.template_id);
      items.push({
        id: `scheduled-${scheduled.id}`,
        type: "scheduled",
        date: new Date(scheduled.scheduled_for),
        templateName: stepTemplate?.name || "Email",
        subject: stepTemplate?.subject,
        stepOrder: scheduled.sequence_steps?.step_order,
        status: "pending",
      });
    });

    // Sort by date ascending
    items.sort((a, b) => a.date.getTime() - b.date.getTime());

    return items;
  };

  const timeline = selectedCustomer ? buildTimeline() : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Customer Pipeline</h1>
          <p className="text-muted-foreground">Track and manage your customer acquisition process</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customers..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={handleStatusFilterChange}>
          <SelectTrigger className="w-48">
            <Filter className="mr-2 h-4 w-4" />
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {STATUSES.map((status) => (
              <SelectItem key={status.value} value={status.value}>
                {status.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Customer Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Firm</TableHead>
                <TableHead>Sequence</TableHead>
                <TableHead>Current Stage</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : paginatedCustomers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No customers found
                  </TableCell>
                </TableRow>
              ) : (
                paginatedCustomers.map((customer) => (
                  <TableRow
                    key={customer.id}
                    className="cursor-pointer hover:bg-accent"
                    onClick={() => setSelectedCustomer(customer)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium text-primary">
                            {customer.first_name[0]}
                          </span>
                        </div>
                        <div>
                          <p className="font-medium">{customer.first_name} {customer.last_name}</p>
                          <p className="text-sm text-muted-foreground">{customer.email}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{customer.firm_name}</TableCell>
                    <TableCell>
                      {customer.email_sequences?.name || (
                        <span className="text-muted-foreground">Not assigned</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {customer.paused && (
                          <Badge variant="outline" className="text-yellow-600 border-yellow-600">
                            Paused
                          </Badge>
                        )}
                        {getCurrentStep(customer)}
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(customer.status)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(customer.created_at), "MMM d, yyyy")}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Showing {startIndex + 1} to {Math.min(endIndex, totalItems)} of {totalItems} customers
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }).map((_, i) => (
                <Button
                  key={i + 1}
                  variant={currentPage === i + 1 ? "default" : "outline"}
                  size="sm"
                  onClick={() => setCurrentPage(i + 1)}
                  className="w-10"
                >
                  {i + 1}
                </Button>
              ))}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Customer Detail Dialog */}
      <Dialog open={!!selectedCustomer} onOpenChange={() => setSelectedCustomer(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                  <span className="text-lg font-medium text-primary">
                    {selectedCustomer?.first_name[0]}
                  </span>
                </div>
                <div>
                  <p>{selectedCustomer?.first_name} {selectedCustomer?.last_name}</p>
                  <p className="text-sm font-normal text-muted-foreground">{selectedCustomer?.firm_name}</p>
                </div>
              </div>
            </DialogTitle>
          </DialogHeader>

          {selectedCustomer && (
            <div className="space-y-6">
              {/* Quick Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span>{selectedCustomer.email}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Building className="h-4 w-4 text-muted-foreground" />
                  <span>{selectedCustomer.firm_name}</span>
                </div>
              </div>

              {/* Status Update */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <Select
                  value={selectedCustomer.status}
                  onValueChange={(value) =>
                    updateStatusMutation.mutate({ id: selectedCustomer.id, status: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((status) => (
                      <SelectItem key={status.value} value={status.value}>
                        {status.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Sequence Controls */}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    togglePauseMutation.mutate({
                      id: selectedCustomer.id,
                      paused: !selectedCustomer.paused,
                    })
                  }
                  disabled={togglePauseMutation.isPending}
                >
                  {selectedCustomer.paused ? (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Resume Sequence
                    </>
                  ) : (
                    <>
                      <Pause className="mr-2 h-4 w-4" />
                      Pause Sequence
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => skipToNextMutation.mutate(selectedCustomer.id)}
                  disabled={!selectedCustomer.sequence_id || skipToNextMutation.isPending}
                >
                  <SkipForward className="mr-2 h-4 w-4" />
                  Skip to Next
                </Button>
                <Button
                  variant="outline"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
                  onClick={() => setDeleteConfirmId(selectedCustomer.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Notes</label>
                <Textarea
                  defaultValue={selectedCustomer.notes || ""}
                  placeholder="Add notes about this customer..."
                  rows={3}
                  onBlur={(e) =>
                    updateNotesMutation.mutate({ id: selectedCustomer.id, notes: e.target.value })
                  }
                />
              </div>

              {/* Email Timeline */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium">Email Timeline</h4>
                {timeline.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground">
                    <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">No emails scheduled or sent yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {timeline.map((item) => (
                      <div
                        key={item.id}
                        className={`relative p-4 rounded-lg border ${
                          item.type === "scheduled"
                            ? "bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800"
                            : item.type === "failed"
                            ? "bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800"
                            : "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {/* Icon */}
                          <div
                            className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                              item.type === "scheduled"
                                ? "bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400"
                                : item.type === "failed"
                                ? "bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400"
                                : "bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400"
                            }`}
                          >
                            {item.type === "scheduled" ? (
                              <Calendar className="h-4 w-4" />
                            ) : item.type === "failed" ? (
                              <XCircle className="h-4 w-4" />
                            ) : (
                              <CheckCircle className="h-4 w-4" />
                            )}
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <p className="text-sm font-medium">{item.templateName}</p>
                                {item.subject && (
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    Subject: {item.subject}
                                  </p>
                                )}
                              </div>
                              <Badge
                                variant="outline"
                                className={
                                  item.type === "scheduled"
                                    ? "border-blue-300 text-blue-700 dark:border-blue-600 dark:text-blue-400"
                                    : item.type === "failed"
                                    ? "border-red-300 text-red-700 dark:border-red-600 dark:text-red-400"
                                    : "border-green-300 text-green-700 dark:border-green-600 dark:text-green-400"
                                }
                              >
                                {item.type === "scheduled" ? "Scheduled" : item.status}
                              </Badge>
                            </div>

                            {/* Timestamp */}
                            <div className="mt-2 text-xs text-muted-foreground">
                              {item.type === "scheduled" ? (
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  <span>
                                    {format(item.date, "MMM d, yyyy 'at' h:mm a")}
                                  </span>
                                  <span className="text-blue-600 dark:text-blue-400 ml-1">
                                    ({formatDistanceToNow(item.date, { addSuffix: true })})
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <Send className="h-3 w-3" />
                                  <span>Sent {format(item.date, "MMM d, yyyy 'at' h:mm a")}</span>
                                </div>
                              )}
                            </div>

                            {/* Error message */}
                            {item.type === "failed" && item.errorMessage && (
                              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                                Error: {item.errorMessage}
                              </p>
                            )}

                            {/* Tracking indicators for sent emails */}
                            {item.type === "sent" && (
                              <div className="flex items-center gap-4 mt-2">
                                <div
                                  className={`flex items-center gap-1 text-xs ${
                                    item.openedAt
                                      ? "text-green-600 dark:text-green-400"
                                      : "text-muted-foreground"
                                  }`}
                                >
                                  <Eye className="h-3 w-3" />
                                  {item.openedAt ? (
                                    <span>
                                      Opened {format(new Date(item.openedAt), "MMM d 'at' h:mm a")}
                                    </span>
                                  ) : (
                                    <span>Not opened yet</span>
                                  )}
                                </div>
                                <div
                                  className={`flex items-center gap-1 text-xs ${
                                    item.repliedAt
                                      ? "text-purple-600 dark:text-purple-400"
                                      : "text-muted-foreground"
                                  }`}
                                >
                                  <MessageSquare className="h-3 w-3" />
                                  {item.repliedAt ? (
                                    <span>
                                      Replied {format(new Date(item.repliedAt), "MMM d 'at' h:mm a")}
                                    </span>
                                  ) : (
                                    <span>
                                      No reply
                                      {item.id && item.id.startsWith("log-") && (
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-auto p-0 ml-2 text-xs hover:text-purple-600 dark:hover:text-purple-400"
                                          onClick={() =>
                                            markEmailRepliedMutation.mutate(item.id.replace("log-", ""))
                                          }
                                          disabled={markEmailRepliedMutation.isPending}
                                        >
                                          Mark as Replied
                                        </Button>
                                      )}
                                    </span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Customer Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Customer?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. <strong>{selectedCustomer?.first_name} {selectedCustomer?.last_name}</strong> will be permanently removed from your pipeline along with all their email history and scheduled sends.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-3 justify-end">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteConfirmId) {
                  deleteCustomerMutation.mutate(deleteConfirmId);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete Customer
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}