
-- Switch branch-facing views to SECURITY DEFINER mode so the view's own WHERE
-- clause governs row visibility instead of base-table RLS. Branch users have
-- no direct SELECT policy on shipments / shipment_items (those tables hide
-- internal cost columns from branches), so with security_invoker=on the views
-- returned 0 rows for branches even when matching distributions existed.
ALTER VIEW public.shipments_branch SET (security_invoker = off);
ALTER VIEW public.shipment_items_branch SET (security_invoker = off);
