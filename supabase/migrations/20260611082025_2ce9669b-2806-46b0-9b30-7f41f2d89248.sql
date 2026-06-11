-- =====================================================================
-- Phase 1: branch_archive_events ledger (append-only historical archive)
-- =====================================================================

-- 1. Enums --------------------------------------------------------------

CREATE TYPE public.branch_archive_event_type AS ENUM (
  'delivered','not_fulfilled','cut','refusal_zero','refusal_button','cancelled'
);

CREATE TYPE public.branch_archive_eta_source AS ENUM (
  'shipment_eta','offer_eta','position_eta','cancel_time','refusal_time'
);

CREATE TYPE public.branch_archive_trigger_source AS ENUM (
  'shipment_eta_sweep','offer_eta_sweep','position_eta_sweep','cancel_rpc','refusal_rpc'
);

CREATE TYPE public.branch_archive_confirmation_cost_source AS ENUM (
  'manager_offers','none'
);

CREATE TYPE public.branch_archive_arrival_cost_source AS ENUM (
  'branch_visible_prices','none'
);

CREATE TYPE public.branch_archive_confirmation_cost_status AS ENUM (
  'present','no_offer','unavailable_pre_distribution','unavailable_other'
);

CREATE TYPE public.branch_archive_arrival_cost_status AS ENUM (
  'present','not_yet_arrived','no_distribution','unavailable_other'
);

-- 2. Table --------------------------------------------------------------

