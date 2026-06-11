-- Phase 2C-1: PBA ordered_qty / remaining_qty recompute helper.
-- Inert after creation: NO EXECUTE GRANTS are added.
-- Caller contract: caller MUST already hold a FOR UPDATE row-lock on the
-- target row of public.position_branch_allocations identified by
-- (p_position_id, p_branch_id) BEFORE invoking this helper.
-- Helper does not acquire that lock itself and does not lock allocation parts.

CREATE OR REPLACE FUNCTION public.recompute_pba_ordered_qty(
    p_position_id uuid,
    p_branch_id   uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_pba_id        uuid;
    v_approved      numeric;
    v_cancelled     numeric;
    v_new_ordered   numeric;
    v_new_remaining numeric;
BEGIN
    -- Argument guard.
    IF p_position_id IS NULL OR p_branch_id IS NULL THEN
        RAISE EXCEPTION
            'recompute_pba_ordered_qty: p_position_id and p_branch_id must be non-null'
            USING ERRCODE = '22023';
    END IF;

    -- Read the target PBA row. Caller is contracted to already hold its row-lock,
    -- so this is a plain SELECT (no FOR UPDATE here -- helper must not hide
    -- the global lock-order rule "lock PBA before parts").
    SELECT pba.id,
           pba.approved_qty,
           pba.cancelled_qty
      INTO v_pba_id, v_approved, v_cancelled
      FROM public.position_branch_allocations AS pba
     WHERE pba.position_id = p_position_id
       AND pba.branch_id   = p_branch_id;

    -- Missing-PBA behavior: controlled exception. No insert. No silent no-op.
    IF v_pba_id IS NULL THEN
        RAISE EXCEPTION
            'recompute_pba_ordered_qty: no position_branch_allocations row for position_id=% branch_id=%',
            p_position_id, p_branch_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Recompute ordered_qty from existing allocation-part facts.
    -- Read-only over manager_offer_allocation_parts (no FOR UPDATE here).
    SELECT COALESCE(SUM(p.pallets), 0)
      INTO v_new_ordered
      FROM public.manager_offer_allocation_parts AS p
      JOIN public.manager_offers                 AS o
        ON o.id = p.offer_id
     WHERE p.status      = 'ordered'
       AND p.branch_id   = p_branch_id
       AND o.position_id = p_position_id;

    -- Cut quantity (requested - approved) is intentionally NOT included in
    -- remaining_qty. Future non-'ordered' statuses are excluded by the
    -- status filter above and require no code change here.
    v_new_remaining := GREATEST(0::numeric, v_approved - v_new_ordered - v_cancelled);

    -- Single-row UPDATE on the already-locked PBA row.
    -- Does NOT touch: requested_qty, approved_qty, cancelled_qty, status,
    -- decision_notes, decided_at, decided_by, created_at, position_id, branch_id, id.
    UPDATE public.position_branch_allocations AS pba
       SET ordered_qty   = v_new_ordered,
           remaining_qty = v_new_remaining,
           updated_at    = now()
     WHERE pba.id = v_pba_id;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_pba_ordered_qty(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_pba_ordered_qty(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.recompute_pba_ordered_qty(uuid, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.recompute_pba_ordered_qty(uuid, uuid) FROM service_role;
-- No GRANT EXECUTE in Phase 2C-1. Helper is inert.