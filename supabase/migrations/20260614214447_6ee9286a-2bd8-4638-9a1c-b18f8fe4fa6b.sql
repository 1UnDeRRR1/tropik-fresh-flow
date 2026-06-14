
SET LOCAL session_replication_role = 'replica';

DO $$
DECLARE
  v_rec record;
  v_snapshot_id uuid;
  v_inserted int := 0;
  v_archived int := 0;
BEGIN
  FOR v_rec IN
    SELECT
      d.branch_id,
      si.position_id,
      d.shipment_id,
      (SELECT sh.eta               FROM public.shipments sh WHERE sh.id = d.shipment_id) AS eta,
      (SELECT sh.import_manager_id FROM public.shipments sh WHERE sh.id = d.shipment_id) AS responsible_manager_id,
      SUM(di.pallets)::numeric        AS pallets,
      MAX(si.caliber)                 AS caliber,
      MAX(si.final_cost_indicative)   AS cost_ind,
      MAX(si.final_cost_invoice)      AS cost_inv
    FROM public.distribution_items di
    JOIN public.distributions d   ON d.id  = di.distribution_id
    JOIN public.shipment_items si ON si.id = di.shipment_item_id
    JOIN public.shipments sh      ON sh.id = d.shipment_id
    WHERE sh.eta <= DATE '2026-06-15'
      AND sh.archived_at IS NULL
      AND sh.status <> 'cancelled'
      AND di.pallets > 0
      AND si.position_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.branch_archive_results bar
         WHERE bar.branch_id   = d.branch_id
           AND bar.position_id = si.position_id
           AND bar.shipment_id = d.shipment_id
           AND bar.event_type  = 'delivered'
      )
    GROUP BY d.branch_id, si.position_id, d.shipment_id
  LOOP
    INSERT INTO public.archive_promise_snapshots (
      position_id, branch_id, responsible_manager_id,
      source, source_shipment_id,
      requested_qty, promise_eta_snapshot,
      caliber, pallet_qty,
      cost_indicative_usd_snapshot, cost_invoice_usd_snapshot,
      status, resolution, resolved_at, notes
    ) VALUES (
      v_rec.position_id, v_rec.branch_id, v_rec.responsible_manager_id,
      'shipment_link', v_rec.shipment_id,
      v_rec.pallets, v_rec.eta,
      v_rec.caliber, v_rec.pallets,
      v_rec.cost_ind, v_rec.cost_inv,
      'resolved', 'delivered', now(),
      'Test-data cleanup: ETA <= 2026-06-15 -> Delivered archive'
    )
    RETURNING snapshot_id INTO v_snapshot_id;

    INSERT INTO public.branch_archive_results (
      snapshot_id, position_id, branch_id, responsible_manager_id,
      event_type, delivered_qty, shared_qty, cut_qty,
      actual_eta, actual_cost_indicative_usd, actual_cost_invoice_usd,
      is_split_shipment, shipment_id, occurred_at, event_qty, notes
    ) VALUES (
      v_snapshot_id, v_rec.position_id, v_rec.branch_id, v_rec.responsible_manager_id,
      'delivered', v_rec.pallets, 0, 0,
      v_rec.eta, v_rec.cost_ind, v_rec.cost_inv,
      false, v_rec.shipment_id, now(), v_rec.pallets,
      'Test-data cleanup: ETA <= 2026-06-15'
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  UPDATE public.shipments
     SET unloaded_at = COALESCE(unloaded_at, now())
   WHERE eta <= DATE '2026-06-15'
     AND archived_at IS NULL
     AND status <> 'cancelled'
     AND unloaded_at IS NULL;

  UPDATE public.shipments
     SET archived_at    = now(),
         archive_due_at = COALESCE(archive_due_at, now())
   WHERE eta <= DATE '2026-06-15'
     AND archived_at IS NULL
     AND status <> 'cancelled';
  GET DIAGNOSTICS v_archived = ROW_COUNT;

  RAISE NOTICE 'cleanup: % delivered archive rows inserted, % shipments archived',
    v_inserted, v_archived;
END $$;
