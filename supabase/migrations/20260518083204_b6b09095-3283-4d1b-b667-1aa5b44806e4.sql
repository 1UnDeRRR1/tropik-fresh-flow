CREATE OR REPLACE FUNCTION public.get_profile_names(_ids uuid[])
RETURNS TABLE(id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.full_name
  FROM public.profiles p
  WHERE p.id = ANY(_ids);
$$;

GRANT EXECUTE ON FUNCTION public.get_profile_names(uuid[]) TO authenticated;