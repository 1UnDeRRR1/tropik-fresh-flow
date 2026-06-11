
-- =====================================================================
-- Phase S1 Apply — Snapshot-First Archive Foundation
-- Creates: 4 enums, 2 tables (hidden snapshots + visible results),
--          3 role-safe views, RLS, grants, indexes.
-- No RPCs, no cron, no triggers, no UI wiring, no backfill.
-- =====================================================================

-- ---- 1. Enums --------------------------------------------------------
CREATE TYPE public.archive_snapshot_source AS ENUM (
  'branch_response', 'manager_confirm', 'shipment_link'
);

CREATE TYPE public.archive_snapshot_status AS ENUM (
  'pending', 'resolved', 'superseded', 'cancelled'
);

CREATE TYPE public.archive_snapshot_resolution AS ENUM (
  'delivered', 'not_fulfilled', 'cancelled', 'superseded', 'shared'
);

CREATE TYPE public.archive_visible_event_type AS ENUM (
  'delivered', 'not_fulfilled', 'cancelled', 'refused', 'shared'
);

-- ---- 2. Hidden snapshot table ---------------------------------------
CREATE TABLE public.archive_promise_snapshots (
  snapshot_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id              uuid NOT NULL
    REFERENCES public.operational_positions(position_id),
  branch_id                uuid NOT NULL
    REFERENCES public.branches(id),
  responsible_manager_id   uuid NULL,
  source                   public.archive_snapshot_source NOT NULL,
  source_offer_id          uuid NULL,
  source_response_id       uuid NULL,
  source_shipment_id       uuid NULL,
  requested_qty            numeric NOT NULL,
  promise_eta_snapshot     date NULL,
  product_id               uuid NULL,
  product_origin_country_id uuid NULL,
  variety_id               bigint NULL,
  caliber                  text NULL,
  packaging                text NULL,
  pallet_qty               numeric NULL,
  cost_indicative_usd_snapshot numeric NULL,
  cost_invoice_usd_snapshot    numeric NULL,
  status                   public.archive_snapshot_status NOT NULL DEFAULT 'pending',
  resolution               public.archive_snapshot_resolution NULL,
  visible_archive_event_id uuid NULL,  -- FK added below (circular)
  created_at               timestamptz NOT NULL DEFAULT now(),
  resolved_at              timestamptz NULL,
  notes                    text NULL
);

-- ---- 3. Visible result table ----------------------------------------
CREATE TABLE public.branch_archive_results (
  result_id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id              uuid NOT NULL
    REFERENCES public.archive_promise_snapshots(snapshot_id),
  position_id              uuid NOT NULL
    REFERENCES public.operational_positions(position_id),
  branch_id                uuid NOT NULL
    REFERENCES public.branches(id),
  responsible_manager_id   uuid NULL,
  event_type               public.archive_visible_event_type NOT NULL,
  delivered_qty            numeric NULL,
  shared_qty               numeric NULL DEFAULT 0,
  cut_qty                  numeric NULL DEFAULT 0,
  actual_eta               date NULL,
  actual_cost_indicative_usd numeric NULL,
  actual_cost_invoice_usd    numeric NULL,
  actual_cost_landed_usd     numeric NULL,
  is_split_shipment        boolean NOT NULL DEFAULT false,
  shipment_id              uuid NULL,
  occurred_at              timestamptz NOT NULL DEFAULT now(),
  created_at               timestamptz NOT NULL DEFAULT now(),
  notes                    text NULL
);

-- ---- 4. Circular FK: snapshot → its resolved visible event ----------
ALTER TABLE public.archive_promise_snapshots
  ADD CONSTRAINT archive_promise_snapshots_visible_archive_event_id_fkey
  FOREIGN KEY (visible_archive_event_id)
  REFERENCES public.branch_archive_results(result_id);

-- ---- 5. Indexes ------------------------------------------------------
-- One visible result per snapshot
CREATE UNIQUE INDEX archive_results_unique_snapshot
  ON public.branch_archive_results(snapshot_id);

-- Prevent duplicate pending snapshots per source event
CREATE UNIQUE INDEX archive_snap_unique_pending_response
  ON public.archive_promise_snapshots(source_response_id)
  WHERE status = 'pending'
    AND source = 'branch_response'
    AND source_response_id IS NOT NULL;

CREATE UNIQUE INDEX archive_snap_unique_pending_manager
  ON public.archive_promise_snapshots(source_offer_id, position_id)
  WHERE status = 'pending'
    AND source = 'manager_confirm'
    AND source_offer_id IS NOT NULL;

CREATE UNIQUE INDEX archive_snap_unique_pending_shipment
  ON public.archive_promise_snapshots(source_shipment_id, position_id)
  WHERE status = 'pending'
    AND source = 'shipment_link'
    AND source_shipment_id IS NOT NULL;

-- Result list / lookup indexes
CREATE INDEX archive_results_branch_idx
  ON public.branch_archive_results(branch_id, occurred_at DESC);
CREATE INDEX archive_results_manager_idx
  ON public.branch_archive_results(responsible_manager_id, occurred_at DESC);
