
-- Tropik Archive — extend product_name fallback in role-safe views.
-- Column order, names, types, role predicates, security_invoker, and grants
-- are preserved exactly. Only the product_name expression changes, plus two
-- additional LEFT JOINs to feed that expression.

CREATE OR REPLACE VIEW public.branch_archive_results_branch
WITH (security_invoker=false) AS
 SELECT r.result_id,
    r.position_id,
    r.branch_id,
    r.responsible_manager_id,
    r.event_type,
    r.delivered_qty,
    r.shared_qty,
    r.cut_qty,
    r.actual_eta,
    r.actual_cost_indicative_usd,
    r.actual_cost_invoice_usd,
    r.actual_cost_landed_usd,
    r.is_split_shipment,
    r.shipment_id,
    r.occurred_at,
    r.notes,
    s.requested_qty,
    s.promise_eta_snapshot,
    s.source AS promise_source,
    s.product_id,
    s.product_origin_country_id,
    s.variety_id,
    s.caliber,
    s.packaging,
    s.pallet_qty,
    s.cost_indicative_usd_snapshot,
    s.cost_invoice_usd_snapshot,
    s.requested_sale_price_snapshot,
    s.requested_sale_currency_snapshot,
    r.event_qty,
    COALESCE(p.name, pd.product_name_ua, mo.product_name, si_display.product_name) AS product_name,
    c.name AS origin_country_name,
    pv.variety AS variety_name,
    b.name AS branch_name,
    im.full_name AS responsible_manager_name,
    sh.code AS shipment_code
   FROM public.branch_archive_results r
     JOIN public.archive_promise_snapshots s ON s.snapshot_id = r.snapshot_id
     LEFT JOIN public.products p ON p.id = s.product_id
     LEFT JOIN public.product_dictionary pd ON pd.id = s.product_id
     LEFT JOIN public.manager_offers mo ON mo.id = s.source_offer_id
     LEFT JOIN public.countries c ON c.id = s.product_origin_country_id
     LEFT JOIN public.product_varieties pv ON pv.id = s.variety_id
     LEFT JOIN public.branches b ON b.id = r.branch_id
     LEFT JOIN public.import_managers im ON im.id = r.responsible_manager_id
     LEFT JOIN public.shipments sh ON sh.id = r.shipment_id
     LEFT JOIN LATERAL (
        SELECT si.product_name
          FROM public.shipment_items si
         WHERE si.shipment_id = r.shipment_id
           AND si.position_id = s.position_id
         ORDER BY si.id
         LIMIT 1
     ) si_display ON true
  WHERE has_role(auth.uid(), 'branch'::app_role) AND NOT is_staff(auth.uid()) AND r.branch_id = (( SELECT p2.branch_id
           FROM public.profiles p2
          WHERE p2.id = auth.uid()));

