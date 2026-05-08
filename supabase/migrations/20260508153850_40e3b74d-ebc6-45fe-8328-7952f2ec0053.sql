
WITH ranked AS (
  SELECT id, name,
    row_number() OVER (PARTITION BY lower(name) ORDER BY created_at ASC) AS rn
  FROM public.branches
)
DELETE FROM public.branches b
USING ranked r
WHERE b.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS branches_name_unique_ci
  ON public.branches (lower(name));
