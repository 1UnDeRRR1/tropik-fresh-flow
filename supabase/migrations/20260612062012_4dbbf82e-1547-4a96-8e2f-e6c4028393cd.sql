
-- ============================================================
-- WAVE 1 (S1.1 + S2 Preview v5) — schema only, additive, non-breaking.
-- No triggers, no functions, no RPCs, no RLS changes, no UI.
-- The new enum value 'branch_stock_request' is added here but
-- NOT USED anywhere in this migration; first use is reserved
-- for Wave 2 (separate migration) → commit boundary respected.
-- ============================================================

-- ---------- Transaction A equivalent: enum extension ----------
ALTER TYPE public.archive_snapshot_source
  ADD VALUE IF NOT EXISTS 'branch_stock_request';

-- ---------- Transaction B: schema additions ----------

-- 1) manager_offer_responses: explicit refusal marker
ALTER TABLE public.manager_offer_responses
  ADD COLUMN IF NOT EXISTS refused_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS refused_by uuid        NULL;

ALTER TABLE public.manager_offer_responses
  DROP CONSTRAINT IF EXISTS mor_refusal_pair;
ALTER TABLE public.manager_offer_responses
  ADD CONSTRAINT mor_refusal_pair CHECK (
    (refused_at IS NULL  AND refused_by IS NULL)
    OR (refused_at IS NOT NULL AND refused_by IS NOT NULL)
  );

-- 2) archive_promise_snapshots: branch-specific sale price snapshot + qty>0
ALTER TABLE public.archive_promise_snapshots
  ADD COLUMN IF NOT EXISTS requested_sale_price_snapshot    numeric NULL,
  ADD COLUMN IF NOT EXISTS requested_sale_currency_snapshot text    NULL;

ALTER TABLE public.archive_promise_snapshots
  DROP CONSTRAINT IF EXISTS archive_promise_snapshots_requested_qty_positive;
ALTER TABLE public.archive_promise_snapshots
  ADD CONSTRAINT archive_promise_snapshots_requested_qty_positive
    CHECK (requested_qty > 0) NOT VALID;

-- 3) branch_archive_results: event_qty + non-unique snapshot index
ALTER TABLE public.branch_archive_results
  ADD COLUMN IF NOT EXISTS event_qty numeric NULL;

DROP INDEX IF EXISTS public.archive_results_unique_snapshot;
CREATE INDEX IF NOT EXISTS archive_results_snapshot_idx
  ON public.branch_archive_results (snapshot_id);

-- 4) Role-safe views: append event_qty at the END, keep existing
--    column order byte-for-byte from live pg_get_viewdef.
--    Explicit WITH (security_invoker=false) — definer mode preserved.

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
       r.event_qty
  FROM public.branch_archive_results r
  JOIN public.archive_promise_snapshots s ON s.snapshot_id = r.snapshot_id
 WHERE is_admin(auth.uid())
    OR is_super_admin(auth.uid())
    OR has_role(auth.uid(), 'owner'::app_role);

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
       r.event_qty
  FROM public.branch_archive_results r
  JOIN public.archive_promise_snapshots s ON s.snapshot_id = r.snapshot_id
 WHERE has_role(auth.uid(), 'branch'::app_role)
   AND NOT is_staff(auth.uid())
   AND r.branch_id = (SELECT p.branch_id
                        FROM public.profiles p
                       WHERE p.id = auth.uid());

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
       r.event_qty
  FROM public.branch_archive_results r
  JOIN public.archive_promise_snapshots s ON s.snapshot_id = r.snapshot_id
 WHERE has_role(auth.uid(), 'import_manager'::app_role)
   AND r.responsible_manager_id = current_import_manager_id();

-- 5) Idempotent grants on the three role-safe views (safety net).
--    Raw archive tables (branch_archive_results, archive_promise_snapshots)
--    are intentionally NOT granted to anon/authenticated and remain closed.
GRANT SELECT ON public.branch_archive_results_admin   TO authenticated;
GRANT SELECT ON public.branch_archive_results_branch  TO authenticated;
GRANT SELECT ON public.branch_archive_results_manager TO authenticated;
