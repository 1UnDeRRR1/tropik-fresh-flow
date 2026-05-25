-- Phase 2 — Stage 1: schema only (single runtime source for manager↔supplier)

CREATE TABLE IF NOT EXISTS public.manager_supplier_assignments (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.import_managers(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  source_code text,
  created_at timestamptz not null default now(),
  unique (manager_id, supplier_id),
  unique (supplier_id) -- enforce: one runtime manager per supplier
);

ALTER TABLE public.manager_supplier_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "msa staff read"
  ON public.manager_supplier_assignments
  FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY "msa admin all"
  ON public.manager_supplier_assignments
  FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));

-- Derived cache: suppliers.import_manager_id is kept in sync from link table.
-- Link table = source of truth.
CREATE OR REPLACE FUNCTION public.sync_supplier_manager_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    UPDATE public.suppliers SET import_manager_id = NULL WHERE id = OLD.supplier_id;
    RETURN OLD;
  ELSIF (TG_OP = 'UPDATE') THEN
    IF NEW.supplier_id <> OLD.supplier_id THEN
      UPDATE public.suppliers SET import_manager_id = NULL WHERE id = OLD.supplier_id;
    END IF;
    UPDATE public.suppliers SET import_manager_id = NEW.manager_id WHERE id = NEW.supplier_id;
    RETURN NEW;
  ELSE
    UPDATE public.suppliers SET import_manager_id = NEW.manager_id WHERE id = NEW.supplier_id;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_msa_sync_supplier ON public.manager_supplier_assignments;
CREATE TRIGGER trg_msa_sync_supplier
AFTER INSERT OR UPDATE OR DELETE ON public.manager_supplier_assignments
FOR EACH ROW EXECUTE FUNCTION public.sync_supplier_manager_id();

-- Drop legacy 5-letter alias format check so clean reload can leave alias NULL
-- (clean source codes are stored in manager_supplier_assignments.source_code).
ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_alias_format_chk;