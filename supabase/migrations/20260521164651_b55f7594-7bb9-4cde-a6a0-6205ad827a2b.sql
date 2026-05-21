REVOKE ALL ON FUNCTION public.link_response_to_shipment_item(uuid, uuid, numeric, boolean, text) FROM public;
REVOKE ALL ON FUNCTION public.link_response_to_shipment_item(uuid, uuid, numeric, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.link_response_to_shipment_item(uuid, uuid, numeric, boolean, text) TO authenticated;

REVOKE ALL ON FUNCTION public.link_offer_to_shipment_item_fifo(uuid, uuid, numeric, boolean, text) FROM public;
REVOKE ALL ON FUNCTION public.link_offer_to_shipment_item_fifo(uuid, uuid, numeric, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.link_offer_to_shipment_item_fifo(uuid, uuid, numeric, boolean, text) TO authenticated;