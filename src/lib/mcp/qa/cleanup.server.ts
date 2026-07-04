// src/lib/mcp/qa/cleanup.server.ts
// Server-only cleanup executor for QA-MCP smoke runs.
//
// Uses service_role via `@/integrations/supabase/client.server` (loaded
// inside the handler body — see rules). Every delete is captured-id-scoped;
// there is no broad DELETE, no date filter, no reference/master data touch.
//
// Idempotent: each captured id yields one of { deleted, already_gone, error }.
// Reruns with the same payload are safe.

import { sanitizeErr } from "./actor-clients.server";
import type { CapturedIds } from "./scenario.server";

export type CleanupOutcome = "deleted" | "already_gone" | "skipped" | "error";

export type CleanupStep = {
  table: string;
  target_id: string;
  outcome: CleanupOutcome;
  error?: string;
};

export type CleanupResult = {
  cleanup_ok: boolean;
  run_id: string;
  results: CleanupStep[];
  survivors: { table: string; id: string; reason: string }[];
};

// Validate a captured_ids payload before touching anything.
export function validateCapturedIds(payload: unknown): { ok: true; ids: CapturedIds } | { ok: false; reason: string } {
  if (!payload || typeof payload !== "object") return { ok: false, reason: "payload_not_object" };
  const p = payload as Record<string, unknown>;
  if (typeof p.run_id !== "string" || !p.run_id.startsWith("qa-mcp-smoke-")) {
    return { ok: false, reason: "invalid_run_id" };
  }
  const arr = (k: string) => Array.isArray(p[k]) ? (p[k] as unknown[]) : null;
  const req = ["offers", "offer_responses", "positions", "vehicles", "shipments", "shipment_items", "allocation_parts"];
  for (const k of req) if (arr(k) === null) return { ok: false, reason: `missing_or_invalid: ${k}` };
  // Best-effort shape: coerce to CapturedIds. No strict schema; runner is the source.
  return { ok: true, ids: p as unknown as CapturedIds };
}

