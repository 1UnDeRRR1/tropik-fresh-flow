
-- Migration #1A: Re-point operational_positions.product_id from legacy products to canonical product_dictionary
-- Schema-only, no data changes. Table operational_positions is empty (0 rows).

ALTER TABLE public.operational_positions
  DROP CONSTRAINT IF EXISTS operational_positions_product_id_fkey;

ALTER TABLE public.operational_positions
  ADD CONSTRAINT operational_positions_product_id_fkey
  FOREIGN KEY (product_id)
  REFERENCES public.product_dictionary(id)
  ON DELETE RESTRICT
  ON UPDATE NO ACTION;
