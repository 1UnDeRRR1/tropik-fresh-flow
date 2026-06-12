
-- =========================================================================
-- Wave 2: archive validation + snapshot triggers (v5.2 corrected)
-- =========================================================================

-- 1) Partial unique index: one pending snapshot per branch_stock_request row
CREATE UNIQUE INDEX IF NOT EXISTS archive_snap_unique_pending_stock_request
  ON public.archive_promise_snapshots (source_response_id)
  WHERE status = 'pending'::archive_snapshot_status
    AND source = 'branch_stock_request'::archive_snapshot_source
    AND source_response_id IS NOT NULL;

-- 2) CHECK on branch_requests: approved requires positive approved_qty
ALTER TABLE public.branch_requests
  DROP CONSTRAINT IF EXISTS br_approved_positive_when_approved;
ALTER TABLE public.branch_requests
  ADD CONSTRAINT br_approved_positive_when_approved
  CHECK (
    status <> 'approved'::branch_request_status
    OR (approved_qty IS NOT NULL AND approved_qty > 0)
  ) NOT VALID;

-- =========================================================================
-- 3) tg_fn_validate_mor_refusal
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tg_fn_validate_mor_refusal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.requested_pallets IS NULL OR NEW.requested_pallets <= 0 THEN
      RAISE EXCEPTION 'MOR_INSERT_REQUESTED_NOT_POSITIVE';
    END IF;
    IF NEW.refused_at IS NOT NULL OR NEW.refused_by IS NOT NULL THEN
      RAISE EXCEPTION 'MOR_INSERT_REFUSAL_NOT_ALLOWED';
    END IF;
    IF NEW.approved_pallets IS NOT NULL THEN
      RAISE EXCEPTION 'MOR_INSERT_APPROVED_MUST_BE_NULL';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE-only below

  IF OLD.approved_pallets IS NULL
     AND NEW.approved_pallets IS NOT NULL
     AND NEW.approved_pallets <= 0
     AND NEW.refused_at IS NULL THEN
    RAISE EXCEPTION 'MOR_INITIAL_APPROVAL_MUST_BE_POSITIVE';
  END IF;

  IF NEW.refused_at IS NOT NULL AND OLD.refused_at IS NULL THEN
    IF OLD.approved_pallets IS NOT NULL THEN
      RAISE EXCEPTION 'MOR_REFUSAL_AFTER_APPROVAL_FORBIDDEN';
    END IF;
    IF NEW.approved_pallets IS NOT NULL THEN
      RAISE EXCEPTION 'MOR_REFUSAL_MUST_KEEP_APPROVED_NULL';
    END IF;
    IF NEW.refused_by IS NULL THEN
      RAISE EXCEPTION 'MOR_REFUSAL_REQUIRES_REFUSED_BY';
    END IF;
  END IF;

  IF OLD.refused_at IS NOT NULL THEN
    IF NEW.refused_at IS DISTINCT FROM OLD.refused_at THEN
      RAISE EXCEPTION 'MOR_REFUSED_AT_IMMUTABLE';
    END IF;
    IF NEW.refused_by IS DISTINCT FROM OLD.refused_by THEN
      RAISE EXCEPTION 'MOR_REFUSED_BY_IMMUTABLE';
    END IF;
    IF NEW.approved_pallets IS NOT NULL THEN
      RAISE EXCEPTION 'MOR_REFUSED_APPROVED_MUST_STAY_NULL';
    END IF;
  END IF;

  IF OLD.approved_pallets IS NULL
     AND OLD.refused_at IS NULL
     AND NEW.requested_pallets IS DISTINCT FROM OLD.requested_pallets THEN
    IF NEW.requested_pallets IS NULL OR NEW.requested_pallets <= 0 THEN
      RAISE EXCEPTION 'MOR_REQUESTED_EDIT_MUST_BE_POSITIVE';
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.tg_fn_validate_mor_refusal() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_fn_validate_mor_refusal() FROM anon;
REVOKE ALL ON FUNCTION public.tg_fn_validate_mor_refusal() FROM authenticated;

DROP TRIGGER IF EXISTS tg_validate_mor_refusal ON public.manager_offer_responses;
CREATE TRIGGER tg_validate_mor_refusal
BEFORE INSERT OR UPDATE ON public.manager_offer_responses
FOR EACH ROW EXECUTE FUNCTION public.tg_fn_validate_mor_refusal();

