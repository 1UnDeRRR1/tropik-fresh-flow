// Soft-cancel a shipment + write cancelled archive events.
// Replaces the previous hard DELETE on shipments from the UI.
//
// Allowed roles:
//   - super_admin / admin: may cancel any shipment.
//   - import_manager: may cancel only own shipments
//     (created_by === userId OR import_manager_id === userId
//      OR import_manager_id === current_import_manager_id(uid)).
//
// Behavior:
//   1. Verify caller + ownership.
//   2. UPDATE shipments SET status='cancelled', cancelled_by, updated_at.
//      The existing DB trigger stamps cancelled_at and archive_due_at.
//   3. Call public.archive_write_cancelled_for_shipment(id, reason) via
//      service_role (admin client). The RPC is service_role-only by design.
//   4. If archive write fails, attempt to revert status to the previous
//      value and surface the failure to the user.
//
// NO hard delete. NO child-row deletion. NO DB schema change.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type CancelInput = { shipmentId: string; reason?: string };
type DeleteEmptyDraftInput = { shipmentId: string };

function validateCancelShipment(input: unknown): CancelInput {
  if (!input || typeof input !== "object") throw new Response("Bad input", { status: 400 });
  const o = input as Record<string, unknown>;
  const id = typeof o.shipmentId === "string" ? o.shipmentId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Response("Bad shipmentId", { status: 400 });
  const reason = typeof o.reason === "string" ? o.reason.slice(0, 500) : undefined;
  return { shipmentId: id, reason };
}

function validateDeleteEmptyDraft(input: unknown): DeleteEmptyDraftInput {
  if (!input || typeof input !== "object") throw new Response("Bad input", { status: 400 });
  const o = input as Record<string, unknown>;
  const id = typeof o.shipmentId === "string" ? o.shipmentId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Response("Bad shipmentId", { status: 400 });
  return { shipmentId: id };
}