export async function cleanupCapturedIds(ids: CapturedIds): Promise<CleanupResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const results: CleanupStep[] = [];
  const survivors: { table: string; id: string; reason: string }[] = [];

  const del = async (
    table: string,
    id: string,
    col: string = "id",
  ): Promise<void> => {
    try {
      // Check existence first so we can distinguish deleted/already_gone.
      const chk = await (supabaseAdmin.from(table as never) as any)
        .select(col)
        .eq(col, id)
        .maybeSingle();
      if (chk.error) {
        results.push({ table, target_id: id, outcome: "error", error: sanitizeErr(chk.error.message) });
        survivors.push({ table, id, reason: sanitizeErr(chk.error.message) });
        return;
      }
      if (!chk.data) {
        results.push({ table, target_id: id, outcome: "already_gone" });
        return;
      }
      const d = await (supabaseAdmin.from(table as never) as any).delete().eq(col, id);
      if (d.error) {
        results.push({ table, target_id: id, outcome: "error", error: sanitizeErr(d.error.message) });
        survivors.push({ table, id, reason: sanitizeErr(d.error.message) });
        return;
      }
      results.push({ table, target_id: id, outcome: "deleted" });
    } catch (e) {
      const msg = sanitizeErr(e);
      results.push({ table, target_id: id, outcome: "error", error: msg });
      survivors.push({ table, id, reason: msg });
    }
  };

  const delFiltered = async (
    table: string,
    filterCol: string,
    filterId: string,
  ): Promise<void> => {
    // Bulk delete by a captured foreign-key id. Never by date, never unfiltered.
    try {
      const d = await (supabaseAdmin.from(table as never) as any).delete().eq(filterCol, filterId);
      if (d.error) {
        results.push({ table, target_id: `${filterCol}=${filterId}`, outcome: "error", error: sanitizeErr(d.error.message) });
        survivors.push({ table, id: `${filterCol}=${filterId}`, reason: sanitizeErr(d.error.message) });
        return;
      }
      results.push({ table, target_id: `${filterCol}=${filterId}`, outcome: "deleted" });
    } catch (e) {
      const msg = sanitizeErr(e);
      results.push({ table, target_id: `${filterCol}=${filterId}`, outcome: "error", error: msg });
      survivors.push({ table, id: `${filterCol}=${filterId}`, reason: msg });
    }
  };

  // 1. manager_offer_allocation_parts by captured ids
  for (const a of ids.allocation_parts) await del("manager_offer_allocation_parts", a.id);

  // 2. shipment_item_changes filtered by shipment_item_id
  for (const it of ids.shipment_items) await delFiltered("shipment_item_changes", "shipment_item_id", it.id);

  // 3. position_shipment_links filtered by shipment_item_id
  for (const it of ids.shipment_items) await delFiltered("position_shipment_links", "shipment_item_id", it.id);

  // 4. shipment_items by captured ids
  for (const it of ids.shipment_items) await del("shipment_items", it.id);

  // 5. shipment_changes filtered by shipment_id
  for (const s of ids.shipments) await delFiltered("shipment_changes", "shipment_id", s.id);

  // 6. shipments by captured ids
  for (const s of ids.shipments) await del("shipments", s.id);

  // 7. vehicles by captured ids — only delete if now empty
  for (const v of ids.vehicles) {
    const chk = await (supabaseAdmin.from("shipments" as never) as any)
      .select("id")
      .eq("vehicle_id", v.id)
      .limit(1);
    if (chk.error) {
      results.push({ table: "vehicles", target_id: v.id, outcome: "error", error: sanitizeErr(chk.error.message) });
      survivors.push({ table: "vehicles", id: v.id, reason: sanitizeErr(chk.error.message) });
      continue;
    }
    if (Array.isArray(chk.data) && chk.data.length > 0) {
      results.push({ table: "vehicles", target_id: v.id, outcome: "skipped", error: "vehicle_not_empty" });
      survivors.push({ table: "vehicles", id: v.id, reason: "vehicle_not_empty" });
      continue;
    }
    await del("vehicles", v.id);
  }

  // 8. manager_offer_responses by captured ids
  for (const r of ids.offer_responses) await del("manager_offer_responses", r.id);

  // 9. manager_offer_targets by offer_id (bulk)
  for (const o of ids.offers) await delFiltered("manager_offer_targets", "offer_id", o.id);

  // 10. manager_offers by captured ids (direct — offer is test data)
  for (const o of ids.offers) await del("manager_offers", o.id);

  // 11. rpc_position_rollback_birth for captured positions
  for (const p of ids.positions) {
    try {
      const r = await (supabaseAdmin.rpc as any)("rpc_position_rollback_birth", { p_position_id: p.position_id });
      if (r.error) {
        results.push({ table: "operational_positions(rpc)", target_id: p.position_id, outcome: "error", error: sanitizeErr(r.error.message) });
        survivors.push({ table: "operational_positions", id: p.position_id, reason: sanitizeErr(r.error.message) });
      } else {
        // RPC is no-op if links remain — verify by checking existence.
        const chk = await (supabaseAdmin.from("operational_positions" as never) as any)
          .select("position_id")
          .eq("position_id", p.position_id)
          .maybeSingle();
        if (chk.error) {
          results.push({ table: "operational_positions", target_id: p.position_id, outcome: "error", error: sanitizeErr(chk.error.message) });
          survivors.push({ table: "operational_positions", id: p.position_id, reason: sanitizeErr(chk.error.message) });
        } else if (!chk.data) {
          results.push({ table: "operational_positions", target_id: p.position_id, outcome: "deleted" });
        } else {
          results.push({ table: "operational_positions", target_id: p.position_id, outcome: "skipped", error: "position_still_linked" });
          survivors.push({ table: "operational_positions", id: p.position_id, reason: "position_still_linked" });
        }
      }
    } catch (e) {
      const msg = sanitizeErr(e);
      results.push({ table: "operational_positions", target_id: p.position_id, outcome: "error", error: msg });
      survivors.push({ table: "operational_positions", id: p.position_id, reason: msg });
    }
  }

  return {
    cleanup_ok: survivors.length === 0,
    run_id: ids.run_id,
    results,
    survivors,
  };
}
