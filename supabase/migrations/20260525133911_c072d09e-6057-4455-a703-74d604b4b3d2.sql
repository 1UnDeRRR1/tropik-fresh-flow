ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS display_name text NULL,
  ADD COLUMN IF NOT EXISTS job_title text NULL;