CREATE INDEX archive_results_event_type_idx
  ON public.branch_archive_results(event_type);

-- Snapshot lookup indexes
CREATE INDEX archive_snapshots_position_idx
  ON public.archive_promise_snapshots(position_id);
CREATE INDEX archive_snapshots_offer_idx
  ON public.archive_promise_snapshots(source_offer_id)
  WHERE source_offer_id IS NOT NULL;
CREATE INDEX archive_snapshots_response_idx
  ON public.archive_promise_snapshots(source_response_id)
  WHERE source_response_id IS NOT NULL;

-- ---- 6. RLS (raw tables: closed to client roles) --------------------
ALTER TABLE public.archive_promise_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_archive_results    ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated. service_role bypasses RLS.

-- ---- 7. Raw table grants (hidden from anon/authenticated) -----------
REVOKE ALL ON public.archive_promise_snapshots FROM PUBLIC;
REVOKE ALL ON public.archive_promise_snapshots FROM anon;
REVOKE ALL ON public.archive_promise_snapshots FROM authenticated;
GRANT  ALL ON public.archive_promise_snapshots TO   service_role;

REVOKE ALL ON public.branch_archive_results FROM PUBLIC;
REVOKE ALL ON public.branch_archive_results FROM anon;
REVOKE ALL ON public.branch_archive_results FROM authenticated;
GRANT  ALL ON public.branch_archive_results TO   service_role;

-- ---- 8. Role-safe views (SECURITY DEFINER via owner-bound) ----------
-- security_invoker = false (default in PG15+, set explicitly): view runs
-- as owner (postgres) and bypasses raw-table RLS by design. WHERE clauses
-- enforce per-role visibility. Explicit column whitelists — no r.*/s.*.

-- 8.1 Branch view
CREATE VIEW public.branch_archive_results_branch
WITH (security_invoker = false) AS
SELECT
  r.result_id,
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
  s.source                       AS promise_source,
  s.product_id,
  s.product_origin_country_id,
  s.variety_id,
  s.caliber,
  s.packaging,
  s.pallet_qty,
  s.cost_indicative_usd_snapshot,
  s.cost_invoice_usd_snapshot
FROM public.branch_archive_results   r
JOIN public.archive_promise_snapshots s ON s.snapshot_id = r.snapshot_id
WHERE public.has_role(auth.uid(), 'branch'::public.app_role)
  AND NOT public.is_staff(auth.uid())
  AND r.branch_id = (
    SELECT p.branch_id FROM public.profiles p WHERE p.id = auth.uid()
  );

-- 8.2 Manager view
CREATE VIEW public.branch_archive_results_manager
WITH (security_invoker = false) AS
SELECT
  r.result_id,
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
  s.source                       AS promise_source,
  s.product_id,
  s.product_origin_country_id,
  s.variety_id,
  s.caliber,
  s.packaging,
  s.pallet_qty,
  s.cost_indicative_usd_snapshot,
  s.cost_invoice_usd_snapshot
FROM public.branch_archive_results   r
JOIN public.archive_promise_snapshots s ON s.snapshot_id = r.snapshot_id
WHERE public.has_role(auth.uid(), 'import_manager'::public.app_role)
  AND r.responsible_manager_id = public.current_import_manager_id();

-- 8.3 Admin view (admin + super_admin + owner)
CREATE VIEW public.branch_archive_results_admin
WITH (security_invoker = false) AS
SELECT
  r.result_id,
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
  s.source                       AS promise_source,
  s.product_id,
  s.product_origin_country_id,
  s.variety_id,
  s.caliber,
  s.packaging,
  s.pallet_qty,
  s.cost_indicative_usd_snapshot,
  s.cost_invoice_usd_snapshot
FROM public.branch_archive_results   r
JOIN public.archive_promise_snapshots s ON s.snapshot_id = r.snapshot_id
WHERE public.is_admin(auth.uid())
   OR public.is_super_admin(auth.uid())
   OR public.has_role(auth.uid(), 'owner'::public.app_role);

-- ---- 9. View grants (SELECT only, authenticated only) ---------------
REVOKE ALL ON public.branch_archive_results_branch  FROM PUBLIC;
REVOKE ALL ON public.branch_archive_results_branch  FROM anon;
REVOKE ALL ON public.branch_archive_results_branch  FROM authenticated;
GRANT  SELECT ON public.branch_archive_results_branch  TO authenticated;

REVOKE ALL ON public.branch_archive_results_manager FROM PUBLIC;
REVOKE ALL ON public.branch_archive_results_manager FROM anon;
REVOKE ALL ON public.branch_archive_results_manager FROM authenticated;
GRANT  SELECT ON public.branch_archive_results_manager TO authenticated;

REVOKE ALL ON public.branch_archive_results_admin   FROM PUBLIC;
REVOKE ALL ON public.branch_archive_results_admin   FROM anon;
REVOKE ALL ON public.branch_archive_results_admin   FROM authenticated;
GRANT  SELECT ON public.branch_archive_results_admin   TO authenticated;
-- No logistics/broker views, no grants to any logistics/broker path.
