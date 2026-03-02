import React, { createContext, useContext, useState, useCallback } from "react";

type AgentContextValue = {
  isSidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  currentPage: string;
  setCurrentPage: (page: string) => void;
  sidebarConversationId: string | null;
  setSidebarConversationId: (id: string | null) => void;
  isCommandBarOpen: boolean;
  openCommandBar: () => void;
  closeCommandBar: () => void;
  toggleCommandBar: () => void;
  isAgentRunning: boolean;
  agentStatusText: string;
  setAgentRunning: (running: boolean, statusText?: string) => void;
};

const AgentContext = createContext<AgentContextValue | undefined>(undefined);

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState("/");
  const [sidebarConversationId, setSidebarConversationId] = useState<string | null>(null);
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [agentStatusText, setAgentStatusText] = useState("");

  const setAgentRunning = useCallback((running: boolean, statusText?: string) => {
    setIsAgentRunning(running);
    if (statusText !== undefined) setAgentStatusText(statusText);
  }, []);

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
        isCommandBarOpen,
        openCommandBar: () => setIsCommandBarOpen(true),
        closeCommandBar: () => setIsCommandBarOpen(false),
        toggleCommandBar: () => setIsCommandBarOpen((v) => !v),
        isAgentRunning,
        agentStatusText,
        setAgentRunning,
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
