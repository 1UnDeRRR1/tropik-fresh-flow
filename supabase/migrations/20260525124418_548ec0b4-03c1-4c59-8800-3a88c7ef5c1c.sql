-- APPLY A: handle_new_user → profile shell only, no role assignment
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
  ON CONFLICT (id) DO NOTHING;
  -- NOTE: role assignment intentionally removed.
  -- Roles are assigned only later from the approved target list (access reset).
  RETURN NEW;
END;
$function$;