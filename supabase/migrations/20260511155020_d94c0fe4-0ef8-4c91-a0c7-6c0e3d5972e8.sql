ALTER TABLE public.customs_reference DROP CONSTRAINT IF EXISTS customs_reference_active_uniq;
DROP INDEX IF EXISTS public.customs_reference_active_uniq;