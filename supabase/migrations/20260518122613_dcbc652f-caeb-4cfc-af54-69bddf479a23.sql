
-- 1. Add brand and class to shipment_items
ALTER TABLE public.shipment_items 
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS class text;

-- 2. Baseline table for tracking changes per branch
CREATE TABLE IF NOT EXISTS public.branch_distribution_baselines (
  branch_id uuid NOT NULL,
  distribution_id uuid NOT NULL,
  shipment_item_id uuid NOT NULL,
  identified_at timestamptz NOT NULL DEFAULT now(),
  baseline_eta date,
  baseline_pallets numeric,
  baseline_cost_ind numeric,
  baseline_cost_inv numeric,
  seen_eta date,
  seen_pallets numeric,
  seen_cost_ind numeric,
  seen_cost_inv numeric,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_id, distribution_id, shipment_item_id)
);

ALTER TABLE public.branch_distribution_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bdb admin all" ON public.branch_distribution_baselines
  FOR ALL TO authenticated
  USING (is_admin(auth.uid())) WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "bdb staff read" ON public.branch_distribution_baselines
  FOR SELECT TO authenticated USING (is_staff(auth.uid()));

CREATE POLICY "bdb branch read" ON public.branch_distribution_baselines
  FOR SELECT TO authenticated
  USING (branch_id = user_branch_id(auth.uid()));

CREATE POLICY "bdb branch update" ON public.branch_distribution_baselines
  FOR UPDATE TO authenticated
  USING (branch_id = user_branch_id(auth.uid()))
  WITH CHECK (branch_id = user_branch_id(auth.uid()));

-- 3. Trigger to auto-create baseline on new distribution_items
CREATE OR REPLACE FUNCTION public.create_branch_baseline_for_di()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
  v_eta date;
  v_pallets numeric;
  v_ind numeric;
  v_inv numeric;
BEGIN
  SELECT branch_id INTO v_branch FROM public.distributions WHERE id = NEW.distribution_id;
  IF v_branch IS NULL THEN RETURN NEW; END IF;
  
  SELECT s.eta INTO v_eta 
    FROM public.distributions d 
    JOIN public.shipments s ON s.id = d.shipment_id 
    WHERE d.id = NEW.distribution_id;
  
  SELECT final_cost_indicative, final_cost_invoice INTO v_ind, v_inv
    FROM public.shipment_items WHERE id = NEW.shipment_item_id;
  
  v_pallets := COALESCE(NEW.pallets, 0);
  
  INSERT INTO public.branch_distribution_baselines
    (branch_id, distribution_id, shipment_item_id, identified_at,
     baseline_eta, baseline_pallets, baseline_cost_ind, baseline_cost_inv,
     seen_eta, seen_pallets, seen_cost_ind, seen_cost_inv)
  VALUES
    (v_branch, NEW.distribution_id, NEW.shipment_item_id, now(),
     v_eta, v_pallets, v_ind, v_inv,
     v_eta, v_pallets, v_ind, v_inv)
  ON CONFLICT (branch_id, distribution_id, shipment_item_id) DO NOTHING;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_branch_baseline ON public.distribution_items;
CREATE TRIGGER trg_create_branch_baseline
  AFTER INSERT ON public.distribution_items
  FOR EACH ROW EXECUTE FUNCTION public.create_branch_baseline_for_di();

-- 4. RPC for branch to acknowledge changes
CREATE OR REPLACE FUNCTION public.branch_ack_changes(p_distribution_id uuid, p_shipment_item_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch uuid;
  v_eta date;
  v_pallets numeric;
  v_ind numeric;
  v_inv numeric;
BEGIN
  v_branch := user_branch_id(auth.uid());
  IF v_branch IS NULL THEN RETURN; END IF;
  
  SELECT s.eta INTO v_eta 
    FROM public.distributions d 
    JOIN public.shipments s ON s.id = d.shipment_id 
    WHERE d.id = p_distribution_id;
  
  SELECT COALESCE(di.pallets, 0) INTO v_pallets 
    FROM public.distribution_items di 
    WHERE di.distribution_id = p_distribution_id 
      AND di.shipment_item_id = p_shipment_item_id 
    LIMIT 1;
  
  SELECT final_cost_indicative, final_cost_invoice INTO v_ind, v_inv
    FROM public.shipment_items WHERE id = p_shipment_item_id;
  
  UPDATE public.branch_distribution_baselines
    SET seen_eta = v_eta,
        seen_pallets = v_pallets,
        seen_cost_ind = v_ind,
        seen_cost_inv = v_inv,
        updated_at = now()
    WHERE branch_id = v_branch
      AND distribution_id = p_distribution_id
      AND shipment_item_id = p_shipment_item_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.branch_ack_changes(uuid, uuid) TO authenticated;

-- 5. Backfill existing distribution_items
INSERT INTO public.branch_distribution_baselines
  (branch_id, distribution_id, shipment_item_id, identified_at,
   baseline_eta, baseline_pallets, baseline_cost_ind, baseline_cost_inv,
   seen_eta, seen_pallets, seen_cost_ind, seen_cost_inv)
SELECT 
  d.branch_id,
  di.distribution_id,
  di.shipment_item_id,
  d.created_at,
  s.eta,
  COALESCE(di.pallets, 0),
  si.final_cost_indicative,
  si.final_cost_invoice,
  s.eta,
  COALESCE(di.pallets, 0),
  si.final_cost_indicative,
  si.final_cost_invoice
FROM public.distribution_items di
JOIN public.distributions d ON d.id = di.distribution_id
JOIN public.shipments s ON s.id = d.shipment_id
JOIN public.shipment_items si ON si.id = di.shipment_item_id
ON CONFLICT (branch_id, distribution_id, shipment_item_id) DO NOTHING;
