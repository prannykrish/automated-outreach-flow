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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Edit, Trash2, Copy, Eye, Folder, FolderOpen, MoreHorizontal, ChevronDown, Tags } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

const STAGES = [
  { value: "initial", label: "Initial Outreach" },
  { value: "follow_up_1", label: "Follow-up 1" },
  { value: "follow_up_2", label: "Follow-up 2" },
  { value: "follow_up_3", label: "Follow-up 3" },
  { value: "final", label: "Final Follow-up" },
];

const BUILT_IN_PLACEHOLDERS = [
  { category: "Name", items: [
    { label: "First Name", placeholder: "[First Name]", description: "Customer's first name" },
    { label: "Last Name", placeholder: "[Last Name]", description: "Customer's last name" },
    { label: "Full Name", placeholder: "[Full Name]", description: "Customer's full name" },
  ]},
  { category: "Company", items: [
    { label: "Firm Name", placeholder: "[Firm Name]", description: "Company / firm name" },
  ]},
];

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
  const [renameFolderId, setRenameFolderId] = useState<string | null>(null);
  const [renameFolderName, setRenameFolderName] = useState("");
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    subject: "",
    body: "",
    stage: "initial",
  });

  // Custom fields tab
  const [activeTab, setActiveTab] = useState<"templates" | "custom-fields">("templates");
  const [newPlaceholderName, setNewPlaceholderName] = useState("");
  const [newPlaceholderDesc, setNewPlaceholderDesc] = useState("");
  const [deleteConfirmPlaceholderId, setDeleteConfirmPlaceholderId] = useState<string | null>(null);

  // Popover open state per field
  const [subjectPopoverOpen, setSubjectPopoverOpen] = useState(false);
  const [bodyPopoverOpen, setBodyPopoverOpen] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, organizationId } = useAuth();

  const { data: templates, isLoading } = useQuery({
    queryKey: ["templates", organizationId ?? "none"],
    queryFn: async () => {
      let q: any = supabase
        .from("email_templates")
        .select("*")
        .order("created_at", { ascending: false });

      if (organizationId) q = q.eq("organization_id", organizationId);

      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const { data: folders } = useQuery({
    queryKey: ["template-folders", organizationId ?? "none"],
    queryFn: async () => {
      let q: any = supabase
        .from("template_folders")
        .select("*")
        .order("name", { ascending: true });

      if (organizationId) q = q.eq("organization_id", organizationId);

      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const { data: customPlaceholders } = useQuery({
    queryKey: ["custom-placeholders", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("custom_placeholders")
        .select("*")
        .eq("organization_id", organizationId!)
        .order("name", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!organizationId,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from("email_templates").insert({ ...data, user_id: user?.id ?? null, organization_id: organizationId ?? null });
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
      const { error } = await supabase.from("template_folders").insert({ name, user_id: user?.id ?? null, organization_id: organizationId ?? null });
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

  const renameFolderMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from("template_folders").update({ name }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["template-folders"] });
      setRenameFolderId(null);
      setRenameFolderName("");
      toast({ title: "Folder renamed" });
    },
    onError: (error) => {
      toast({ title: "Error renaming folder", description: error.message, variant: "destructive" });
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
        user_id: user?.id ?? null,
        organization_id: organizationId ?? null,
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

  const createPlaceholderMutation = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const { error } = await supabase.from("custom_placeholders").insert({
        name,
        description: description || null,
        user_id: user?.id ?? null,
        organization_id: organizationId ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-placeholders"] });
      setNewPlaceholderName("");
      setNewPlaceholderDesc("");
      toast({ title: "Custom placeholder created" });
    },
    onError: (error) => {
      toast({ title: "Error creating placeholder", description: error.message, variant: "destructive" });
    },
  });

  const deletePlaceholderMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("custom_placeholders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-placeholders"] });
      setDeleteConfirmPlaceholderId(null);
      toast({ title: "Placeholder deleted" });
    },
    onError: (error) => {
      toast({ title: "Error deleting placeholder", description: error.message, variant: "destructive" });
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

  const getPreviewContent = (text: string) => {
    let result = text
      .replace(/\[First Name\]/g, "John")
      .replace(/\[Last Name\]/g, "Doe")
      .replace(/\[Full Name\]/g, "John Doe")
      .replace(/\[Firm Name\]/g, "Acme Corp");
    // Replace custom placeholders with their name as sample value
    if (customPlaceholders) {
      for (const cp of customPlaceholders) {
        result = result.replace(new RegExp(`\\[${cp.name}\\]`, "g"), `{${cp.name}}`);
      }
    }
    return result;
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

  // Placeholder picker popover content
  const PlaceholderPickerContent = ({ field, onClose }: { field: "subject" | "body"; onClose: () => void }) => (
    <div
      className="h-64 overflow-auto pr-2"
      onWheel={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ touchAction: "pan-y" }}
    >
      <div className="space-y-3">
        {BUILT_IN_PLACEHOLDERS.map((category) => (
          <div key={category.category}>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{category.category}</p>
            {category.items.map((item) => (
              <button
                key={item.placeholder}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-muted transition-colors flex items-center justify-between group"
                onClick={() => {
                  insertPlaceholder(item.placeholder, field);
                  onClose();
                }}
              >
                <span className="text-sm font-medium">{item.label}</span>
                <code className="text-xs text-muted-foreground group-hover:text-primary">{item.placeholder}</code>
              </button>
            ))}
          </div>
        ))}
        {customPlaceholders && customPlaceholders.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Custom</p>
            {customPlaceholders.map((cp) => (
              <button
                key={cp.id}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-muted transition-colors flex items-center justify-between group"
                onClick={() => {
                  insertPlaceholder(`[${cp.name}]`, field);
                  onClose();
                }}
              >
                <span className="text-sm font-medium">{cp.name}</span>
                <code className="text-xs text-muted-foreground group-hover:text-primary">[{cp.name}]</code>
              </button>
            ))}
          </div>
        )}
        {(!customPlaceholders || customPlaceholders.length === 0) && (
          <p className="text-xs text-muted-foreground px-2 pt-1">
            No custom placeholders yet. Create them in the Custom Fields tab.
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Email Templates</h1>
          <p className="text-muted-foreground">Create and manage your email templates with placeholders</p>
        </div>
        <div className="flex gap-2">
          {activeTab === "templates" && (
            <>
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
                          <Popover open={subjectPopoverOpen} onOpenChange={setSubjectPopoverOpen}>
                            <PopoverTrigger asChild>
                              <Button variant="outline" size="sm">
                                Insert Placeholder
                                <ChevronDown className="ml-1 h-3 w-3" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-64 p-3 max-h-72 overflow-y-auto">
                              <PlaceholderPickerContent field="subject" onClose={() => setSubjectPopoverOpen(false)} />
                            </PopoverContent>
                          </Popover>
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
                        <Popover open={bodyPopoverOpen} onOpenChange={setBodyPopoverOpen}>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm">
                              Insert Placeholder
                              <ChevronDown className="ml-1 h-3 w-3" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-64 p-3 max-h-72 overflow-y-auto">
                            <PlaceholderPickerContent field="body" onClose={() => setBodyPopoverOpen(false)} />
                          </PopoverContent>
                        </Popover>
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
            </>
          )}
        </div>
      </div>

      {/* Tab switcher: Templates | Custom Fields */}
      <div className="flex gap-2 border-b pb-2">
        <button
          onClick={() => setActiveTab("templates")}
          className={`px-4 py-2 rounded-t-lg font-medium transition-colors ${
            activeTab === "templates"
              ? "bg-primary text-primary-foreground"
              : "bg-muted hover:bg-muted/80"
          }`}
        >
          Templates
        </button>
        <button
          onClick={() => setActiveTab("custom-fields")}
          className={`px-4 py-2 rounded-t-lg font-medium transition-colors flex items-center gap-2 ${
            activeTab === "custom-fields"
              ? "bg-primary text-primary-foreground"
              : "bg-muted hover:bg-muted/80"
          }`}
        >
          <Tags className="h-4 w-4" />
          Custom Fields
        </button>
      </div>

      {activeTab === "custom-fields" ? (
        /* ===================== CUSTOM FIELDS VIEW ===================== */
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Create Custom Placeholder</CardTitle>
              <CardDescription>Define a custom field that you can insert into any template</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <label className="text-sm font-medium">Placeholder Name</label>
                  <Input
                    value={newPlaceholderName}
                    onChange={(e) => setNewPlaceholderName(e.target.value.replace(/[\[\]]/g, ""))}
                    placeholder="e.g., Industry, Role, City"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-sm font-medium">Description (optional)</label>
                  <Input
                    value={newPlaceholderDesc}
                    onChange={(e) => setNewPlaceholderDesc(e.target.value)}
                    placeholder="e.g., The customer's industry"
                  />
                </div>
                <Button
                  onClick={() => createPlaceholderMutation.mutate({ name: newPlaceholderName.trim(), description: newPlaceholderDesc.trim() })}
                  disabled={!newPlaceholderName.trim() || createPlaceholderMutation.isPending}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add
                </Button>
              </div>
              {newPlaceholderName.trim() && (
                <p className="text-xs text-muted-foreground mt-2">
                  This will create the placeholder: <code className="text-primary">[{newPlaceholderName.trim()}]</code>
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Your Placeholders</CardTitle>
              <CardDescription>
                These are available in the "Insert Placeholder" menu when editing templates.
                Values are populated from customer data (CSV import or manual entry).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Built-in placeholders */}
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Built-in</h4>
                <div className="grid gap-2 md:grid-cols-2">
                  {BUILT_IN_PLACEHOLDERS.flatMap((cat) => cat.items).map((item) => (
                    <div key={item.placeholder} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div>
                        <code className="text-primary font-mono text-sm">{item.placeholder}</code>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Custom placeholders */}
              <div>
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Custom</h4>
                {customPlaceholders && customPlaceholders.length > 0 ? (
                  <div className="grid gap-2 md:grid-cols-2">
                    {customPlaceholders.map((cp) => (
                      <div key={cp.id} className="flex items-center justify-between p-3 bg-muted rounded-lg group">
                        <div>
                          <code className="text-primary font-mono text-sm">[{cp.name}]</code>
                          {cp.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{cp.description}</p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                          onClick={() => setDeleteConfirmPlaceholderId(cp.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No custom placeholders yet. Create one above to get started.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>How Custom Fields Work</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>1. Create a custom placeholder above (e.g., "Industry")</p>
              <p>2. When editing a template, click "Insert Placeholder" and select it</p>
              <p>3. When importing customers via CSV, include a column with the same name (e.g., "Industry") — the values will automatically map to the placeholder</p>
            </CardContent>
          </Card>
        </div>
      ) : (
        /* ===================== TEMPLATES VIEW ===================== */
        <>
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
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        className="absolute -top-2 -right-2 z-20 h-5 w-5 p-0 opacity-0 group-hover:opacity-100 rounded-full flex items-center justify-center bg-popover border border-border"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => {
                        setRenameFolderId(folder.id);
                        setRenameFolderName(folder.name);
                      }}>
                        <Edit className="h-4 w-4 mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => setDeleteFolderId(folder.id)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
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

          <Card>
            <CardHeader>
              <CardTitle>Placeholder Guide</CardTitle>
              <CardDescription>These placeholders will be replaced with customer data when emails are sent</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {BUILT_IN_PLACEHOLDERS.flatMap((cat) => cat.items).map((item) => (
                  <div key={item.placeholder} className="p-4 bg-muted rounded-lg">
                    <code className="text-primary font-mono">{item.placeholder}</code>
                    <p className="text-sm text-muted-foreground mt-1">{item.description}</p>
                  </div>
                ))}
                {customPlaceholders?.map((cp) => (
                  <div key={cp.id} className="p-4 bg-muted rounded-lg">
                    <code className="text-primary font-mono">[{cp.name}]</code>
                    <p className="text-sm text-muted-foreground mt-1">{cp.description || "Custom field"}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={!!previewTemplate} onOpenChange={() => setPreviewTemplate(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Preview: {previewTemplate?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {previewTemplate?.stage === "initial" && previewTemplate?.subject && (
              <div>
                <label className="text-sm font-medium text-muted-foreground">Subject</label>
                <p className="text-lg">{previewTemplate && getPreviewContent(previewTemplate.subject)}</p>
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

      <Dialog open={!!renameFolderId} onOpenChange={() => setRenameFolderId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input
              value={renameFolderName}
              onChange={(e) => setRenameFolderName(e.target.value)}
              placeholder="Folder name"
              onKeyDown={(e) => {
                if (e.key === "Enter" && renameFolderName.trim() && renameFolderId) {
                  renameFolderMutation.mutate({ id: renameFolderId, name: renameFolderName.trim() });
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRenameFolderId(null)}>Cancel</Button>
              <Button
                onClick={() => renameFolderMutation.mutate({ id: renameFolderId!, name: renameFolderName.trim() })}
                disabled={!renameFolderName.trim() || renameFolderMutation.isPending}
              >
                Rename
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteConfirmPlaceholderId} onOpenChange={() => setDeleteConfirmPlaceholderId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Custom Placeholder?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the placeholder. Any templates using it will keep the placeholder text but it won't be replaced with data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-3 justify-end">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                deletePlaceholderMutation.mutate(deleteConfirmPlaceholderId!);
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