export const cancelShipment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateCancelShipment)
  .handler(async ({ data, context }) => {
    const { shipmentId, reason } = data;
    const { supabase, userId } = context;

    // 1. Authorize: super_admin / admin OR ownership for import_manager.
    const [adminCheck, superCheck, mgrCheck] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "import_manager" }),
    ]);
    const isAdmin = adminCheck.data === true || superCheck.data === true;
    const isImportManager = mgrCheck.data === true;
    if (!isAdmin && !isImportManager) {
      throw new Response("Недостатньо прав для скасування поставки", { status: 403 });
    }

    // Load shipment (RLS as user). If the user can't read it, treat as
    // forbidden — they have no business cancelling it.
    const { data: ship, error: readErr } = await supabase
      .from("shipments")
      .select("id, code, status, created_by, import_manager_id")
      .eq("id", shipmentId)
      .maybeSingle();
    if (readErr) throw new Response(readErr.message, { status: 500 });
    if (!ship) throw new Response("Поставку не знайдено", { status: 404 });

    if (!isAdmin) {
      const { data: mgrId } = await supabase.rpc("current_import_manager_id");
      const owns =
        ship.created_by === userId ||
        ship.import_manager_id === userId ||
        (!!mgrId && ship.import_manager_id === mgrId);
      if (!owns) {
        throw new Response("Можна скасувати лише власну поставку", { status: 403 });
      }
    }

    if (ship.status === "cancelled") {
      return { ok: true as const, alreadyCancelled: true, code: ship.code, archived: 0 };
    }
    const previousStatus = ship.status;

    // 2. Soft cancel via admin client (avoids any RLS edge case on the
    // update and matches the privilege level needed for the archive RPC).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error: updErr } = await supabaseAdmin
      .from("shipments")
      .update({
        status: "cancelled",
        cancelled_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", shipmentId);
    if (updErr) {
      throw new Response(`Не вдалося скасувати поставку: ${updErr.message}`, { status: 500 });
    }

    // 3. Archive write — service_role only.
    const safeReason = reason && reason.trim().length > 0
      ? reason
      : `Shipment cancelled from UI: ${ship.code ?? shipmentId}`;

    const { data: archiveRes, error: archiveErr } = await supabaseAdmin.rpc(
      "archive_write_cancelled_for_shipment",
      { p_shipment_id: shipmentId, p_reason: safeReason },
    );

    if (archiveErr) {
      // 4. Attempt rollback of shipment status. Report either way.
      const { error: revertErr } = await supabaseAdmin
        .from("shipments")
        .update({
          status: previousStatus,
          cancelled_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", shipmentId);
      const tail = revertErr
        ? ` (rollback failed: ${revertErr.message})`
        : " (статус поставки відновлено)";
      throw new Response(
        `Архівний запис не створено: ${archiveErr.message}${tail}`,
        { status: 500 },
      );
    }

    const archivedCount = Array.isArray(archiveRes) ? archiveRes.length : 0;
    return {
      ok: true as const,
      alreadyCancelled: false,
      code: ship.code,
      archived: archivedCount,
    };
  });

export const deleteEmptyDraftShipment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateDeleteEmptyDraft)
  .handler(async ({ data, context }) => {
    const { shipmentId } = data;
    const { supabase, userId } = context;

    const [adminCheck, superCheck] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
    ]);
    const isAdmin = adminCheck.data === true || superCheck.data === true;

    const { data: visibleShip, error: readErr } = await supabase
      .from("shipments")
      .select("id, status, created_by, import_manager_id")
      .eq("id", shipmentId)
      .maybeSingle();
    if (readErr) throw new Response(readErr.message, { status: 500 });
    if (!visibleShip) return { ok: true as const, deleted: false, reason: "not_found" as const };

    if (!isAdmin) {
      const { data: mgrId } = await supabase.rpc("current_import_manager_id");
      const owns =
        visibleShip.created_by === userId ||
        visibleShip.import_manager_id === userId ||
        (!!mgrId && visibleShip.import_manager_id === mgrId);
      if (!owns) {
        throw new Response("Можна видалити лише власну порожню чернетку поставки", { status: 403 });
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ship, error: shipErr } = await supabaseAdmin
      .from("shipments")
      .select("id, status, vehicle_id")
      .eq("id", shipmentId)
      .maybeSingle();
    if (shipErr) throw new Response(shipErr.message, { status: 500 });
    if (!ship) return { ok: true as const, deleted: false, reason: "not_found" as const };
    if (ship.status !== "draft") {
      return { ok: true as const, deleted: false, reason: "not_draft" as const };
    }

    const { data: items, error: itemsErr } = await supabaseAdmin
      .from("shipment_items")
      .select("id, product_name, pallet_count, position_id")
      .eq("shipment_id", shipmentId);
    if (itemsErr) throw new Response(itemsErr.message, { status: 500 });
    const itemRows = items ?? [];

    for (const item of itemRows) {
      const name = (item.product_name ?? "").trim();
      const hasRealName = name.length > 0 && name !== "Новий товар";
      if (hasRealName || Number(item.pallet_count ?? 0) > 0 || item.position_id) {
        return { ok: true as const, deleted: false, reason: "has_items" as const };
      }
    }

    const itemIds = itemRows.map((item) => item.id);
    const probe = async (
      q: PromiseLike<{ data: unknown; error: unknown }>,
    ): Promise<"empty" | "hit" | "error"> => {
      try {
        const { data: probeData, error } = await q;
        if (error) return "error";
        return Array.isArray(probeData) ? (probeData.length > 0 ? "hit" : "empty") : probeData ? "hit" : "empty";
      } catch {
        return "error";
      }
    };

    if (itemIds.length > 0) {
      const linkProbe = await probe(
        supabaseAdmin.from("manager_offer_shipment_links").select("id").in("shipment_item_id", itemIds).limit(1),
      );
      if (linkProbe !== "empty") return { ok: true as const, deleted: false, reason: "business_links" as const };

      const allocItemProbe = await probe(
        supabaseAdmin.from("manager_offer_allocation_parts").select("id").in("shipment_item_id", itemIds).limit(1),
      );
      if (allocItemProbe !== "empty") return { ok: true as const, deleted: false, reason: "business_links" as const };

      const distItemProbe = await probe(
        supabaseAdmin.from("distribution_items").select("id").in("shipment_item_id", itemIds).limit(1),
      );
      if (distItemProbe !== "empty") return { ok: true as const, deleted: false, reason: "business_links" as const };
    }

    const probes = await Promise.all([
      probe(supabaseAdmin.from("manager_offer_allocation_parts").select("id").eq("shipment_id", shipmentId).limit(1)),
      probe(supabaseAdmin.from("distributions").select("id").eq("shipment_id", shipmentId).limit(1)),
      probe(supabaseAdmin.from("archive_promise_snapshots").select("id").eq("source_shipment_id", shipmentId).limit(1)),
      probe(supabaseAdmin.from("branch_archive_results").select("result_id").eq("shipment_id", shipmentId).limit(1)),
      probe(supabaseAdmin.from("position_shipment_links").select("id").eq("shipment_id", shipmentId).limit(1)),
      probe(supabaseAdmin.from("manager_offers").select("id").eq("linked_shipment_id", shipmentId).limit(1)),
    ]);
    if (probes.some((result) => result !== "empty")) {
      return { ok: true as const, deleted: false, reason: "business_links" as const };
    }

    if (itemIds.length > 0) {
      const { error: delItemsErr } = await supabaseAdmin
        .from("shipment_items")
        .delete()
        .in("id", itemIds);
      if (delItemsErr) throw new Response(delItemsErr.message, { status: 500 });
    }

    const vehicleId = ship.vehicle_id ?? null;
    const { error: delShipErr } = await supabaseAdmin
      .from("shipments")
      .delete()
      .eq("id", shipmentId);
    if (delShipErr) throw new Response(delShipErr.message, { status: 500 });

    let vehicleDeleted = false;
    if (vehicleId) {
      const { data: remainingShipments } = await supabaseAdmin
        .from("shipments")
        .select("id")
        .eq("vehicle_id", vehicleId)
        .limit(1);
      if (!remainingShipments || remainingShipments.length === 0) {
        const { error: delVehicleErr } = await supabaseAdmin
          .from("vehicles" as never)
          .delete()
          .eq("id", vehicleId);
        vehicleDeleted = !delVehicleErr;
      }
    }

    return { ok: true as const, deleted: true, vehicleDeleted };
  });