CREATE TABLE public.branch_archive_events (
  event_id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  position_id                    uuid NOT NULL
                                 REFERENCES public.operational_positions(position_id),
  position_branch_allocation_id  uuid NOT NULL
                                 REFERENCES public.position_branch_allocations(id),
  branch_id                      uuid NOT NULL
                                 REFERENCES public.branches(id),

  response_id                    uuid REFERENCES public.manager_offer_responses(id),
  allocation_part_id             uuid REFERENCES public.manager_offer_allocation_parts(id),
  shipment_id                    uuid REFERENCES public.shipments(id),
  shipment_item_id               uuid REFERENCES public.shipment_items(id),

  event_type                     public.branch_archive_event_type NOT NULL,
  event_subtype                  text,

  trigger_source                 public.branch_archive_trigger_source NOT NULL,
  trigger_at                     timestamptz NOT NULL DEFAULT now(),

  event_pallets                  numeric(12,3) NOT NULL CHECK (event_pallets > 0),

  pba_status_snapshot            text   NOT NULL,
  pba_requested_qty_snapshot     numeric(12,3) NOT NULL CHECK (pba_requested_qty_snapshot >= 0),
  pba_approved_qty_snapshot      numeric(12,3) NOT NULL CHECK (pba_approved_qty_snapshot  >= 0),
  pba_ordered_qty_snapshot       numeric(12,3) NOT NULL CHECK (pba_ordered_qty_snapshot   >= 0),
  pba_cancelled_qty_snapshot     numeric(12,3) NOT NULL CHECK (pba_cancelled_qty_snapshot >= 0),
  pba_remaining_qty_snapshot     numeric(12,3) NOT NULL CHECK (pba_remaining_qty_snapshot >= 0),

  product_name_snapshot          text NOT NULL,
  origin_country_snapshot        text NOT NULL,
  variety_snapshot               text,
  caliber_snapshot               text,
  brand_snapshot                 text,
  class_snapshot                 text,
  package_snapshot               text,
  shipment_code_snapshot         text,
  responsible_manager_name_snapshot text,

  eta_snapshot                   date,
  eta_source                     public.branch_archive_eta_source,
  shipment_eta_snapshot          date,
  offer_eta_snapshot             date,

  branch_visible_cost_indicative_at_confirmation_usd numeric(14,4),
  branch_visible_cost_invoice_at_confirmation_usd    numeric(14,4),
  branch_visible_cost_indicative_at_arrival_usd      numeric(14,4),
  branch_visible_cost_invoice_at_arrival_usd         numeric(14,4),
  confirmation_cost_snapshot_source public.branch_archive_confirmation_cost_source NOT NULL DEFAULT 'none',
  confirmation_cost_snapshot_status public.branch_archive_confirmation_cost_status NOT NULL DEFAULT 'unavailable_other',
  arrival_cost_snapshot_source      public.branch_archive_arrival_cost_source      NOT NULL DEFAULT 'none',
  arrival_cost_snapshot_status      public.branch_archive_arrival_cost_status      NOT NULL DEFAULT 'unavailable_other',

  responsible_manager_id         uuid REFERENCES public.import_managers(id),
  acting_manager_id              uuid REFERENCES public.import_managers(id),
  acting_user_id                 uuid,

  occurred_at                    timestamptz NOT NULL,
  created_at                     timestamptz NOT NULL DEFAULT now(),

  supersedes_event_id            uuid REFERENCES public.branch_archive_events(event_id),
  superseded_at                  timestamptz,
  superseded_by_event_id         uuid REFERENCES public.branch_archive_events(event_id),

  CONSTRAINT bae_trigger_alignment CHECK (
    (event_type = 'delivered'                       AND trigger_source = 'shipment_eta_sweep')
    OR (event_type = 'cut'                          AND trigger_source IN ('shipment_eta_sweep','offer_eta_sweep','position_eta_sweep'))
    OR (event_type = 'not_fulfilled'                AND trigger_source IN ('offer_eta_sweep','position_eta_sweep'))
    OR (event_type IN ('refusal_zero','refusal_button') AND trigger_source = 'refusal_rpc')
    OR (event_type = 'cancelled'                    AND trigger_source = 'cancel_rpc')
  ),

  CONSTRAINT bae_delivered_shape CHECK (
    event_type <> 'delivered'
    OR (
      allocation_part_id    IS NOT NULL
      AND shipment_id       IS NOT NULL
      AND shipment_item_id  IS NOT NULL
      AND eta_source        = 'shipment_eta'
      AND eta_snapshot          IS NOT NULL
      AND shipment_eta_snapshot IS NOT NULL
    )
  ),

  CONSTRAINT bae_not_fulfilled_shape CHECK (
    event_type <> 'not_fulfilled'
    OR (
      response_id IS NOT NULL
      AND eta_source IN ('offer_eta','position_eta')
      AND eta_snapshot IS NOT NULL
    )
  ),

  CONSTRAINT bae_cut_shape CHECK (
    event_type <> 'cut'
    OR (
      response_id IS NOT NULL
      AND eta_snapshot IS NOT NULL
      AND (
        (
          eta_source = 'shipment_eta'
          AND shipment_id            IS NOT NULL
          AND shipment_code_snapshot IS NOT NULL
          AND shipment_eta_snapshot  IS NOT NULL
        )
        OR (
          eta_source IN ('offer_eta','position_eta')
          AND shipment_id IS NULL
        )
      )
    )
  ),

  CONSTRAINT bae_refusal_shape CHECK (
    event_type NOT IN ('refusal_zero','refusal_button')
    OR (response_id IS NOT NULL AND eta_source = 'refusal_time')
  ),

  CONSTRAINT bae_cancelled_shape CHECK (
    event_type <> 'cancelled'
    OR (shipment_id IS NOT NULL AND eta_source = 'cancel_time')
  ),

  CONSTRAINT bae_shipment_code_required CHECK (
    shipment_id IS NULL OR shipment_code_snapshot IS NOT NULL
  ),

  CONSTRAINT bae_confirmation_cost_consistency CHECK (
    (confirmation_cost_snapshot_status = 'present'
       AND confirmation_cost_snapshot_source = 'manager_offers'
       AND (branch_visible_cost_indicative_at_confirmation_usd IS NOT NULL
            OR branch_visible_cost_invoice_at_confirmation_usd IS NOT NULL))
    OR
    (confirmation_cost_snapshot_status IN ('no_offer','unavailable_pre_distribution','unavailable_other')
       AND confirmation_cost_snapshot_source = 'none'
       AND branch_visible_cost_indicative_at_confirmation_usd IS NULL
       AND branch_visible_cost_invoice_at_confirmation_usd    IS NULL)
  ),

  CONSTRAINT bae_arrival_cost_consistency CHECK (
    (arrival_cost_snapshot_status = 'present'
       AND arrival_cost_snapshot_source = 'branch_visible_prices'
       AND (branch_visible_cost_indicative_at_arrival_usd IS NOT NULL
            OR branch_visible_cost_invoice_at_arrival_usd IS NOT NULL))
    OR
    (arrival_cost_snapshot_status IN ('not_yet_arrived','no_distribution','unavailable_other')
       AND arrival_cost_snapshot_source = 'none'
       AND branch_visible_cost_indicative_at_arrival_usd IS NULL
       AND branch_visible_cost_invoice_at_arrival_usd    IS NULL)
  )
);

