import { useCallback, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

// ── Persistent stream store (survives component unmounts) ──

type StreamState = {
  isStreaming: boolean;
  content: string;
  statusMessage: string | null;
  abortController: AbortController | null;
};

const streams = new Map<string, StreamState>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function getStream(conversationId: string): StreamState {
  if (!streams.has(conversationId)) {
    streams.set(conversationId, {
      isStreaming: false,
      content: "",
      statusMessage: null,
      abortController: null,
    });
  }
  return streams.get(conversationId)!;
}

function updateStream(conversationId: string, patch: Partial<StreamState>) {
  const current = getStream(conversationId);
  streams.set(conversationId, { ...current, ...patch });
  notify();
}

function getSnapshot() {
  // Return a stable reference — Map itself is the snapshot
  return streams;
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

// ── Hook ──

export function useAgentChat(conversationId: string | null) {
  const { user, session, organizationId } = useAuth();
  const queryClient = useQueryClient();

  // Subscribe to the external store so re-renders happen when stream state changes
  const store = useSyncExternalStore(subscribe, getSnapshot);

  const streamState = conversationId ? store.get(conversationId) : null;
  const isStreaming = streamState?.isStreaming ?? false;
  const streamingContent = streamState?.content ?? "";
  const statusMessage = streamState?.statusMessage ?? null;

  // Load saved messages for the conversation
  const { data: savedMessages } = useQuery({
    queryKey: ["agent-messages", conversationId],
    queryFn: async () => {
      if (!conversationId) return [];
      const { data, error } = await supabase
        .from("agent_messages" as any)
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as ChatMessage[];
    },
    enabled: !!conversationId,
  });

  const messages: ChatMessage[] = savedMessages || [];

  // Create a new conversation
  const createConversation = useCallback(async (title?: string): Promise<string> => {
    const { data, error } = await supabase
      .from("agent_conversations" as any)
      .insert({
        organization_id: organizationId,
        user_id: user?.id,
        title: title || "New conversation",
      })
      .select("id")
      .single();
    if (error) throw error;
    queryClient.invalidateQueries({ queryKey: ["agent-conversations"] });
    return data.id;
  }, [organizationId, user?.id, queryClient]);

  // Send a message — the fetch runs in the module scope, not tied to component lifecycle
  const sendMessage = useCallback(async (
    content: string,
    activeConversationId: string,
    contextPage?: string,
  ) => {
    if (!organizationId || !session) return;

    // Insert user message
    await supabase.from("agent_messages" as any).insert({
      conversation_id: activeConversationId,
      role: "user",
      content,
      context_page: contextPage,
    });

    queryClient.invalidateQueries({ queryKey: ["agent-messages", activeConversationId] });

    // Build messages array for Claude (last 20 messages for context)
    const allMessages = [...messages, { role: "user" as const, content }];
    const claudeMessages = allMessages.slice(-20).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const abortController = new AbortController();
    updateStream(activeConversationId, {
      isStreaming: true,
      content: "",
      statusMessage: null,
      abortController,
    });

    // Run fetch in a detached async — not tied to component lifecycle
    (async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const response = await fetch(`${supabaseUrl}/functions/v1/mora-agent`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${session.access_token}`,
            "apikey": supabaseAnonKey,
          },
          body: JSON.stringify({
            messages: claudeMessages,
            organizationId,
            conversationId: activeConversationId,
            contextPage,
          }),
          signal: abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`Agent request failed: ${response.status}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let accumulated = "";
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (!data) continue;

            try {
              const event = JSON.parse(data);
              if (event.type === "text") {
                accumulated += event.text;
                updateStream(activeConversationId, {
                  content: accumulated,
                  statusMessage: null,
                });
              } else if (event.type === "status") {
                updateStream(activeConversationId, {
                  statusMessage: event.text,
                });
              } else if (event.type === "error") {
                console.error("Agent error:", event.error);
              }
            } catch {}
          }
        }

        // Persist the assistant message
        if (accumulated) {
          await supabase.from("agent_messages" as any).insert({
            conversation_id: activeConversationId,
            role: "assistant",
            content: accumulated,
            context_page: contextPage,
          });

          // Update conversation title if it's the first exchange
          if (messages.length === 0) {
            const title = content.slice(0, 60) + (content.length > 60 ? "..." : "");
            await supabase
              .from("agent_conversations" as any)
              .update({ title, updated_at: new Date().toISOString() })
              .eq("id", activeConversationId);
            queryClient.invalidateQueries({ queryKey: ["agent-conversations"] });
          } else {
            await supabase
              .from("agent_conversations" as any)
              .update({ updated_at: new Date().toISOString() })
              .eq("id", activeConversationId);
          }

          queryClient.invalidateQueries({ queryKey: ["agent-messages", activeConversationId] });
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("Agent stream error:", err);
        }
      } finally {
        updateStream(activeConversationId, {
          isStreaming: false,
          content: "",
          statusMessage: null,
          abortController: null,
        });
      }
    })();
  }, [organizationId, session, messages, queryClient]);

  const stopStreaming = useCallback(() => {
    if (conversationId) {
      const state = streams.get(conversationId);
      state?.abortController?.abort();
    }
  }, [conversationId]);

  return {
    messages,
    isStreaming,
    streamingContent,
    statusMessage,
    sendMessage,
    stopStreaming,
    createConversation,
  };
}
