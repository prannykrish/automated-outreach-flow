-- Custom placeholders: user-defined placeholder definitions
CREATE TABLE public.custom_placeholders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.custom_placeholders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own placeholders"
  ON public.custom_placeholders FOR ALL
  USING (auth.uid() = user_id);

-- JSONB column on customers for custom field values
ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}';