-- =========================================================================
-- 4) tg_fn_archive_branch_response
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tg_fn_archive_branch_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_offer        record;
  v_op           record;
  v_snap_id      uuid;
  v_result_id    uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.requested_pallets IS NULL OR NEW.requested_pallets <= 0 THEN
      RAISE EXCEPTION 'MOR_ARCHIVE_INSERT_REQUESTED_NOT_POSITIVE';
    END IF;

    SELECT mo.id, mo.position_id, mo.import_manager_id, mo.expected_eta,
           mo.indicative_cost_usd, mo.invoice_cost_usd
      INTO v_offer
      FROM public.manager_offers mo
     WHERE mo.id = NEW.offer_id;

    IF v_offer.position_id IS NULL THEN
      RAISE EXCEPTION 'MOR_ARCHIVE_OFFER_HAS_NO_POSITION %', NEW.offer_id;
    END IF;

    SELECT op.product_id, op.product_origin_country_id, op.variety_id,
           op.caliber, op.packaging, op.pallet_qty
      INTO v_op
      FROM public.operational_positions op
     WHERE op.position_id = v_offer.position_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'MOR_ARCHIVE_NO_OPERATIONAL_POSITION %', v_offer.position_id;
    END IF;

    INSERT INTO public.archive_promise_snapshots(
      position_id, branch_id, responsible_manager_id, source,
      source_offer_id, source_response_id,
      requested_qty, promise_eta_snapshot,
      product_id, product_origin_country_id, variety_id,
      caliber, packaging, pallet_qty,
      cost_indicative_usd_snapshot, cost_invoice_usd_snapshot,
      status
    ) VALUES (
      v_offer.position_id, NEW.branch_id, v_offer.import_manager_id, 'branch_response',
      NEW.offer_id, NEW.id,
      NEW.requested_pallets, v_offer.expected_eta,
      v_op.product_id, v_op.product_origin_country_id, v_op.variety_id,
      v_op.caliber, v_op.packaging, v_op.pallet_qty,
      v_offer.indicative_cost_usd, v_offer.invoice_cost_usd,
      'pending'
    )
    ON CONFLICT (source_response_id)
      WHERE status = 'pending'::archive_snapshot_status
        AND source = 'branch_response'::archive_snapshot_source
        AND source_response_id IS NOT NULL
      DO NOTHING;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.approved_pallets IS NULL AND OLD.refused_at IS NULL THEN
      DELETE FROM public.archive_promise_snapshots
       WHERE source = 'branch_response'::archive_snapshot_source
         AND source_response_id = OLD.id
         AND status = 'pending'::archive_snapshot_status;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: edit requested_pallets while still fully pending
  IF OLD.approved_pallets IS NULL AND OLD.refused_at IS NULL
     AND NEW.refused_at IS NULL
     AND NEW.requested_pallets IS DISTINCT FROM OLD.requested_pallets THEN
    UPDATE public.archive_promise_snapshots s
       SET requested_qty = NEW.requested_pallets,
           promise_eta_snapshot = (
             SELECT mo.expected_eta FROM public.manager_offers mo WHERE mo.id = NEW.offer_id
           )
     WHERE s.source = 'branch_response'::archive_snapshot_source
       AND s.source_response_id = NEW.id
       AND s.status = 'pending'::archive_snapshot_status;
  END IF;

  -- UPDATE: refusal transition NULL -> NOT NULL
  IF OLD.refused_at IS NULL AND NEW.refused_at IS NOT NULL THEN
    SELECT snapshot_id INTO v_snap_id
      FROM public.archive_promise_snapshots
     WHERE source = 'branch_response'::archive_snapshot_source
       AND source_response_id = NEW.id
       AND status = 'pending'::archive_snapshot_status
     FOR UPDATE;

    IF v_snap_id IS NULL THEN
      RAISE EXCEPTION 'MOR_REFUSAL_NO_PENDING_SNAPSHOT %', NEW.id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.branch_archive_results
       WHERE snapshot_id = v_snap_id
         AND event_type = 'refused'::archive_visible_event_type
    ) THEN
      INSERT INTO public.branch_archive_results(
        snapshot_id, position_id, branch_id, responsible_manager_id,
        event_type, event_qty, delivered_qty, shared_qty, cut_qty,
        occurred_at, actual_eta
      )
      SELECT s.snapshot_id, s.position_id, s.branch_id, s.responsible_manager_id,
             'refused'::archive_visible_event_type, s.requested_qty, 0, 0, 0,
             NEW.refused_at,
             (NEW.refused_at AT TIME ZONE 'Europe/Kyiv')::date
        FROM public.archive_promise_snapshots s
       WHERE s.snapshot_id = v_snap_id
      RETURNING result_id INTO v_result_id;

      UPDATE public.archive_promise_snapshots
         SET status = 'resolved'::archive_snapshot_status,
             resolution = NULL,
             resolved_at = now(),
             visible_archive_event_id = v_result_id
       WHERE snapshot_id = v_snap_id;
    END IF;
  END IF;

  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.tg_fn_archive_branch_response() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_fn_archive_branch_response() FROM anon;
