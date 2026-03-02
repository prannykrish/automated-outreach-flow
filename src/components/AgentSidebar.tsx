import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import MoraIcon from "@/components/MoraIcon";
import { useAgent } from "@/contexts/AgentContext";
import AgentChat from "@/components/AgentChat";

export default function AgentSidebar() {
  const { isSidebarOpen, closeSidebar, sidebarConversationId, setSidebarConversationId } = useAgent();

  return (
    <Sheet open={isSidebarOpen} onOpenChange={(open) => !open && closeSidebar()}>
      <SheetContent side="right" className="w-[440px] sm:w-[480px] p-0 flex flex-col">
        <SheetHeader className="p-4 border-b shrink-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <MoraIcon className="h-5 w-5" />
            Mora Agent
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 min-h-0">
          <AgentChat
            conversationId={sidebarConversationId}
            onConversationCreated={setSidebarConversationId}
            variant="sidebar"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
