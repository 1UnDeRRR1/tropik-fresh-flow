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

function validate(input: unknown): CancelInput {
  if (!input || typeof input !== "object") throw new Response("Bad input", { status: 400 });
  const o = input as Record<string, unknown>;
  const id = typeof o.shipmentId === "string" ? o.shipmentId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Response("Bad shipmentId", { status: 400 });
  const reason = typeof o.reason === "string" ? o.reason.slice(0, 500) : undefined;
  return { shipmentId: id, reason };
}

export const cancelShipment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validate)
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
