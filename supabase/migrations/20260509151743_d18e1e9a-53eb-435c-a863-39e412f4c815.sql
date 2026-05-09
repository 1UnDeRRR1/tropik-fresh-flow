
ALTER TABLE public.branch_transfer_offers
  ADD CONSTRAINT branch_transfer_offers_shipment_item_fk
    FOREIGN KEY (shipment_item_id) REFERENCES public.shipment_items(id) ON DELETE CASCADE,
  ADD CONSTRAINT branch_transfer_offers_distribution_fk
    FOREIGN KEY (distribution_id) REFERENCES public.distributions(id) ON DELETE CASCADE,
  ADD CONSTRAINT branch_transfer_offers_from_branch_fk
    FOREIGN KEY (from_branch_id) REFERENCES public.branches(id) ON DELETE CASCADE,
  ADD CONSTRAINT branch_transfer_offers_to_branch_fk
    FOREIGN KEY (to_branch_id) REFERENCES public.branches(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_bto_from_branch ON public.branch_transfer_offers(from_branch_id);
CREATE INDEX IF NOT EXISTS idx_bto_to_branch ON public.branch_transfer_offers(to_branch_id);
CREATE INDEX IF NOT EXISTS idx_bto_shipment_item ON public.branch_transfer_offers(shipment_item_id);
