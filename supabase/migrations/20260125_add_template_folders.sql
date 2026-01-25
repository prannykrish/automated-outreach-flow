-- Create template folders table
CREATE TABLE public.template_folders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add folder_id column to email_templates table
ALTER TABLE public.email_templates
ADD COLUMN folder_id UUID REFERENCES public.template_folders(id) ON DELETE SET NULL;

-- Add trigger for template_folders updated_at
CREATE TRIGGER update_template_folders_updated_at
  BEFORE UPDATE ON public.template_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable RLS on template_folders table
ALTER TABLE public.template_folders ENABLE ROW LEVEL SECURITY;