-- 3. Comments ----------------------------------------------------------

COMMENT ON TABLE public.branch_archive_events IS
  'Append-only historical archive of completed branch outcomes. Every requested branch quantity is explained by exactly one final archive outcome: delivered, not_fulfilled, cut, refusal_zero, refusal_button, or cancelled. For partial-confirmation cycles: delivered + not_fulfilled + cut = pba_requested_qty_snapshot. For refusal cycles: refusal event_pallets = requested. For cancellation cycles: cancelled explains the affected cancelled quantity per the cancellation flow. Written only by approved server-side writers in Phase 2 (ETA sweep / refusal RPC / cancellation RPC); never by client UI. UPDATE/DELETE blocked for all roles including service_role.';

COMMENT ON COLUMN public.branch_archive_events.position_id IS
  'FK to public.operational_positions(position_id). Never operational_positions.id.';
COMMENT ON COLUMN public.branch_archive_events.branch_id IS
  'Branch ownership snapshot. Retained even though profiles.branch_id binds visibility — supports React Query keys and admin paths.';
COMMENT ON COLUMN public.branch_archive_events.trigger_source IS
  'Which Phase 2 writer produced this row: shipment_eta_sweep | offer_eta_sweep | position_eta_sweep (RESERVED) | cancel_rpc | refusal_rpc.';
COMMENT ON COLUMN public.branch_archive_events.trigger_at IS
  'Wall-clock moment the writer materialized this row. Frozen at insert.';
COMMENT ON COLUMN public.branch_archive_events.occurred_at IS
  'Business event time. NEVER defaulted. Writer must pass: shipments.eta for delivered / normal cut; manager_offers.expected_eta (or future position_eta) for not_fulfilled / no-shipment cut; cancellation moment for cancelled; refusal moment for refusal_zero/refusal_button. Distinct from trigger_at, which is when the sweep/RPC executed.';
COMMENT ON COLUMN public.branch_archive_events.origin_country_snapshot IS
  'Product origin country only. Never fallback to supplier_country, loading_country, or shipment/vehicle_country.';
COMMENT ON COLUMN public.branch_archive_events.brand_snapshot IS
  'Nullable: no canonical source today. Reserved for future approved enrichment.';
COMMENT ON COLUMN public.branch_archive_events.class_snapshot IS
  'Nullable: no canonical source today. Reserved for future approved enrichment.';
COMMENT ON COLUMN public.branch_archive_events.eta_snapshot IS
  'Historical ETA frozen at event-write time. Source: public.shipments.eta when eta_source=shipment_eta; public.manager_offers.expected_eta when eta_source=offer_eta. position_eta is reserved/future and must not be used until explicitly approved. Never derived from creation-time ETA or manager_offers.prev_expected_eta. Immutable after insert.';
COMMENT ON COLUMN public.branch_archive_events.eta_source IS
  'shipment_eta (public.shipments.eta) | offer_eta (public.manager_offers.expected_eta) | position_eta (RESERVED) | cancel_time | refusal_time.';
COMMENT ON COLUMN public.branch_archive_events.confirmation_cost_snapshot_source IS
  'manager_offers OR none. Confirmation-leg cost is captured only from the manager offer the branch saw at confirmation moment. branch_visible_prices is NOT a valid source for the confirmation leg.';
COMMENT ON COLUMN public.branch_archive_events.confirmation_cost_snapshot_status IS
  'present | no_offer | unavailable_pre_distribution | unavailable_other. Explains exactly why a confirmation-leg cost is or is not snapshotted.';
COMMENT ON COLUMN public.branch_archive_events.arrival_cost_snapshot_source IS
  'branch_visible_prices OR none. Arrival-leg cost comes only from branch-published prices. manager_offers is NOT a valid source for arrival (enum-impossible).';
COMMENT ON COLUMN public.branch_archive_events.arrival_cost_snapshot_status IS
  'present | not_yet_arrived | no_distribution | unavailable_other. Explains exactly why an arrival-leg cost is or is not snapshotted.';
COMMENT ON COLUMN public.branch_archive_events.branch_visible_cost_indicative_at_confirmation_usd IS
  'Branch-visible indicative USD/pallet at confirmation moment. Never internal purchase cost, customs, transport, or FX.';
COMMENT ON COLUMN public.branch_archive_events.branch_visible_cost_invoice_at_confirmation_usd IS
  'Branch-visible invoice USD/pallet at confirmation moment.';
