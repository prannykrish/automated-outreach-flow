-- Add parent_folder_id to support nested folders
ALTER TABLE public.template_folders
ADD COLUMN IF NOT EXISTS parent_folder_id UUID REFERENCES public.template_folders(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_template_folders_parent ON public.template_folders(parent_folder_id);
