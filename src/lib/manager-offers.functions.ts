// Build F — controlled manager offer cancellation with archive event.
//
// Replaces the previous frontend pattern of:
//   supabase.from("manager_offers").update({ status: "deleted" }).eq("id", id)
// which silently hid confirmed branch promises without writing any Archive.
//
// Allowed roles:
//   - super_admin / admin: may cancel any offer.
//   - import_manager: may cancel only own/responsible offer
//     (created_by === userId OR import_manager_id === userId
//      OR import_manager_id === current_import_manager_id(uid)).
//
// Behavior:
//   1. Verify caller + ownership.
//   2. Invoke service_role-only RPC `archive_cancel_manager_offer(id, reason)`.
//      The RPC:
//        - For each approved branch response (approved>0, not refused), reuses
//          or creates an `archive_promise_snapshots` row with the EXISTING
//          enum value source='branch_response' (no enum change in this Build),
//          then calls `archive_write_cancelled_for_snapshot`.
//        - Marks `manager_offer_allocation_parts.status` 'ordered' → 'cancelled'.
//        - Sets `manager_offers.status='deleted'` only after archive writes.
//        - Idempotent — re-running produces no duplicates.
//   3. Return summary counts to the UI.
//
// NO direct archive table writes. NO grants to authenticated. NO enum change.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type CancelInput = { offerId: string; reason?: string };

function validate(input: unknown): CancelInput {
  if (!input || typeof input !== "object") throw new Response("Bad input", { status: 400 });
  const o = input as Record<string, unknown>;
  const id = typeof o.offerId === "string" ? o.offerId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Response("Bad offerId", { status: 400 });
  const reason = typeof o.reason === "string" ? o.reason.slice(0, 500) : undefined;
  return { offerId: id, reason };
}

type RpcRow = {
  action: string | null;
  detail: string | null;
  response_id: string | null;
  snapshot_id: string | null;
};

export const cancelManagerOffer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validate)
  .handler(async ({ data, context }) => {
    const { offerId, reason } = data;
    const { supabase, userId } = context;

    // 1. Authorize.
    const [adminCheck, superCheck, mgrCheck] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "import_manager" }),
    ]);
    const isAdmin = adminCheck.data === true || superCheck.data === true;
    const isImportManager = mgrCheck.data === true;
    if (!isAdmin && !isImportManager) {
      throw new Response("Недостатньо прав для скасування пропозиції", { status: 403 });
    }

    // Read offer under user RLS — if they can't see it, treat as forbidden.
    const { data: offer, error: readErr } = await supabase
      .from("manager_offers")
      .select("id, status, created_by, import_manager_id, product_name")
      .eq("id", offerId)
      .maybeSingle();
    if (readErr) throw new Response(readErr.message, { status: 500 });
    if (!offer) throw new Response("Пропозицію не знайдено", { status: 404 });

    if (!isAdmin) {
      const { data: mgrId } = await supabase.rpc("current_import_manager_id");
      const owns =
        offer.created_by === userId ||
        offer.import_manager_id === userId ||
        (!!mgrId && offer.import_manager_id === mgrId);
      if (!owns) {
        throw new Response("Можна скасувати лише власну пропозицію", { status: 403 });
      }
    }

    // 2. Call service-role-only RPC.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const safeReason =
      reason && reason.trim().length > 0
        ? reason
        : `Manager offer cancelled from UI: ${offer.product_name ?? offerId}`;

    const { data: rpcRows, error: rpcErr } = await supabaseAdmin.rpc(
      "archive_cancel_manager_offer",
      { p_offer_id: offerId, p_reason: safeReason },
    );
    if (rpcErr) {
      throw new Response(`Не вдалося скасувати пропозицію: ${rpcErr.message}`, { status: 500 });
    }

    const rows = (rpcRows ?? []) as RpcRow[];

    // Surface blockers without claiming success.
    const blocker = rows.find((r) => r.action === "blocked" || r.action === "error");
    if (blocker && blocker.detail !== "archive_write_failed_status_not_changed") {
      throw new Response(`Скасування заблоковано: ${blocker.detail ?? "unknown"}`, {
        status: 409,
      });
    }
    if (blocker && blocker.detail === "archive_write_failed_status_not_changed") {
      throw new Response("Архівний запис не створено — статус пропозиції не змінено", {
        status: 500,
      });
    }

    // Build 1: post-RPC verification. The UI must never see "success" unless
    // the row is actually deleted in DB. Re-read status via service role so
    // RLS/visibility cannot mask the real state.
    const { data: verifyRow, error: verifyErr } = await supabaseAdmin
      .from("manager_offers")
      .select("id, status")
      .eq("id", offerId)
      .maybeSingle();
    if (verifyErr) {
      throw new Response(
        `Не вдалося перевірити статус пропозиції після скасування: ${verifyErr.message}`,
        { status: 500 },
      );
    }
    if (!verifyRow) {
      throw new Response(
        "Пропозицію не знайдено після скасування — статус не підтверджено",
        { status: 500 },
      );
    }
    const finalStatus = String(verifyRow.status ?? "");
    if (finalStatus !== "deleted") {
      throw new Response(
        `Скасування не застосовано: статус залишився «${finalStatus || "невідомий"}»`,
        { status: 500 },
      );
    }

    const archived = rows.filter((r) => r.action === "inserted").length;
    const reused = rows.filter((r) => r.action === "exists" || r.action === "skipped").length;

    return {
      ok: true as const,
      offerId,
      archived,
      reused,
      rows,
      finalStatus,
    };
  });