COMMENT ON COLUMN public.branch_archive_events.branch_visible_cost_indicative_at_arrival_usd IS
  'Branch-visible indicative USD/pallet at arrival moment.';
COMMENT ON COLUMN public.branch_archive_events.branch_visible_cost_invoice_at_arrival_usd IS
  'Branch-visible invoice USD/pallet at arrival moment.';
COMMENT ON COLUMN public.branch_archive_events.supersedes_event_id IS
  'INERT in Phase 1/2. Reserved for a future explicitly approved lineage path. No RPC, no UI, no admin maintenance writes this. Not exposed in branch or manager views.';
COMMENT ON COLUMN public.branch_archive_events.superseded_at IS
  'INERT in Phase 1/2. Reserved for a future explicitly approved lineage path. Not exposed in branch or manager views.';
COMMENT ON COLUMN public.branch_archive_events.superseded_by_event_id IS
  'INERT in Phase 1/2. Reserved for a future explicitly approved lineage path. Not exposed in branch or manager views.';

-- 4. Indexes ------------------------------------------------------------

CREATE INDEX bae_branch_occurred_idx
  ON public.branch_archive_events (branch_id, occurred_at DESC);
CREATE INDEX bae_position_idx
  ON public.branch_archive_events (position_id);
CREATE INDEX bae_pba_idx
  ON public.branch_archive_events (position_branch_allocation_id);
CREATE INDEX bae_shipment_idx
  ON public.branch_archive_events (shipment_id)
  WHERE shipment_id IS NOT NULL;
CREATE INDEX bae_responsible_manager_idx
  ON public.branch_archive_events (responsible_manager_id)
  WHERE responsible_manager_id IS NOT NULL;
CREATE INDEX bae_acting_manager_idx
  ON public.branch_archive_events (acting_manager_id)
  WHERE acting_manager_id IS NOT NULL;
CREATE INDEX bae_event_type_occurred_idx
  ON public.branch_archive_events (event_type, occurred_at DESC);

-- 5. Partial unique indexes (writer idempotency) -----------------------

CREATE UNIQUE INDEX bae_uniq_delivered
  ON public.branch_archive_events (allocation_part_id)
  WHERE event_type = 'delivered';
CREATE UNIQUE INDEX bae_uniq_cut
  ON public.branch_archive_events (position_branch_allocation_id, response_id)
  WHERE event_type = 'cut';
CREATE UNIQUE INDEX bae_uniq_not_fulfilled
  ON public.branch_archive_events (position_branch_allocation_id, response_id)
  WHERE event_type = 'not_fulfilled';
CREATE UNIQUE INDEX bae_uniq_refusal
  ON public.branch_archive_events (position_branch_allocation_id, response_id)
  WHERE event_type IN ('refusal_zero','refusal_button');
CREATE UNIQUE INDEX bae_uniq_cancelled
  ON public.branch_archive_events (shipment_id, position_branch_allocation_id)
  WHERE event_type = 'cancelled';

-- 6. Immutability trigger ----------------------------------------------

CREATE OR REPLACE FUNCTION public.bae_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION
    'branch_archive_events is append-only; UPDATE/DELETE is not permitted (op=%, row=%)',
    TG_OP, COALESCE(OLD.event_id::text, '<unknown>');
END;
$$;

CREATE TRIGGER trg_bae_block_mutation
BEFORE UPDATE OR DELETE ON public.branch_archive_events
FOR EACH ROW EXECUTE FUNCTION public.bae_block_mutation();

-- 7. GRANT / REVOKE on raw table ---------------------------------------

REVOKE ALL ON public.branch_archive_events FROM PUBLIC;
REVOKE ALL ON public.branch_archive_events FROM anon;
REVOKE ALL ON public.branch_archive_events FROM authenticated;
GRANT INSERT, SELECT ON public.branch_archive_events TO service_role;

-- 8. RLS on raw table ---------------------------------------------------

ALTER TABLE public.branch_archive_events ENABLE ROW LEVEL SECURITY;

-- 9. Branch view -------------------------------------------------------

