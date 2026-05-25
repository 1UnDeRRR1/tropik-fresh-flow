-- POSITION ID Stage P1 schema migration
-- manager_offers.position_id
ALTER TABLE public.manager_offers
  ADD COLUMN position_id uuid NULL;

ALTER TABLE public.manager_offers
  ADD CONSTRAINT manager_offers_position_id_fkey
  FOREIGN KEY (position_id)
  REFERENCES public.operational_positions(position_id)
  ON DELETE RESTRICT
  ON UPDATE NO ACTION;

CREATE INDEX manager_offers_position_id_idx
  ON public.manager_offers(position_id);

-- shipment_items.position_id
ALTER TABLE public.shipment_items
  ADD COLUMN position_id uuid NULL;

ALTER TABLE public.shipment_items
  ADD CONSTRAINT shipment_items_position_id_fkey
  FOREIGN KEY (position_id)
  REFERENCES public.operational_positions(position_id)
  ON DELETE RESTRICT
  ON UPDATE NO ACTION;

CREATE INDEX shipment_items_position_id_idx
  ON public.shipment_items(position_id);