// ---------------------------------------------------------------------------
// Cancel remaining unlinked quantity (position lifecycle event).
//
// Business rule: after "Взяти в роботу", if part of the confirmed quantity was
// already loaded into a shipment and the manager decides not to load the
// remaining pallets, we must:
//   - insert `manager_offer_allocation_parts` rows with status='cancelled' for
//     the per-response remainder (approved - ordered - cancelled_before);
//   - write ONE `position_events` row (event_type='remainder_cancelled') on
//     the same `manager_offers.position_id`, capturing totals and per-response
//     breakdown, so the position passport carries the lifecycle fact.
//
// The RPC `public.cancel_manager_offer_remaining(uuid, text)` performs both
// writes atomically. It authorizes via auth.uid() (admin / super_admin OR
// owner / responsible import_manager). We therefore call it with the
// user-scoped Supabase client, NOT supabaseAdmin, so auth.uid() is populated.
//
// Never touches: manager_offers.status, manager_offers.position_id,
// approved_pallets / requested_pallets / linked_pallets, ordered allocation
// parts, shipment_items, distributions, operational_positions, archive tables.

type CancelRemainingInput = { offerId: string; reason?: string };

function validateCancelRemaining(input: unknown): CancelRemainingInput {
  if (!input || typeof input !== "object") throw new Response("Bad input", { status: 400 });
  const o = input as Record<string, unknown>;
  const id = typeof o.offerId === "string" ? o.offerId.trim() : "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Response("Bad offerId", { status: 400 });
  const reason = typeof o.reason === "string" ? o.reason.slice(0, 500) : undefined;
  return { offerId: id, reason };
}

type CancelRemainingRpcResult = {
  ok?: boolean;
  no_op?: boolean;
  offer_id?: string;
  position_id?: string | null;
  approved_total?: number;
  ordered_total?: number;
  cancelled_before_total?: number;
  cancelled_inserted_total?: number;
  cancelled_after_total?: number;
  open_remaining_after?: number;
  cancelled_responses?: number;
  event_id?: string | null;
  per_response?: Array<{
    response_id: string;
    branch_id: string;
    cancelled_pallets: number;
  }>;
};

export const cancelManagerOfferRemaining = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(validateCancelRemaining)
  .handler(async ({ data, context }) => {
    const { offerId, reason } = data;
    const { supabase } = context;

    // Visibility check under user RLS — surfaces a clean 404 for offers the
    // caller cannot see, matching cancelManagerOffer above.
    const { data: offer, error: readErr } = await supabase
      .from("manager_offers")
      .select("id, status, position_id, product_name")
      .eq("id", offerId)
      .maybeSingle();
    if (readErr) throw new Response(readErr.message, { status: 500 });
    if (!offer) throw new Response("Пропозицію не знайдено", { status: 404 });

    // Call the RPC as the authenticated user so auth.uid() populates the
    // authorization + audit fields inside the SECURITY DEFINER function.
    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      "cancel_manager_offer_remaining",
      { p_offer_id: offerId, p_reason: reason ?? null },
    );
    if (rpcErr) {
      // Map known SQLSTATE / RAISE messages to user-friendly Ukrainian errors.
      const msg = rpcErr.message || "";
      let userMsg = `Не вдалося скасувати залишок: ${msg}`;
      let status = 500;
      if (/forbidden/i.test(msg)) {
        userMsg = "Недостатньо прав для скасування залишку";
        status = 403;
      } else if (/unauthenticated/i.test(msg)) {
        userMsg = "Потрібна авторизація";
        status = 401;
      } else if (/offer_not_found/i.test(msg)) {
        userMsg = "Пропозицію не знайдено";
        status = 404;
      } else if (/offer_status_invalid/i.test(msg)) {
        userMsg = "Пропозицію не можна змінити (скасовану/прострочену)";
        status = 409;
      } else if (/offer_has_no_position/i.test(msg)) {
        userMsg = "Пропозиція не має активного position_id";
        status = 409;
      } else if (/no_ordered_pallets/i.test(msg)) {
        userMsg = "Немає завантажених палет — скасовувати нічого";
        status = 409;
      }
      throw new Response(userMsg, { status });
    }

    const result = (rpcData ?? {}) as CancelRemainingRpcResult;

    return {
      ok: true as const,
      offerId,
      noOp: result.no_op === true,
      cancelledResponses: Number(result.cancelled_responses ?? 0),
      totalCancelledPallets: Number(result.cancelled_inserted_total ?? 0),
      eventId: result.event_id ?? null,
      openRemainingAfter: Number(result.open_remaining_after ?? 0),
      approvedTotal: Number(result.approved_total ?? 0),
      orderedTotal: Number(result.ordered_total ?? 0),
      cancelledAfterTotal: Number(result.cancelled_after_total ?? 0),
      perResponse: result.per_response ?? [],
    };
  });

