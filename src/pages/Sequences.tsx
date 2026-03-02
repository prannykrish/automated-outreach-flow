import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Edit, Trash2, GitBranch, ArrowDown, Clock, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useOnboardingContext } from "@/contexts/OnboardingContext";

export default function Sequences() {
  const { user, organizationId: orgId } = useAuth();
  const { completeStep } = useOnboardingContext();
  const [isOpen, setIsOpen] = useState(false);
  const [editingSequence, setEditingSequence] = useState<any>(null);
  const [selectedSequence, setSelectedSequence] = useState<any>(null);
  const [deleteConfirmSequenceId, setDeleteConfirmSequenceId] = useState<string | null>(null);
  const [deleteConfirmStepId, setDeleteConfirmStepId] = useState<string | null>(null);
  const [editingStep, setEditingStep] = useState<any>(null);
  const [formData, setFormData] = useState({ name: "", description: "", organization_email_id: "" });
  const [stepForm, setStepForm] = useState({
    template_id: "",
    delay_days: 0,
    delay_hours: 0,
    trigger_type: "time_based",
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch verified org emails (only from verified domains)
  const { data: orgEmails } = useQuery({
    queryKey: ["org-emails-verified", orgId],
    queryFn: async () => {
      if (!orgId) return [];
      // Get verified domains for this org
      const { data: verifiedDomains } = await supabase
        .from("organization_domains")
        .select("domain")
        .eq("organization_id", orgId)
        .eq("verified", true);

      const domainNames = verifiedDomains?.map((d) => d.domain) || [];
      if (domainNames.length === 0) return [];

      // Get all org emails
      const { data: emails, error } = await supabase
        .from("organization_emails")
        .select("*")
        .eq("organization_id", orgId)
        .order("is_default", { ascending: false });
      if (error) throw error;

      // Filter to only emails from verified domains
      return (emails || []).filter((e) => {
        const emailDomain = e.email.split("@")[1];
        return domainNames.includes(emailDomain);
      });
    },
    enabled: !!orgId,
  });

  const defaultEmailId = orgEmails?.find((e) => e.is_default)?.id || orgEmails?.[0]?.id || "";

  const { data: sequences, isLoading } = useQuery({
    queryKey: ["sequences", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sequences")
        .select("*, organization_emails(*)")
        .eq("organization_id", orgId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });

  const { data: templates } = useQuery({
    queryKey: ["templates", orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .eq("organization_id", orgId!);
      if (error) throw error;
      return data;
    },
    enabled: !!orgId,
  });

  const { data: steps } = useQuery({
    queryKey: ["steps", selectedSequence?.id],
    queryFn: async () => {
      if (!selectedSequence) return [];
      const { data, error } = await supabase
        .from("sequence_steps")
        .select("*, email_templates(*)")
        .eq("sequence_id", selectedSequence.id)
        .order("step_order");
      if (error) throw error;
      return data;
    },
    enabled: !!selectedSequence,
  });

  const createSequenceMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from("email_sequences").insert({
        name: data.name,
        description: data.description || null,
        organization_email_id: data.organization_email_id || null,
        organization_id: orgId || null,
        user_id: user?.id || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sequences"] });
      setIsOpen(false);
      setFormData({ name: "", description: "", organization_email_id: "" });
      toast({ title: "Sequence created successfully" });
      completeStep("create_sequence");
    },
    onError: (error) => {
      toast({ title: "Error creating sequence", description: error.message, variant: "destructive" });
    },
  });

  const updateSequenceMutation = useMutation({
    mutationFn: async (data: typeof formData & { id: string }) => {
      const { id, ...rest } = data;
      const { error } = await supabase
        .from("email_sequences")
        .update({
          name: rest.name,
          description: rest.description || null,
          organization_email_id: rest.organization_email_id || null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sequences"] });
      setIsOpen(false);
      setEditingSequence(null);
      setFormData({ name: "", description: "", organization_email_id: "" });
      toast({ title: "Sequence updated successfully" });
    },
    onError: (error) => {
      toast({ title: "Error updating sequence", description: error.message, variant: "destructive" });
    },
  });

  const deleteSequenceMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("email_sequences").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sequences"] });
      if (selectedSequence) setSelectedSequence(null);
      toast({ title: "Sequence deleted successfully" });
    },
    onError: (error) => {
      toast({ title: "Error deleting sequence", description: error.message, variant: "destructive" });
    },
  });

  const addStepMutation = useMutation({
    mutationFn: async () => {
      const stepOrder = steps?.length || 0;
      const { error } = await supabase.from("sequence_steps").insert({
        sequence_id: selectedSequence.id,
        template_id: stepForm.template_id,
        delay_days: stepForm.delay_days,
        delay_hours: stepForm.delay_hours,
        trigger_type: stepForm.trigger_type,
        step_order: stepOrder,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["steps", selectedSequence?.id] });
      setStepForm({ template_id: "", delay_days: 0, delay_hours: 0, trigger_type: "time_based" });
      toast({ title: "Step added successfully" });
    },
    onError: (error) => {
      toast({ title: "Error adding step", description: error.message, variant: "destructive" });
    },
  });

  const updateStepMutation = useMutation({
    mutationFn: async (data: { id: string; template_id: string; delay_days: number; delay_hours: number; trigger_type: string }) => {
      const { id, ...rest } = data;
      const { error } = await supabase.from("sequence_steps").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["steps", selectedSequence?.id] });
      setEditingStep(null);
      setStepForm({ template_id: "", delay_days: 0, delay_hours: 0, trigger_type: "time_based" });
      toast({ title: "Step updated successfully" });
    },
    onError: (error) => {
      toast({ title: "Error updating step", description: error.message, variant: "destructive" });
    },
  });

  const deleteStepMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("sequence_steps").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["steps", selectedSequence?.id] });
      toast({ title: "Step removed successfully" });
    },
    onError: (error) => {
      toast({ title: "Error removing step", description: error.message, variant: "destructive" });
    },
  });

  const handleEditStep = (step: any) => {
    setEditingStep(step);
    setStepForm({
      template_id: step.template_id,
      delay_days: step.delay_days,
      delay_hours: step.delay_hours || 0,
      trigger_type: step.trigger_type || "time_based",
    });
  };

  const handleStepSubmit = () => {
    if (editingStep) {
      updateStepMutation.mutate({ id: editingStep.id, ...stepForm });
    } else {
      addStepMutation.mutate();
    }
  };

  const cancelEditStep = () => {
    setEditingStep(null);
    setStepForm({ template_id: "", delay_days: 0, delay_hours: 0, trigger_type: "time_based" });
  };

  const handleEditSequence = (sequence: any) => {
    setEditingSequence(sequence);
    setFormData({
      name: sequence.name,
      description: sequence.description || "",
      organization_email_id: sequence.organization_email_id || defaultEmailId,
    });
    setIsOpen(true);
  };

  const handleSubmit = () => {
    if (editingSequence) {
      updateSequenceMutation.mutate({ ...formData, id: editingSequence.id });
    } else {
      createSequenceMutation.mutate(formData);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Email Sequences</h1>
          <p className="text-muted-foreground">Build email sequences with timing and triggers</p>
        </div>
        <Dialog
          open={isOpen}
          onOpenChange={(open) => {
            setIsOpen(open);
            if (!open) {
              setEditingSequence(null);
              setFormData({ name: "", description: "", organization_email_id: "" });
            } else if (!editingSequence) {
              // Opening for new sequence — pre-select default email
              setFormData((f) => ({ ...f, organization_email_id: defaultEmailId }));
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New Sequence
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingSequence ? "Edit Sequence" : "Create New Sequence"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">Sequence Name</label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., SaaS Founders Outreach"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe this sequence..."
                  rows={3}
                />
              </div>
              <div>
                <label className="text-sm font-medium">From Email</label>
                {orgEmails && orgEmails.length > 0 ? (
                  <Select
                    value={formData.organization_email_id}
                    onValueChange={(value) => setFormData({ ...formData, organization_email_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a sending email" />
                    </SelectTrigger>
                    <SelectContent>
                      {orgEmails.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.display_name ? `${e.display_name} <${e.email}>` : e.email}
                          {e.is_default ? " (default)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm text-muted-foreground mt-1">
                    No verified emails available. Add a domain and email in Organization settings first.
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleSubmit} disabled={!formData.name}>
                  {editingSequence ? "Update" : "Create"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Sequences List */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Your Sequences</h2>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="py-4">
                    <div className="h-6 bg-muted rounded w-3/4" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : sequences?.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-8">
                <GitBranch className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground mb-4">No sequences yet</p>
                <Button onClick={() => setIsOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Create Sequence
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {sequences?.map((sequence) => (
                <Card
                  key={sequence.id}
                  className={`cursor-pointer transition-colors ${
                    selectedSequence?.id === sequence.id ? "border-primary bg-accent" : "hover:bg-accent/50"
                  }`}
                  onClick={() => setSelectedSequence(sequence)}
                >
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-medium">{sequence.name}</h3>
                        {sequence.description && (
                          <p className="text-sm text-muted-foreground">{sequence.description}</p>
                        )}
                        {sequence.organization_emails && (
                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {sequence.organization_emails.display_name
                              ? `${sequence.organization_emails.display_name} <${sequence.organization_emails.email}>`
                              : sequence.organization_emails.email}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditSequence(sequence);
                          }}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirmSequenceId(sequence.id);
                          }}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Sequence Builder */}
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">
            {selectedSequence ? `Building: ${selectedSequence.name}` : "Select a Sequence"}
          </h2>
          {selectedSequence ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sequence Steps</CardTitle>
                <CardDescription>Add templates and set delays between emails</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Existing Steps */}
                {steps?.map((step, index) => (
                  <div key={step.id}>
                    {index > 0 && (
                      <div className="flex items-center justify-center my-4">
                        <div className="flex flex-col items-center text-muted-foreground">
                          <ArrowDown className="h-4 w-4" />
                          <div className="flex items-center gap-1 text-xs">
                            <Clock className="h-3 w-3" />
                            <span>
                              Wait {step.delay_days}d {step.delay_hours}h
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                    <div className={`flex items-center justify-between p-3 rounded-lg ${editingStep?.id === step.id ? "bg-primary/10 ring-1 ring-primary" : "bg-muted"}`}>
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">Step {index + 1}</Badge>
                          <span className="font-medium">{step.email_templates?.name}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{step.email_templates?.subject}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditStep(step)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirmStepId(step.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Add / Edit Step Form */}
                <div className="border-t pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-medium">
                      {editingStep ? `Edit Step ${(steps?.findIndex((s) => s.id === editingStep.id) ?? 0) + 1}` : "Add New Step"}
                    </h4>
                    {editingStep && (
                      <Button variant="ghost" size="sm" onClick={cancelEditStep}>
                        Cancel
                      </Button>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Template</label>
                    <Select
                      value={stepForm.template_id}
                      onValueChange={(value) => setStepForm({ ...stepForm, template_id: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a template" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates?.map((template) => (
                          <SelectItem key={template.id} value={template.id}>
                            {template.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Delay (Days)</label>
                      <Input
                        inputMode="numeric"
                        value={stepForm.delay_days}
                        onChange={(e) => setStepForm({ ...stepForm, delay_days: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Delay (Hours)</label>
                      <Input
                        inputMode="numeric"
                        value={stepForm.delay_hours}
                        onChange={(e) => setStepForm({ ...stepForm, delay_hours: Math.min(23, parseInt(e.target.value) || 0) })}
                      />
                    </div>
                  </div>
                  <Button
                    onClick={handleStepSubmit}
                    disabled={!stepForm.template_id}
                    className="w-full"
                  >
                    {editingStep ? (
                      <>
                        <Edit className="mr-2 h-4 w-4" />
                        Update Step
                      </>
                    ) : (
                      <>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Step
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <GitBranch className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Select a sequence to start building</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Delete Sequence Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmSequenceId} onOpenChange={() => setDeleteConfirmSequenceId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Sequence?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The sequence "{sequences?.find(s => s.id === deleteConfirmSequenceId)?.name}" and all its steps will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-3 justify-end">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteSequenceMutation.mutate(deleteConfirmSequenceId!);
                setDeleteConfirmSequenceId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Step Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirmStepId} onOpenChange={() => setDeleteConfirmStepId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Step?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The step will be permanently deleted from the sequence.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-3 justify-end">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteStepMutation.mutate(deleteConfirmStepId!);
                setDeleteConfirmStepId(null);
              }}
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