CREATE OR REPLACE VIEW public.branch_archive_results_manager
WITH (security_invoker=false) AS
 SELECT r.result_id,
    r.position_id,
    r.branch_id,
    r.responsible_manager_id,
    r.event_type,
    r.delivered_qty,
    r.shared_qty,
    r.cut_qty,
    r.actual_eta,
    r.actual_cost_indicative_usd,
    r.actual_cost_invoice_usd,
    r.actual_cost_landed_usd,
    r.is_split_shipment,
    r.shipment_id,
    r.occurred_at,
    r.notes,
    s.requested_qty,
    s.promise_eta_snapshot,
    s.source AS promise_source,
    s.product_id,
    s.product_origin_country_id,
    s.variety_id,
    s.caliber,
    s.packaging,
    s.pallet_qty,
    s.cost_indicative_usd_snapshot,
    s.cost_invoice_usd_snapshot,
    s.requested_sale_price_snapshot,
    s.requested_sale_currency_snapshot,
    r.event_qty,
    COALESCE(p.name, pd.product_name_ua, mo.product_name, si_display.product_name) AS product_name,
    c.name AS origin_country_name,
    pv.variety AS variety_name,
    b.name AS branch_name,
    im.full_name AS responsible_manager_name,
    sh.code AS shipment_code
   FROM public.branch_archive_results r
     JOIN public.archive_promise_snapshots s ON s.snapshot_id = r.snapshot_id
     LEFT JOIN public.products p ON p.id = s.product_id
     LEFT JOIN public.product_dictionary pd ON pd.id = s.product_id
     LEFT JOIN public.manager_offers mo ON mo.id = s.source_offer_id
     LEFT JOIN public.countries c ON c.id = s.product_origin_country_id
     LEFT JOIN public.product_varieties pv ON pv.id = s.variety_id
     LEFT JOIN public.branches b ON b.id = r.branch_id
     LEFT JOIN public.import_managers im ON im.id = r.responsible_manager_id
     LEFT JOIN public.shipments sh ON sh.id = r.shipment_id
     LEFT JOIN LATERAL (
        SELECT si.product_name
          FROM public.shipment_items si
         WHERE si.shipment_id = r.shipment_id
           AND si.position_id = s.position_id
         ORDER BY si.id
         LIMIT 1
     ) si_display ON true
  WHERE has_role(auth.uid(), 'import_manager'::app_role) AND r.responsible_manager_id = current_import_manager_id();

CREATE OR REPLACE VIEW public.branch_archive_results_admin
WITH (security_invoker=false) AS
 SELECT r.result_id,
    r.position_id,
    r.branch_id,
    r.responsible_manager_id,
    r.event_type,
    r.delivered_qty,
    r.shared_qty,
    r.cut_qty,
    r.actual_eta,
    r.actual_cost_indicative_usd,
    r.actual_cost_invoice_usd,
    r.actual_cost_landed_usd,
    r.is_split_shipment,
    r.shipment_id,
    r.occurred_at,
    r.notes,
    s.requested_qty,
    s.promise_eta_snapshot,
    s.source AS promise_source,
    s.product_id,
    s.product_origin_country_id,
    s.variety_id,
    s.caliber,
    s.packaging,
    s.pallet_qty,
    s.cost_indicative_usd_snapshot,
    s.cost_invoice_usd_snapshot,
    s.requested_sale_price_snapshot,
    s.requested_sale_currency_snapshot,
    r.event_qty,
    COALESCE(p.name, pd.product_name_ua, mo.product_name, si_display.product_name) AS product_name,
    c.name AS origin_country_name,
    pv.variety AS variety_name,
    b.name AS branch_name,
    im.full_name AS responsible_manager_name,
    sh.code AS shipment_code
   FROM public.branch_archive_results r
     JOIN public.archive_promise_snapshots s ON s.snapshot_id = r.snapshot_id
     LEFT JOIN public.products p ON p.id = s.product_id
     LEFT JOIN public.product_dictionary pd ON pd.id = s.product_id
     LEFT JOIN public.manager_offers mo ON mo.id = s.source_offer_id
     LEFT JOIN public.countries c ON c.id = s.product_origin_country_id
     LEFT JOIN public.product_varieties pv ON pv.id = s.variety_id
     LEFT JOIN public.branches b ON b.id = r.branch_id
     LEFT JOIN public.import_managers im ON im.id = r.responsible_manager_id
     LEFT JOIN public.shipments sh ON sh.id = r.shipment_id
     LEFT JOIN LATERAL (
        SELECT si.product_name
          FROM public.shipment_items si
         WHERE si.shipment_id = r.shipment_id
           AND si.position_id = s.position_id
         ORDER BY si.id
         LIMIT 1
     ) si_display ON true
  WHERE is_admin(auth.uid()) OR is_super_admin(auth.uid()) OR has_role(auth.uid(), 'owner'::app_role);

-- Preserve existing grants (CREATE OR REPLACE keeps them; re-issuing is a no-op safety net).
GRANT SELECT ON public.branch_archive_results_branch  TO authenticated;
GRANT SELECT ON public.branch_archive_results_manager TO authenticated;
GRANT SELECT ON public.branch_archive_results_admin   TO authenticated;
