TRUNCATE TABLE
  public.shipment_item_changes,
  public.shipment_items,
  public.distribution_items,
  public.distributions,
  public.cancelled_shipments_archive,
  public.shipments,
  public.vehicles
RESTART IDENTITY CASCADE;