CREATE VIEW public.branch_archive_events_branch AS
SELECT
  e.event_id,
  e.event_type,
  e.position_id,
  e.position_branch_allocation_id,
  e.branch_id,
  e.occurred_at,
  e.eta_snapshot,
  e.eta_source,
  e.shipment_eta_snapshot,
  e.offer_eta_snapshot,
  e.product_name_snapshot,
  e.origin_country_snapshot,
  e.variety_snapshot,
  e.caliber_snapshot,
  e.brand_snapshot,
  e.class_snapshot,
  e.package_snapshot,
  e.shipment_code_snapshot,
  e.responsible_manager_name_snapshot,
  e.pba_status_snapshot,
  e.pba_requested_qty_snapshot,
  e.pba_approved_qty_snapshot,
  e.pba_ordered_qty_snapshot,
  e.pba_cancelled_qty_snapshot,
  e.pba_remaining_qty_snapshot,
  e.event_pallets,
  e.branch_visible_cost_indicative_at_confirmation_usd,
  e.branch_visible_cost_invoice_at_confirmation_usd,
  e.branch_visible_cost_indicative_at_arrival_usd,
  e.branch_visible_cost_invoice_at_arrival_usd,
  e.confirmation_cost_snapshot_source,
  e.confirmation_cost_snapshot_status,
  e.arrival_cost_snapshot_source,
  e.arrival_cost_snapshot_status
FROM public.branch_archive_events e
WHERE
  public.has_role(auth.uid(), 'branch'::public.app_role)
  AND NOT public.is_staff(auth.uid())
  AND e.branch_id = public.user_branch_id(auth.uid());

REVOKE ALL ON public.branch_archive_events_branch FROM PUBLIC;
REVOKE ALL ON public.branch_archive_events_branch FROM anon;
GRANT  SELECT ON public.branch_archive_events_branch TO authenticated;

-- 10. Manager view -----------------------------------------------------

CREATE VIEW public.branch_archive_events_manager AS
SELECT
  e.event_id,
  e.event_type,
  e.event_subtype,
  e.trigger_source,
  e.trigger_at,
  e.position_id,
  e.position_branch_allocation_id,
  e.branch_id,
  e.response_id,
  e.allocation_part_id,
  e.shipment_id,
  e.shipment_item_id,
  e.event_pallets,
  e.pba_status_snapshot,
  e.pba_requested_qty_snapshot,
  e.pba_approved_qty_snapshot,
  e.pba_ordered_qty_snapshot,
  e.pba_cancelled_qty_snapshot,
  e.pba_remaining_qty_snapshot,
  e.product_name_snapshot,
  e.origin_country_snapshot,
  e.variety_snapshot,
  e.caliber_snapshot,
  e.brand_snapshot,
  e.class_snapshot,
  e.package_snapshot,
  e.shipment_code_snapshot,
  e.responsible_manager_name_snapshot,
  e.eta_snapshot,
  e.eta_source,
  e.shipment_eta_snapshot,
  e.offer_eta_snapshot,
  e.branch_visible_cost_indicative_at_confirmation_usd,
  e.branch_visible_cost_invoice_at_confirmation_usd,
  e.branch_visible_cost_indicative_at_arrival_usd,
  e.branch_visible_cost_invoice_at_arrival_usd,
  e.confirmation_cost_snapshot_source,
  e.confirmation_cost_snapshot_status,
  e.arrival_cost_snapshot_source,
  e.arrival_cost_snapshot_status,
  e.responsible_manager_id,
  e.acting_manager_id,
  e.occurred_at,
  e.created_at
FROM public.branch_archive_events e
WHERE
  public.has_role(auth.uid(), 'import_manager'::public.app_role)
  AND EXISTS (
    SELECT 1
    FROM public.import_managers im
    WHERE im.user_id = auth.uid()
      AND im.id IN (e.responsible_manager_id, e.acting_manager_id)
  );

REVOKE ALL ON public.branch_archive_events_manager FROM PUBLIC;
REVOKE ALL ON public.branch_archive_events_manager FROM anon;
GRANT  SELECT ON public.branch_archive_events_manager TO authenticated;

-- 11. Admin view -------------------------------------------------------

CREATE VIEW public.branch_archive_events_admin AS
SELECT e.*
FROM public.branch_archive_events e
WHERE
  public.has_role(auth.uid(), 'admin'::public.app_role)
  OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  OR public.has_role(auth.uid(), 'owner'::public.app_role);

REVOKE ALL ON public.branch_archive_events_admin FROM PUBLIC;
REVOKE ALL ON public.branch_archive_events_admin FROM anon;
GRANT  SELECT ON public.branch_archive_events_admin TO authenticated;