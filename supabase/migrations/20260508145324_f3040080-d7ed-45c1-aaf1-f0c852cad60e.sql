
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tgname FROM pg_trigger
    WHERE tgrelid = 'public.shipment_items'::regclass AND NOT tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.shipment_items', r.tgname);
  END LOOP;
  FOR r IN SELECT tgname FROM pg_trigger
    WHERE tgrelid = 'public.shipments'::regclass AND NOT tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.shipments', r.tgname);
  END LOOP;
END $$;

CREATE TRIGGER trg_01_shipment_item_usd
BEFORE INSERT OR UPDATE OF unit_price, price_currency, shipment_id
ON public.shipment_items
FOR EACH ROW EXECUTE FUNCTION public.calc_shipment_item_usd();

CREATE TRIGGER trg_02_shipment_item_costs
BEFORE INSERT OR UPDATE OF unit_price, price_currency, unit_price_usd, product_name, shipment_id, pallet_count, pallet_weight
ON public.shipment_items
FOR EACH ROW EXECUTE FUNCTION public.calc_shipment_item_costs();

CREATE TRIGGER trg_03_log_shipment_item_changes
AFTER UPDATE ON public.shipment_items
FOR EACH ROW EXECUTE FUNCTION public.log_shipment_item_changes();

CREATE TRIGGER trg_01_shipment_logistics_usd
BEFORE INSERT OR UPDATE OF logistics_cost, logistics_cost_currency, eur_usd_rate
ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.calc_shipment_logistics_usd();

CREATE TRIGGER trg_02_recompute_items_costs
AFTER UPDATE OF country, logistics_cost_usd
ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.recompute_shipment_items_costs();

CREATE TRIGGER trg_03_log_shipment_eta_changes
AFTER UPDATE OF eta ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.log_shipment_eta_changes();

CREATE TRIGGER z_touch_shipments
BEFORE UPDATE ON public.shipments
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Backfill: force recompute with corrected order
UPDATE public.shipments SET logistics_cost = logistics_cost;
UPDATE public.shipment_items SET unit_price = unit_price;
