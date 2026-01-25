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
import { Plus, Edit, Trash2, Copy, Eye, Folder, FolderOpen, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const STAGES = [
  { value: "initial", label: "Initial Outreach" },
  { value: "follow_up_1", label: "Follow-up 1" },
  { value: "follow_up_2", label: "Follow-up 2" },
  { value: "follow_up_3", label: "Follow-up 3" },
  { value: "final", label: "Final Follow-up" },
];

const PLACEHOLDERS = ["[First Name]", "[Firm Name]", "[Custom Field]"];

export default function Templates() {
  const [isOpen, setIsOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [previewTemplate, setPreviewTemplate] = useState<any>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [draggedTemplate, setDraggedTemplate] = useState<any>(null);
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    subject: "",
    body: "",
    stage: "initial",
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: templates, isLoading } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: folders } = useQuery({
    queryKey: ["template-folders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("template_folders")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from("email_templates").insert(data);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      setIsOpen(false);
      resetForm();
      toast({ title: "Template created successfully" });
    },
    onError: (error) => {
      toast({ title: "Error creating template", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: typeof formData & { id: string }) => {
      const { id, ...rest } = data;
      const { error } = await supabase.from("email_templates").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      setIsOpen(false);
      setEditingTemplate(null);
      resetForm();
      toast({ title: "Template updated successfully" });
    },
    onError: (error) => {
      toast({ title: "Error updating template", description: error.message, variant: "destructive" });
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from("template_folders").insert({ name });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template-folders"] });
      setShowCreateFolder(false);
      setNewFolderName("");
      toast({ title: "Folder created successfully" });
    },
    onError: (error) => {
      toast({ title: "Error creating folder", description: error.message, variant: "destructive" });
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("template_folders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template-folders"] });
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      setDeleteFolderId(null);
      if (selectedFolder === deleteFolderId) {
        setSelectedFolder(null);
      }
      toast({ title: "Folder deleted successfully" });
    },
    onError: (error) => {
      toast({ title: "Error deleting folder", description: error.message, variant: "destructive" });
    },
  });

  const updateTemplateFolderMutation = useMutation({
    mutationFn: async ({ templateId, folderId }: { templateId: string; folderId: string | null }) => {
      const { error } = await supabase
        .from("email_templates")
        .update({ folder_id: folderId })
        .eq("id", templateId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (error) => {
      toast({ title: "Error moving template", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("email_templates").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast({ title: "Template deleted successfully" });
    },
    onError: (error) => {
      toast({ title: "Error deleting template", description: error.message, variant: "destructive" });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (template: any) => {
      const { error } = await supabase.from("email_templates").insert({
        name: `${template.name} (Copy)`,
        subject: template.subject,
        body: template.body,
        stage: template.stage,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["templates"] });
      toast({ title: "Template duplicated successfully" });
    },
    onError: (error) => {
      toast({ title: "Error duplicating template", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setFormData({ name: "", subject: "", body: "", stage: "initial" });
  };

  const handleEdit = (template: any) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      subject: template.subject,
      body: template.body,
      stage: template.stage,
    });
    setIsOpen(true);
  };

  const handleSubmit = () => {
    if (editingTemplate) {
      updateMutation.mutate({ ...formData, id: editingTemplate.id });
    } else {
      createMutation.mutate(formData);
    }
  };

  const insertPlaceholder = (placeholder: string, field: "subject" | "body" = "body") => {
    setFormData((prev) => ({
      ...prev,
      [field]: prev[field] + placeholder,
    }));
  };

  const getPreviewContent = (body: string) => {
    return body
      .replace(/\[First Name\]/g, "John")
      .replace(/\[Firm Name\]/g, "Acme Corp")
      .replace(/\[Custom Field\]/g, "Custom Value");
  };

  const getStageBadgeVariant = (stage: string) => {
    switch (stage) {
      case "initial":
        return "default";
      case "follow_up_1":
      case "follow_up_2":
      case "follow_up_3":
        return "secondary";
      case "final":
        return "outline";
      default:
        return "default";
    }
  };

  // Check if subject is required (only for initial outreach)
  const isSubjectRequired = formData.stage === "initial";
  
  // Validation: name and body always required, subject only for initial
  const isFormValid = formData.name && formData.body && (isSubjectRequired ? formData.subject : true);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Email Templates</h1>
          <p className="text-muted-foreground">Create and manage your email templates with placeholders</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={showCreateFolder} onOpenChange={setShowCreateFolder}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Folder className="mr-2 h-4 w-4" />
                New Folder
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Folder</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Folder Name</label>
                  <Input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="e.g., Cold Outreach"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setShowCreateFolder(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => createFolderMutation.mutate(newFolderName)}
                    disabled={!newFolderName || createFolderMutation.isPending}
                  >
                    Create Folder
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog
            open={isOpen}
            onOpenChange={(open) => {
              setIsOpen(open);
              if (!open) {
                setEditingTemplate(null);
                resetForm();
              }
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Template
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{editingTemplate ? "Edit Template" : "Create New Template"}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Template Name</label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Initial Cold Outreach"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Stage</label>
                  <Select value={formData.stage} onValueChange={(value) => setFormData({ ...formData, stage: value })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGES.map((stage) => (
                        <SelectItem key={stage.value} value={stage.value}>
                          {stage.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {formData.stage === "initial" && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-sm font-medium">Subject Line</label>
                      <div className="flex gap-1">
                        {PLACEHOLDERS.map((placeholder) => (
                          <Button
                            key={placeholder}
                            variant="outline"
                            size="sm"
                            onClick={() => insertPlaceholder(placeholder, "subject")}
                          >
                            {placeholder}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <Input
                      value={formData.subject}
                      onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                      placeholder="e.g., Quick question about [Firm Name]"
                    />
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm font-medium">Email Body</label>
                    <div className="flex gap-1">
                      {PLACEHOLDERS.map((placeholder) => (
                        <Button
                          key={placeholder}
                          variant="outline"
                          size="sm"
                          onClick={() => insertPlaceholder(placeholder)}
                        >
                          {placeholder}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Textarea
                    value={formData.body}
                    onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                    placeholder="Hi [First Name],&#10;&#10;I hope this message finds you well..."
                    rows={10}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setIsOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} disabled={!isFormValid}>
                    {editingTemplate ? "Update Template" : "Create Template"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {folders && folders.length > 0 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          <button
            onClick={() => setSelectedFolder(null)}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              selectedFolder === null
                ? "bg-primary text-primary-foreground"
                : "bg-muted hover:bg-muted/80"
            }`}
          >
            All
          </button>
          {folders?.map((folder) => (
            <div
              key={folder.id}
              className="relative group"
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverFolderId(folder.id);
              }}
              onDragLeave={() => {
                setDragOverFolderId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverFolderId(null);

                if (draggedTemplate) {
                  updateTemplateFolderMutation.mutate({
                    templateId: draggedTemplate.id,
                    folderId: folder.id,
                  });
                  setDraggedTemplate(null);
                }
              }}
            >
              <button
                onClick={() => setSelectedFolder(folder.id)}
                className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
                  dragOverFolderId === folder.id ? "ring-2 ring-primary scale-105" : ""
                } ${
                  selectedFolder === folder.id
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted hover:bg-muted/80"
                }`}
              >
                {selectedFolder === folder.id ? (
                  <FolderOpen className="h-4 w-4" />
                ) : (
                  <Folder className="h-4 w-4" />
                )}
                {folder.name}
                <span className="text-xs opacity-75">
                  ({templates?.filter((t) => t.folder_id === folder.id).length || 0})
                </span>
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full w-6 p-0 opacity-0 group-hover:opacity-100 rounded-none rounded-r-lg"
                onClick={() => setDeleteFolderId(folder.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="w-full">
        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="h-6 bg-muted rounded w-3/4" />
                  <div className="h-4 bg-muted rounded w-1/2 mt-2" />
                </CardHeader>
                <CardContent>
                  <div className="h-20 bg-muted rounded" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
        <div className="lg:col-span-3">
          {(() => {
            const filteredTemplates = selectedFolder === null 
              ? templates 
              : templates?.filter((t) => t.folder_id === selectedFolder) || [];
            
            return filteredTemplates?.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <p className="text-muted-foreground mb-4">
                    {selectedFolder ? "No templates in this folder yet." : "No templates yet. Create your first one!"}
                  </p>
                  <Button onClick={() => setIsOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Template
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div 
                className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.opacity = "0.5";
                }}
                onDragLeave={(e) => {
                  e.currentTarget.style.opacity = "1";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.opacity = "1";
                  
                  if (draggedTemplate) {
                    updateTemplateFolderMutation.mutate({
                      templateId: draggedTemplate.id,
                      folderId: selectedFolder,
                    });
                    setDraggedTemplate(null);
                  }
                }}
              >
                {filteredTemplates?.map((template) => (
                  <Card
                    key={template.id}
                    className="group cursor-move hover:shadow-lg transition-shadow"
                    draggable
                    onDragStart={() => setDraggedTemplate(template)}
                    onDragEnd={() => setDraggedTemplate(null)}
                  >
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-lg">{template.name}</CardTitle>
                          {template.stage === "initial" && template.subject && (
                            <CardDescription className="mt-1">{template.subject}</CardDescription>
                          )}
                        </div>
                        <Badge variant={getStageBadgeVariant(template.stage)}>
                          {STAGES.find((s) => s.value === template.stage)?.label || template.stage}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground line-clamp-3 mb-4">{template.body}</p>
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="sm" onClick={() => setPreviewTemplate(template)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleEdit(template)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => duplicateMutation.mutate(template)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteConfirmId(template.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </div>

      <Dialog open={!!previewTemplate} onOpenChange={() => setPreviewTemplate(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preview: {previewTemplate?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {previewTemplate?.stage === "initial" && previewTemplate?.subject && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Subject</label>
                <p className="text-lg">{previewTemplate?.subject.replace(/\[First Name\]/g, "John").replace(/\[Firm Name\]/g, "Acme Corp")}</p>
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-muted-foreground">Body (with sample data)</label>
              <div className="mt-2 p-4 bg-muted rounded-lg whitespace-pre-wrap">
                {previewTemplate && getPreviewContent(previewTemplate.body)}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The template "{templates?.find(t => t.id === deleteConfirmId)?.name}" will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-3 justify-end">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteMutation.mutate(deleteConfirmId!);
                setDeleteConfirmId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteFolderId} onOpenChange={() => setDeleteFolderId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Folder?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. The folder "{folders?.find(f => f.id === deleteFolderId)?.name}" will be permanently deleted. Templates in this folder will no longer be organized.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-3 justify-end">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deleteFolderMutation.mutate(deleteFolderId!);
                setDeleteFolderId(null);
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