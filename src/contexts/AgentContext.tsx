import React, { createContext, useContext, useState } from "react";

type AgentContextValue = {
  isSidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  currentPage: string;
  setCurrentPage: (page: string) => void;
  sidebarConversationId: string | null;
  setSidebarConversationId: (id: string | null) => void;
};

const AgentContext = createContext<AgentContextValue | undefined>(undefined);

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState("/");
  const [sidebarConversationId, setSidebarConversationId] = useState<string | null>(null);

  return (
    <AgentContext.Provider
      value={{
        isSidebarOpen,
        openSidebar: () => setIsSidebarOpen(true),
        closeSidebar: () => setIsSidebarOpen(false),
        toggleSidebar: () => setIsSidebarOpen((v) => !v),
        currentPage,
        setCurrentPage,
        sidebarConversationId,
        setSidebarConversationId,
      }}
    >
      {children}
    </AgentContext.Provider>
  );
};

export const useAgent = () => {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgent must be used within an AgentProvider");
  return ctx;
};
