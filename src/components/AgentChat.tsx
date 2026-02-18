import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Square, Bot, User, Loader2 } from "lucide-react";
import { useAgentChat, ChatMessage } from "@/hooks/useAgentChat";
import { useAgent } from "@/contexts/AgentContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface AgentChatProps {
  conversationId: string | null;
  onConversationCreated?: (id: string) => void;
  variant: "full-page" | "sidebar";
}

const SUGGESTED_PROMPTS = [
  "How are my email sequences performing?",
  "Review my templates and suggest improvements",
  "Which customers haven't been contacted yet?",
  "Help me write a cold outreach email",
];

export default function AgentChat({ conversationId, onConversationCreated, variant }: AgentChatProps) {
  const { currentPage } = useAgent();
  const {
    messages,
    isStreaming,
    streamingContent,
    statusMessage,
    sendMessage,
    stopStreaming,
    createConversation,
  } = useAgentChat(conversationId);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages or streaming content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");

    let activeId = conversationId;
    if (!activeId) {
      activeId = await createConversation(text.slice(0, 60));
      onConversationCreated?.(activeId);
    }

    await sendMessage(text, activeId, currentPage);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestedPrompt = (prompt: string) => {
    setInput(prompt);
    // Focus the textarea
    textareaRef.current?.focus();
  };

  const isSidebar = variant === "sidebar";

  return (
    <div className={`flex flex-col ${isSidebar ? "h-[calc(100vh-65px)]" : "h-full"}`}>
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-lg font-semibold mb-1">Ask Mora anything</h3>
            <p className="text-sm text-muted-foreground mb-6 max-w-sm">
              I can analyze your templates, sequences, pipeline, and help you write better outreach emails.
            </p>
            <div className="grid gap-2 w-full max-w-sm">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => handleSuggestedPrompt(prompt)}
                  className="text-left text-sm px-4 py-3 rounded-lg border hover:bg-accent transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming message */}
        {isStreaming && (
          <div className="flex gap-3">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              {statusMessage && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {statusMessage}
                </div>
              )}
              {streamingContent ? (
                <div className="prose prose-sm dark:prose-invert max-w-none
                  [&>h2]:text-base [&>h2]:font-semibold [&>h2]:mt-5 [&>h2]:mb-2
                  [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:mt-4 [&>h3]:mb-1.5
                  [&>h4]:text-sm [&>h4]:font-medium [&>h4]:mt-3 [&>h4]:mb-1
                  [&>ul]:my-2 [&>ul]:space-y-1
                  [&>ol]:my-2 [&>ol]:space-y-1
                  [&>hr]:my-4 [&>hr]:border-border
                  [&>blockquote]:border-l-2 [&>blockquote]:border-primary/40 [&>blockquote]:pl-3 [&>blockquote]:italic [&>blockquote]:text-muted-foreground
                  [&>p]:leading-relaxed [&>p]:my-3
                  [&_strong]:font-semibold
                  [&_table]:w-full [&_table]:text-left [&_table]:border-collapse [&_table]:my-3
                  [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-1.5 [&_th]:bg-muted [&_th]:font-medium [&_th]:text-xs
                  [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_td]:text-xs
                ">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                  <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5" />
                </div>
              ) : !statusMessage ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Thinking...
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="p-4 pt-2">
        <div className="flex gap-2 items-end">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Mora..."
            className="min-h-[44px] max-h-[120px] resize-none rounded-2xl border-muted-foreground/20 px-4 py-3"
            rows={1}
          />
          {isStreaming ? (
            <Button variant="outline" size="icon" onClick={stopStreaming} className="shrink-0 h-[44px] w-[44px] rounded-full">
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={handleSend} disabled={!input.trim()} className="shrink-0 h-[44px] w-[44px] rounded-full">
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
        isUser ? "bg-foreground/10" : "bg-primary/10"
      }`}>
        {isUser ? (
          <User className="h-4 w-4 text-foreground/70" />
        ) : (
          <Bot className="h-4 w-4 text-primary" />
        )}
      </div>
      <div className={`flex-1 min-w-0 ${isUser ? "text-right" : ""}`}>
        {isUser ? (
          <div className="inline-block text-sm rounded-lg px-4 py-2.5 max-w-[85%] bg-primary text-primary-foreground">
            <div className="prose prose-sm prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          </div>
        ) : (
          <div className="text-sm max-w-[90%]">
            <div className="prose prose-sm dark:prose-invert max-w-none
              [&>*:first-child]:mt-0 [&>*:last-child]:mb-0
              [&>h2]:text-base [&>h2]:font-semibold [&>h2]:mt-5 [&>h2]:mb-2
              [&>h3]:text-sm [&>h3]:font-semibold [&>h3]:mt-4 [&>h3]:mb-1.5
              [&>h4]:text-sm [&>h4]:font-medium [&>h4]:mt-3 [&>h4]:mb-1
              [&>ul]:my-2 [&>ul]:space-y-1
              [&>ol]:my-2 [&>ol]:space-y-1
              [&>hr]:my-4 [&>hr]:border-border
              [&>blockquote]:border-l-2 [&>blockquote]:border-primary/40 [&>blockquote]:pl-3 [&>blockquote]:italic [&>blockquote]:text-muted-foreground
              [&>p]:leading-relaxed [&>p]:my-3
              [&_strong]:font-semibold
              [&_table]:w-full [&_table]:text-left [&_table]:border-collapse [&_table]:my-3
              [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-1.5 [&_th]:bg-muted [&_th]:font-medium [&_th]:text-xs
              [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_td]:text-xs
            ">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
