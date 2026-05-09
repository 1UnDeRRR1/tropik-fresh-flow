ALTER TABLE public.loading_plan ADD COLUMN IF NOT EXISTS count_existing boolean NOT NULL DEFAULT true;

ALTER PUBLICATION supabase_realtime ADD TABLE public.loading_plan;