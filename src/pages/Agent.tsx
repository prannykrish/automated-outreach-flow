import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import MoraIcon from "@/components/MoraIcon";
import { format } from "date-fns";
import AgentChat from "@/components/AgentChat";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export default function Agent() {
  const { user, organizationId } = useAuth();
  const queryClient = useQueryClient();
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const { data: conversations } = useQuery({
    queryKey: ["agent-conversations", organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("agent_conversations" as any)
        .select("*")
        .eq("organization_id", organizationId)
        .eq("user_id", user?.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!organizationId && !!user?.id,
  });

  const handleNewChat = () => {
    setSelectedConversationId(null);
  };

  const handleRename = (conv: any) => {
    setRenameTarget({ id: conv.id, title: conv.title });
    setRenameValue(conv.title);
    setRenameDialogOpen(true);
  };

  const submitRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    await supabase
      .from("agent_conversations" as any)
      .update({ title: renameValue.trim() })
      .eq("id", renameTarget.id);
    queryClient.invalidateQueries({ queryKey: ["agent-conversations"] });
    setRenameDialogOpen(false);
    setRenameTarget(null);
  };

  const handleDelete = async (convId: string) => {
    await supabase
      .from("agent_conversations" as any)
      .delete()
      .eq("id", convId);
    if (selectedConversationId === convId) {
      setSelectedConversationId(null);
    }
    queryClient.invalidateQueries({ queryKey: ["agent-conversations"] });
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Conversation list */}
      <div className="w-56 border-r flex flex-col bg-muted/30">
        <div className="p-3 border-b">
          <Button onClick={handleNewChat} className="w-full rounded-full" size="sm">
            <Plus className="h-4 w-4 mr-2" />
            New Chat
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {conversations?.map((conv: any) => (
              <div
                key={conv.id}
                className={`group relative flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                  selectedConversationId === conv.id
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-accent"
                }`}
                onClick={() => setSelectedConversationId(conv.id)}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium leading-tight">{conv.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {format(new Date(conv.updated_at), "MMM d, h:mm a")}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <button className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-background/80 transition-opacity">
                      <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onClick={() => handleRename(conv)}>
                      <Pencil className="h-4 w-4 mr-2" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => handleDelete(conv.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
            {(!conversations || conversations.length === 0) && (
              <div className="text-center py-8 px-4">
                <MoraIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-xs text-muted-foreground">No conversations yet</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Chat area */}
      <div className="flex-1 min-w-0">
        <AgentChat
          conversationId={selectedConversationId}
          onConversationCreated={setSelectedConversationId}
          variant="full-page"
        />
      </div>

      {/* Rename dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
            <Button onClick={submitRename} disabled={!renameValue.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
