import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Edit, Trash2, GitBranch, ArrowDown, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Sequences() {
  const [isOpen, setIsOpen] = useState(false);
  const [editingSequence, setEditingSequence] = useState<any>(null);
  const [selectedSequence, setSelectedSequence] = useState<any>(null);
  const [deleteConfirmSequenceId, setDeleteConfirmSequenceId] = useState<string | null>(null);
  const [deleteConfirmStepId, setDeleteConfirmStepId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: "", description: "" });
  const [stepForm, setStepForm] = useState({
    template_id: "",
    delay_days: 0,
    delay_hours: 0,
    trigger_type: "time_based",
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: sequences, isLoading } = useQuery({
    queryKey: ["sequences"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sequences")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: templates } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("email_templates").select("*");
      if (error) throw error;
      return data;
    },
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
      const { error } = await supabase.from("email_sequences").insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sequences"] });
      setIsOpen(false);
      setFormData({ name: "", description: "" });
      toast({ title: "Sequence created successfully" });
    },
    onError: (error) => {
      toast({ title: "Error creating sequence", description: error.message, variant: "destructive" });
    },
  });

  const updateSequenceMutation = useMutation({
    mutationFn: async (data: typeof formData & { id: string }) => {
      const { id, ...rest } = data;
      const { error } = await supabase.from("email_sequences").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sequences"] });
      setIsOpen(false);
      setEditingSequence(null);
      setFormData({ name: "", description: "" });
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

  const handleEditSequence = (sequence: any) => {
    setEditingSequence(sequence);
    setFormData({ name: sequence.name, description: sequence.description || "" });
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
              setFormData({ name: "", description: "" });
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
                    <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">Step {index + 1}</Badge>
                          <span className="font-medium">{step.email_templates?.name}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{step.email_templates?.subject}</p>
                      </div>
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
                ))}

                {/* Add Step Form */}
                <div className="border-t pt-4 space-y-3">
                  <h4 className="text-sm font-medium">Add New Step</h4>
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
                        type="number"
                        min={0}
                        value={stepForm.delay_days}
                        onChange={(e) => setStepForm({ ...stepForm, delay_days: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Delay (Hours)</label>
                      <Input
                        type="number"
                        min={0}
                        max={23}
                        value={stepForm.delay_hours}
                        onChange={(e) => setStepForm({ ...stepForm, delay_hours: parseInt(e.target.value) || 0 })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Trigger Type</label>
                    <Select
                      value={stepForm.trigger_type}
                      onValueChange={(value) => setStepForm({ ...stepForm, trigger_type: value })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="time_based">Time-based (automatic)</SelectItem>
                        <SelectItem value="manual">Manual trigger</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    onClick={() => addStepMutation.mutate()}
                    disabled={!stepForm.template_id}
                    className="w-full"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add Step
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
