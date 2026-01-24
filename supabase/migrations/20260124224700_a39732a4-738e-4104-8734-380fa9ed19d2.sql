-- Create email templates table
CREATE TABLE public.email_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'initial',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create email sequences table
CREATE TABLE public.email_sequences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create sequence steps table (tree structure)
CREATE TABLE public.sequence_steps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sequence_id UUID NOT NULL REFERENCES public.email_sequences(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.email_templates(id) ON DELETE CASCADE,
  parent_step_id UUID REFERENCES public.sequence_steps(id) ON DELETE SET NULL,
  step_order INTEGER NOT NULL DEFAULT 0,
  delay_days INTEGER NOT NULL DEFAULT 0,
  delay_hours INTEGER NOT NULL DEFAULT 0,
  trigger_type TEXT NOT NULL DEFAULT 'time_based',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create customers table
CREATE TABLE public.customers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  first_name TEXT NOT NULL,
  firm_name TEXT NOT NULL,
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  current_step_id UUID REFERENCES public.sequence_steps(id) ON DELETE SET NULL,
  sequence_id UUID REFERENCES public.email_sequences(id) ON DELETE SET NULL,
  notes TEXT,
  paused BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create email logs table
CREATE TABLE public.email_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.email_templates(id) ON DELETE CASCADE,
  step_id UUID REFERENCES public.sequence_steps(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_at TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create scheduled sends table for queue management
CREATE TABLE public.scheduled_sends (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES public.sequence_steps(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
  processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Add triggers for updated_at
CREATE TRIGGER update_email_templates_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_email_sequences_updated_at
  BEFORE UPDATE ON public.email_sequences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS on all tables (but keep open for now since no auth)
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_sends ENABLE ROW LEVEL SECURITY;

-- Create permissive policies (no auth for now - single user system)
CREATE POLICY "Allow all operations on email_templates" ON public.email_templates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on email_sequences" ON public.email_sequences FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on sequence_steps" ON public.sequence_steps FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on customers" ON public.customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on email_logs" ON public.email_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on scheduled_sends" ON public.scheduled_sends FOR ALL USING (true) WITH CHECK (true);