CREATE UNIQUE INDEX IF NOT EXISTS import_managers_user_id_uq
ON public.import_managers(user_id)
WHERE user_id IS NOT NULL;