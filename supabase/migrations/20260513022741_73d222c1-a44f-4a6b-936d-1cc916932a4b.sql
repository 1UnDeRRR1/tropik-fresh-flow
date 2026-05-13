ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicles;
ALTER PUBLICATION supabase_realtime ADD TABLE public.shipments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.shipment_items;
ALTER TABLE public.vehicles REPLICA IDENTITY FULL;
ALTER TABLE public.shipments REPLICA IDENTITY FULL;
ALTER TABLE public.shipment_items REPLICA IDENTITY FULL;