REVOKE ALL ON FUNCTION public.tg_fn_archive_branch_response() FROM authenticated;

DROP TRIGGER IF EXISTS tg_archive_branch_response ON public.manager_offer_responses;
CREATE TRIGGER tg_archive_branch_response
AFTER INSERT OR UPDATE OR DELETE ON public.manager_offer_responses
FOR EACH ROW EXECUTE FUNCTION public.tg_fn_archive_branch_response();

-- =========================================================================
-- 5) tg_fn_archive_branch_stock_request
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tg_fn_archive_branch_stock_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_position_id  uuid;
  v_manager_id   uuid;
  v_eta          date;
  v_op           record;
  v_snap_id      uuid;
  v_result_id    uuid;
BEGIN
  -- Scope guard: only free_offer requests
  IF TG_OP = 'DELETE' THEN
    IF OLD.request_type <> 'free_offer' THEN
      RETURN OLD;
    END IF;
  ELSE
    IF NEW.request_type <> 'free_offer' THEN
      RETURN NEW;
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.pallets IS NULL OR NEW.pallets <= 0 THEN
      RAISE EXCEPTION 'BSR_INSERT_PALLETS_MUST_BE_POSITIVE';
    END IF;

    IF NEW.shipment_item_id IS NOT NULL THEN
      SELECT si.position_id INTO v_position_id
        FROM public.shipment_items si
       WHERE si.id = NEW.shipment_item_id;
    END IF;

    IF v_position_id IS NULL THEN
      RAISE EXCEPTION 'BSR_INSERT_NO_POSITION_FOR_ITEM %', NEW.shipment_item_id;
    END IF;

    IF NEW.shipment_id IS NOT NULL THEN
      SELECT s.import_manager_id, s.eta INTO v_manager_id, v_eta
        FROM public.shipments s
       WHERE s.id = NEW.shipment_id;
    END IF;

    IF v_manager_id IS NULL AND NEW.from_offer_id IS NOT NULL THEN
      SELECT mo.import_manager_id INTO v_manager_id
        FROM public.manager_offers mo
       WHERE mo.id = NEW.from_offer_id;
    END IF;

    IF v_manager_id IS NULL THEN
      RAISE EXCEPTION 'BSR_RESPONSIBLE_MANAGER_REQUIRED shipment=% offer=%',
        NEW.shipment_id, NEW.from_offer_id;
    END IF;

    SELECT op.product_id, op.product_origin_country_id, op.variety_id,
           op.caliber, op.packaging, op.pallet_qty
      INTO v_op
      FROM public.operational_positions op
     WHERE op.position_id = v_position_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'BSR_INSERT_NO_OPERATIONAL_POSITION %', v_position_id;
    END IF;

    INSERT INTO public.archive_promise_snapshots(
      position_id, branch_id, responsible_manager_id, source,
      source_response_id, source_shipment_id,
      requested_qty, promise_eta_snapshot,
      product_id, product_origin_country_id, variety_id,
      caliber, packaging, pallet_qty,
      requested_sale_price_snapshot, requested_sale_currency_snapshot,
      status
    )
    VALUES (
      v_position_id, NEW.branch_id, v_manager_id, 'branch_stock_request',
      NEW.id, NEW.shipment_id,
      NEW.pallets, v_eta,
      v_op.product_id, v_op.product_origin_country_id, v_op.variety_id,
      v_op.caliber, v_op.packaging, v_op.pallet_qty,
      NEW.sale_price, NEW.sale_currency,
      'pending'
    )
    ON CONFLICT (source_response_id)
      WHERE status = 'pending'::archive_snapshot_status
        AND source = 'branch_stock_request'::archive_snapshot_source
        AND source_response_id IS NOT NULL
      DO NOTHING;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'pending'::branch_request_status THEN
      DELETE FROM public.archive_promise_snapshots
       WHERE source = 'branch_stock_request'::archive_snapshot_source
         AND source_response_id = OLD.id
         AND status = 'pending'::archive_snapshot_status;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE only below

  -- cancelled: silent-close only if branch withdrew BEFORE manager decision
  IF NEW.status = 'cancelled'::branch_request_status
     AND OLD.status <> 'cancelled'::branch_request_status THEN
    IF OLD.status = 'pending'::branch_request_status THEN
      DELETE FROM public.archive_promise_snapshots
       WHERE source = 'branch_stock_request'::archive_snapshot_source
         AND source_response_id = NEW.id
         AND status = 'pending'::archive_snapshot_status;
    END IF;
    RETURN NEW;
  END IF;

  -- pallets / sale_price edit while still pending
  IF OLD.status = 'pending'::branch_request_status
     AND NEW.status = 'pending'::branch_request_status THEN
    IF NEW.pallets IS NULL OR NEW.pallets <= 0 THEN
      RAISE EXCEPTION 'BSR_PENDING_PALLETS_MUST_BE_POSITIVE';
    END IF;
    UPDATE public.archive_promise_snapshots
       SET requested_qty = NEW.pallets,
           requested_sale_price_snapshot = NEW.sale_price,
           requested_sale_currency_snapshot = NEW.sale_currency
     WHERE source = 'branch_stock_request'::archive_snapshot_source
       AND source_response_id = NEW.id
       AND status = 'pending'::archive_snapshot_status;
    RETURN NEW;
  END IF;

  -- rejected: refused result ONLY from pending -> rejected
  IF NEW.status = 'rejected'::branch_request_status
     AND OLD.status <> 'rejected'::branch_request_status THEN
    IF OLD.status <> 'pending'::branch_request_status THEN
      RAISE EXCEPTION 'BSR_REJECTED_NOT_FROM_PENDING old=% new=%', OLD.status, NEW.status;
    END IF;

    SELECT snapshot_id INTO v_snap_id
      FROM public.archive_promise_snapshots
     WHERE source = 'branch_stock_request'::archive_snapshot_source
       AND source_response_id = NEW.id
       AND status = 'pending'::archive_snapshot_status
     FOR UPDATE;

    IF v_snap_id IS NULL THEN
      RAISE EXCEPTION 'BSR_REJECTED_NO_PENDING_SNAPSHOT %', NEW.id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.branch_archive_results
       WHERE snapshot_id = v_snap_id
         AND event_type = 'refused'::archive_visible_event_type
    ) THEN
      INSERT INTO public.branch_archive_results(
        snapshot_id, position_id, branch_id, responsible_manager_id,
        event_type, event_qty, delivered_qty, shared_qty, cut_qty,
        shipment_id, occurred_at, actual_eta
      )
      SELECT s.snapshot_id, s.position_id, s.branch_id, s.responsible_manager_id,
             'refused'::archive_visible_event_type, s.requested_qty, 0, 0, 0,
             NEW.shipment_id, now(),
             (now() AT TIME ZONE 'Europe/Kyiv')::date
        FROM public.archive_promise_snapshots s
       WHERE s.snapshot_id = v_snap_id
      RETURNING result_id INTO v_result_id;

      UPDATE public.archive_promise_snapshots
         SET status = 'resolved'::archive_snapshot_status,
             resolution = NULL,
             resolved_at = now(),
             visible_archive_event_id = v_result_id
       WHERE snapshot_id = v_snap_id;
    END IF;
    RETURN NEW;
  END IF;

  -- approved with approved_qty > 0: no visible result; snapshot stays pending for S3.
  RETURN NEW;
END
$fn$;

REVOKE ALL ON FUNCTION public.tg_fn_archive_branch_stock_request() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_fn_archive_branch_stock_request() FROM anon;
REVOKE ALL ON FUNCTION public.tg_fn_archive_branch_stock_request() FROM authenticated;

DROP TRIGGER IF EXISTS tg_archive_branch_stock_request ON public.branch_requests;
CREATE TRIGGER tg_archive_branch_stock_request
AFTER INSERT OR UPDATE OR DELETE ON public.branch_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_fn_archive_branch_stock_request();
