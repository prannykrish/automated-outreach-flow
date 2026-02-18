-- Agent conversations
CREATE TABLE IF NOT EXISTS public.agent_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'New conversation',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Agent messages
CREATE TABLE IF NOT EXISTS public.agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  context_page TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_conversations_org ON public.agent_conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_agent_conversations_user ON public.agent_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_conversation ON public.agent_messages(conversation_id);

-- RLS
ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own conversations"
  ON public.agent_conversations FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own conversations"
  ON public.agent_conversations FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own conversations"
  ON public.agent_conversations FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own conversations"
  ON public.agent_conversations FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "Users can view messages of own conversations"
  ON public.agent_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.agent_conversations
      WHERE agent_conversations.id = agent_messages.conversation_id
      AND agent_conversations.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert messages to own conversations"
  ON public.agent_messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.agent_conversations
      WHERE agent_conversations.id = agent_messages.conversation_id
      AND agent_conversations.user_id = auth.uid()
    )
  );
