
-- 1) Supplier alias (5 uppercase letters, unique)
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS alias text;

CREATE UNIQUE INDEX IF NOT EXISTS suppliers_alias_unique_idx
  ON public.suppliers (alias)
  WHERE alias IS NOT NULL;

ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_alias_format_chk;
ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_alias_format_chk
  CHECK (alias IS NULL OR alias ~ '^[A-Z]{5}$');

-- 2) Per-supplier shipment sequence number
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS supplier_seq integer;

CREATE UNIQUE INDEX IF NOT EXISTS shipments_supplier_seq_unique_idx
  ON public.shipments (supplier_id, supplier_seq)
  WHERE supplier_seq IS NOT NULL;

-- 3) Function to allocate next per-supplier sequence
CREATE OR REPLACE FUNCTION public.next_supplier_sequence(p_supplier_id uuid)
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(MAX(supplier_seq), 0) + 1
  FROM public.shipments
  WHERE supplier_id = p_supplier_id;
$$;
