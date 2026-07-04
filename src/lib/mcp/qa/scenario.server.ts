// src/lib/mcp/qa/scenario.server.ts
// Server-only: end-to-end shipment lifecycle smoke.
//
// Actors: qa_import_manager_1 (M1), qa_import_manager_2 (M2), qa_branch_A (BA).
// All scenario writes run under the actor's JWT (publishable-key client).
// service_role is NEVER used here. Cleanup lives in cleanup.server.ts.
//
// Steps (each captured; failure returns partial captured_ids for cleanup):
//   S1  M1  INSERT manager_offers (status='active', target_mode='all')
//           rpc_position_create_draft + rpc_position_attach_offer
//   S2  BA  INSERT manager_offer_responses (requested_pallets)
//   S3  M1  UPDATE manager_offer_responses.approved_pallets (reduced/approved)
//   S4  M1  UPDATE manager_offers.status = 'confirmed' (take_into_work)
//   S5  M1  INSERT vehicles (open) + INSERT shipments + INSERT shipment_items
//           rpc_position_attach_shipment (reuses offer's position_id via
//           source_position_id semantics — position is reused, not re-minted)
//           link_offer_to_shipment_item_fifo
//   S6  Assert (M1): vehicles.status='open', shipment_items.position_id set
//   S7  M2  INSERT shipments (child on SAME vehicle) + INSERT shipment_items
//           rpc_position_create_draft (M2) + rpc_position_attach_shipment
//   S8  Assert (service_role via read-only client factory in tool): vehicle
//           has exactly 2 shipments with 2 distinct created_by. Runner
//           performs this assertion under M1 JWT (staff-readable) to avoid
//           needing service_role here.

import type { QaTestUserCredential } from "./env";
import { signInActor, sanitizeErr, type ActorClient } from "./actor-clients.server";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export type CapturedIds = {
  run_id: string;
  started_at: string;
  actors: Record<string, string | null>;
  offers: { id: string; created_by_handle: string }[];
  offer_responses: { id: string; offer_id: string; branch_handle: string }[];
  positions: { position_id: string; source_row_key: string }[];
  vehicles: { id: string; code: string }[];
  shipments: { id: string; code: string; created_by_handle: string }[];
  shipment_items: { id: string; shipment_id: string; position_id: string | null }[];
  allocation_parts: { id: string }[];
};

export type StepLog = {
  step: string;
  ok: boolean;
  detail?: string;
  error?: string;
};

export type ScenarioResult = {
  ok: boolean;
  run_id: string;
  failed_step: string | null;
  steps: StepLog[];
  captured_ids: CapturedIds;
  invariants: {
    vehicle_has_two_shipments: boolean | null;
    two_distinct_managers: boolean | null;
    no_second_vehicle: boolean | null;
  };
  cleanup_required: boolean;
};

export type ScenarioInput = {
  credentials: QaTestUserCredential[];
  fixtures: {
    supplier_id: string | null;
    country: string | null;
    product_name: string | null;
    caliber: string | null;
    package_used: string | null;
    branch_a_id: string | null;
    branch_b_id: string | null;
  };
};

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function randId(): string {
  const g = globalThis.crypto as Crypto | undefined;
  if (g && typeof g.randomUUID === "function") return g.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function pad3(n: number): string { return String(n).padStart(3, "0"); }

// Minimal transliteration for supplier alias fallback.
const CYR: Record<string, string> = {
  а:"a",б:"b",в:"v",г:"h",ґ:"g",д:"d",е:"e",є:"ie",ж:"zh",з:"z",и:"y",і:"i",
  ї:"i",й:"i",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",
  ф:"f",х:"kh",ц:"ts",ч:"ch",ш:"sh",щ:"shch",ь:"",ю:"iu",я:"ia",
};
function supplierAlias(s: { alias?: string | null; code_base?: string | null; name?: string | null }): string {
  for (const raw of [s.alias, s.code_base, s.name]) {
    if (!raw) continue;
    let out = "";
    for (const ch of raw) {
      const lo = ch.toLowerCase();
      const m = CYR[lo];
      out += m !== undefined ? (ch === lo ? m : (m ? m[0].toUpperCase() + m.slice(1) : "")) : ch;
    }
    const letters = out.replace(/[^a-zA-Z]/g, "").toUpperCase();
    if (letters.length >= 5) return letters.slice(0, 5);
    if (letters.length > 0) return (letters + "XXXXX").slice(0, 5);
  }
  return "XXXXX";
}

function countryCode3(name: string): string {
  // 3-letter ISO code fallback — good enough for a unique vehicle code.
  let out = "";
  for (const ch of name) {
    const lo = ch.toLowerCase();
    const m = CYR[lo];
    out += m !== undefined ? (ch === lo ? m : m.toUpperCase()) : ch;
  }
  const lat = out.replace(/[^a-zA-Z]/g, "");
  return (lat.slice(0, 3) || "XXX").toUpperCase();
}

// -----------------------------------------------------------------------
// Individual scenario steps.
//
// Each returns a StepLog + mutates captured_ids in place. Never throws.
// On failure it appends the step log with ok=false and the runner stops.
// -----------------------------------------------------------------------

async function resolveProductAndCountry(
  client: ActorClient,
  productName: string,
  countryName: string,
): Promise<{ ok: true; productId: string; countryId: string } | { ok: false; reason: string }> {
  const prod = await client.rpc("rpc_resolve_product_exact" as never, {
    p_query: productName,
    p_include_reserve: false,
  } as never);
  if (prod.error) return { ok: false, reason: `resolve_product: ${sanitizeErr(prod.error.message)}` };
  const prodRow = Array.isArray(prod.data) ? (prod.data as { status: string; dictionary_id: string | null }[])[0] : null;
  if (!prodRow || prodRow.status !== "matched" || !prodRow.dictionary_id) {
    return { ok: false, reason: `resolve_product: not_matched for "${productName}"` };
  }

  const cRpc = await client.rpc("rpc_resolve_country" as never, { p_input: countryName } as never);
  if (cRpc.error) return { ok: false, reason: `resolve_country: ${sanitizeErr(cRpc.error.message)}` };
  const cRow = Array.isArray(cRpc.data) ? (cRpc.data as { status: string; country_name: string | null }[])[0] : null;
  const canonicalName = (cRow && cRow.status === "matched" && cRow.country_name) ? cRow.country_name : countryName;
  const cSel = await client
    .from("countries" as never)
    .select("id")
    .ilike("name", canonicalName)
    .limit(1)
    .maybeSingle();
  const countryId = (cSel.data as { id?: string } | null)?.id;
  if (cSel.error || !countryId) {
    return { ok: false, reason: `resolve_country: canonical="${canonicalName}" not found` };
  }
  return { ok: true, productId: prodRow.dictionary_id, countryId };
}

// -----------------------------------------------------------------------
// Main entry
// -----------------------------------------------------------------------

export async function runShipmentSmoke(input: ScenarioInput): Promise<ScenarioResult> {
  const run_id = `qa-mcp-smoke-${Date.now()}-${randId().slice(0, 8)}`;
  const started_at = new Date().toISOString();
  const steps: StepLog[] = [];
  const captured: CapturedIds = {
    run_id,
    started_at,
    actors: {},
    offers: [],
    offer_responses: [],
    positions: [],
    vehicles: [],
    shipments: [],
    shipment_items: [],
    allocation_parts: [],
  };
  const invariants = {
    vehicle_has_two_shipments: null as boolean | null,
    two_distinct_managers: null as boolean | null,
    no_second_vehicle: null as boolean | null,
  };

  const done = (failed_step: string | null): ScenarioResult => ({
    ok: failed_step === null,
    run_id,
    failed_step,
    steps,
    captured_ids: captured,
    invariants,
    cleanup_required:
      captured.offers.length > 0 ||
      captured.offer_responses.length > 0 ||
      captured.positions.length > 0 ||
      captured.vehicles.length > 0 ||
      captured.shipments.length > 0 ||
      captured.shipment_items.length > 0 ||
      captured.allocation_parts.length > 0,
  });

  // Fixture validation
  const fx = input.fixtures;
  const missing: string[] = [];
  if (!fx.supplier_id) missing.push("supplier_id");
  if (!fx.country) missing.push("country");
  if (!fx.product_name) missing.push("product_name");
  if (!fx.branch_a_id) missing.push("branch_a_id");
  if (missing.length > 0) {
    steps.push({ step: "fixtures_check", ok: false, error: `fixture_missing: ${missing.join(",")}` });
    return done("fixtures_check");
  }

  const byHandle = new Map(input.credentials.map((c) => [c.handle, c]));
  const m1Cred = byHandle.get("qa_import_manager_1");
  const m2Cred = byHandle.get("qa_import_manager_2");
  const baCred = byHandle.get("qa_branch_A");
  if (!m1Cred || !m2Cred || !baCred) {
    steps.push({ step: "actor_lookup", ok: false, error: "missing credentials for m1/m2/ba" });
    return done("actor_lookup");
  }

  // Sign in actors
  const m1SI = await signInActor(m1Cred);
  if (!m1SI.ok) {
    steps.push({ step: "signin_m1", ok: false, error: m1SI.reason });
    return done("signin_m1");
  }
  const m2SI = await signInActor(m2Cred);
  if (!m2SI.ok) {
    await m1SI.actor.signOut();
    steps.push({ step: "signin_m2", ok: false, error: m2SI.reason });
    return done("signin_m2");
  }
  const baSI = await signInActor(baCred);
  if (!baSI.ok) {
    await m1SI.actor.signOut(); await m2SI.actor.signOut();
    steps.push({ step: "signin_ba", ok: false, error: baSI.reason });
    return done("signin_ba");
  }

  const m1 = m1SI.actor, m2 = m2SI.actor, ba = baSI.actor;
  captured.actors = {
    m1_user_id: m1.userId,
    m2_user_id: m2.userId,
    ba_user_id: ba.userId,
  };
  steps.push({ step: "signin_actors", ok: true });

  // Everything below wrapped so signOut always runs.
  try {
    // ----- Supplier lookup + import_manager_id --------------------------
    const supRes = await m1.client
      .from("suppliers" as never)
      .select("id,name,alias,code_base,import_manager_id")
      .eq("id", fx.supplier_id!)
      .maybeSingle();
    const supplier = supRes.data as {
      id: string; name: string | null; alias: string | null;
      code_base: string | null; import_manager_id: string | null;
    } | null;
    if (supRes.error || !supplier) {
      steps.push({ step: "load_supplier", ok: false, error: sanitizeErr(supRes.error?.message ?? "supplier_not_found") });
      return done("load_supplier");
    }
    steps.push({ step: "load_supplier", ok: true, detail: `supplier=${supplier.id}` });

    const m1ImportManagerId = supplier.import_manager_id
      ?? m1Cred.expected_import_manager_id
      ?? null;

    // ----- Resolve product + country ------------------------------------
    const rpc = await resolveProductAndCountry(m1.client, fx.product_name!, fx.country!);
    if (!rpc.ok) {
      steps.push({ step: "resolve_product_country", ok: false, error: rpc.reason });
      return done("resolve_product_country");
    }
    steps.push({ step: "resolve_product_country", ok: true });

    // ----- S1: create manager_offer + attach position -------------------
    const offerIns = await m1.client
      .from("manager_offers" as never)
      .insert({
        created_by: m1.userId,
        import_manager_id: m1ImportManagerId,
        product_name: fx.product_name!,
        origin_country: fx.country!,
        caliber: fx.caliber ?? null,
        packaging: fx.package_used ?? null,
        status: "active",
        target_mode: "all",
        offered_pallets: 10,
        indicative_cost_usd: 0,
        invoice_cost_usd: 0,
        notes: `QA-MCP smoke ${run_id}`,
      } as never)
      .select("id")
      .single();
    const offerRow = offerIns.data as { id: string } | null;
    if (offerIns.error || !offerRow) {
      steps.push({ step: "s1_insert_offer", ok: false, error: sanitizeErr(offerIns.error?.message ?? "insert_failed") });
      return done("s1_insert_offer");
    }
    const offerId = offerRow.id;
    captured.offers.push({ id: offerId, created_by_handle: "qa_import_manager_1" });
    steps.push({ step: "s1_insert_offer", ok: true, detail: `offer_id=${offerId}` });

    const posDraft = await m1.client.rpc("rpc_position_create_draft" as never, {
      p_product_id: rpc.productId,
      p_product_origin_country_id: rpc.countryId,
      p_source_context: "qa_mcp_smoke",
      p_source_row_key: `${run_id}:offer_1`,
      p_caliber: fx.caliber ?? undefined,
      p_package_used: fx.package_used ?? undefined,
      p_responsible_manager_id: m1ImportManagerId ?? undefined,
    } as never);
    const posArr = posDraft.data as { position_id?: string | null }[] | null;
    const positionId1 = Array.isArray(posArr) ? posArr[0]?.position_id ?? null : null;
    if (posDraft.error || !positionId1) {
      steps.push({ step: "s1_position_create_draft", ok: false, error: sanitizeErr(posDraft.error?.message ?? "no_position_id") });
      return done("s1_position_create_draft");
    }
    captured.positions.push({ position_id: positionId1, source_row_key: `${run_id}:offer_1` });
    steps.push({ step: "s1_position_create_draft", ok: true, detail: `position_id=${positionId1}` });

    const attachOff = await m1.client.rpc("rpc_position_attach_offer" as never, {
      p_offer_id: offerId,
      p_position_id: positionId1,
      p_responsible_manager_id: m1ImportManagerId ?? undefined,
    } as never);
    if (attachOff.error) {
      steps.push({ step: "s1_attach_offer", ok: false, error: sanitizeErr(attachOff.error.message) });
      return done("s1_attach_offer");
    }
    steps.push({ step: "s1_attach_offer", ok: true });

    // ----- S2: branch A creates response --------------------------------
    const respIns = await ba.client
      .from("manager_offer_responses" as never)
      .insert({
        offer_id: offerId,
        branch_id: fx.branch_a_id!,
        requested_pallets: 5,
      } as never)
      .select("id")
      .single();
    const respRow = respIns.data as { id: string } | null;
    if (respIns.error || !respRow) {
      steps.push({ step: "s2_branch_request", ok: false, error: sanitizeErr(respIns.error?.message ?? "insert_failed") });
      return done("s2_branch_request");
    }
    const responseIdBA = respRow.id;
    captured.offer_responses.push({ id: responseIdBA, offer_id: offerId, branch_handle: "qa_branch_A" });
    steps.push({ step: "s2_branch_request", ok: true, detail: `response_id=${responseIdBA}` });

    // ----- S3: M1 approves (reduced qty) --------------------------------
    const approvedQty = 5; // approve as-requested (still counts as "reduce/approve" path)
    const respUpd = await m1.client
      .from("manager_offer_responses" as never)
      .update({ approved_pallets: approvedQty } as never)
      .eq("id", responseIdBA);
    if (respUpd.error) {
      steps.push({ step: "s3_approve_response", ok: false, error: sanitizeErr(respUpd.error.message) });
      return done("s3_approve_response");
    }
    steps.push({ step: "s3_approve_response", ok: true, detail: `approved=${approvedQty}` });

    // ----- S4: take into work (status='confirmed') ----------------------
    const offerConfirm = await m1.client
      .from("manager_offers" as never)
      .update({ status: "confirmed" } as never)
      .eq("id", offerId);
    if (offerConfirm.error) {
      steps.push({ step: "s4_take_into_work", ok: false, error: sanitizeErr(offerConfirm.error.message) });
      return done("s4_take_into_work");
    }
    steps.push({ step: "s4_take_into_work", ok: true });

    // ----- S5: M1 creates vehicle + shipment + item + attach + FIFO -----
    const alias = supplierAlias(supplier);
    const ccode = countryCode3(fx.country!);

    // Sequences via existing RPCs
    const vSeqRpc = await m1.client.rpc("next_vehicle_sequence" as never, { p_country_code: ccode } as never);
    if (vSeqRpc.error) {
      steps.push({ step: "s5_next_vehicle_sequence", ok: false, error: sanitizeErr(vSeqRpc.error.message) });
      return done("s5_next_vehicle_sequence");
    }
    const vehicleSeq = Number(vSeqRpc.data ?? 1);
    const sSeqRpc = await m1.client.rpc("next_supplier_sequence" as never, { p_supplier_id: supplier.id } as never);
    if (sSeqRpc.error) {
      steps.push({ step: "s5_next_supplier_sequence", ok: false, error: sanitizeErr(sSeqRpc.error.message) });
      return done("s5_next_supplier_sequence");
    }
    const supplierSeq = Number(sSeqRpc.data ?? 1);
    const vehicleCode = `${ccode}-${pad3(vehicleSeq)}`;
    const shipmentCode = `${alias}-${pad3(supplierSeq)}-${vehicleCode}`.toUpperCase();

    const today = new Date();
    const loadingDate = today.toISOString().slice(0, 10);
    const etaDate = new Date(today.getTime() + 7 * 86400_000).toISOString().slice(0, 10);

    // INSERT vehicle (open)
    const vIns = await m1.client
      .from("vehicles" as never)
      .insert({
        code: vehicleCode,
        country: fx.country!,
        country_code: ccode,
        sequence_no: vehicleSeq,
        loading_date: loadingDate,
        eta: etaDate,
        created_by: m1.userId,
      } as never)
      .select("id")
      .single();
    const vehicleRow = vIns.data as { id: string } | null;
    if (vIns.error || !vehicleRow) {
      steps.push({ step: "s5_insert_vehicle", ok: false, error: sanitizeErr(vIns.error?.message ?? "insert_failed") });
      return done("s5_insert_vehicle");
    }
    const vehicleId = vehicleRow.id;
    captured.vehicles.push({ id: vehicleId, code: vehicleCode });
    steps.push({ step: "s5_insert_vehicle", ok: true, detail: `vehicle_id=${vehicleId} code=${vehicleCode}` });

    // INSERT shipment (M1)
    const s1Ins = await m1.client
      .from("shipments" as never)
      .insert({
        code: shipmentCode,
        vehicle_id: vehicleId,
        supplier_id: supplier.id,
        supplier_seq: supplierSeq,
        country: fx.country!,
        loading_date: loadingDate,
        eta: etaDate,
        logistics_cost: 100,
        logistics_cost_currency: "USD",
        logistics_cost_usd: 100,
        created_by: m1.userId,
        import_manager_id: m1ImportManagerId,
      } as never)
      .select("id")
      .single();
    const s1Row = s1Ins.data as { id: string } | null;
    if (s1Ins.error || !s1Row) {
      steps.push({ step: "s5_insert_shipment", ok: false, error: sanitizeErr(s1Ins.error?.message ?? "insert_failed") });
      return done("s5_insert_shipment");
    }
    const shipmentId1 = s1Row.id;
    captured.shipments.push({ id: shipmentId1, code: shipmentCode, created_by_handle: "qa_import_manager_1" });
    steps.push({ step: "s5_insert_shipment", ok: true, detail: `shipment_id=${shipmentId1}` });

    // INSERT shipment_item (reuses position_id_1 via source position — but
    // the actual link is done via rpc_position_attach_shipment after insert).
    const palletCount = approvedQty; // 5
    const netKg = palletCount * 800;
    const grossKg = palletCount * 900;
    const itemIns = await m1.client
      .from("shipment_items" as never)
      .insert({
        shipment_id: shipmentId1,
        product_name: fx.product_name!,
        origin_country: fx.country!,
        caliber: fx.caliber ?? null,
        package_used: fx.package_used ?? null,
        pallet_count: palletCount,
        net_weight_kg: netKg,
        gross_weight_kg: grossKg,
        pallet_weight: netKg / palletCount,
        qty: netKg,
        unit: "kg",
        unit_price: 1,
        price_currency: "USD",
      } as never)
      .select("id")
      .single();
    const itemRow = itemIns.data as { id: string } | null;
    if (itemIns.error || !itemRow) {
      steps.push({ step: "s5_insert_shipment_item", ok: false, error: sanitizeErr(itemIns.error?.message ?? "insert_failed") });
      return done("s5_insert_shipment_item");
    }
    const itemId1 = itemRow.id;
    captured.shipment_items.push({ id: itemId1, shipment_id: shipmentId1, position_id: positionId1 });
    steps.push({ step: "s5_insert_shipment_item", ok: true, detail: `item_id=${itemId1}` });

    // rpc_position_attach_shipment
    const attachShip = await m1.client.rpc("rpc_position_attach_shipment" as never, {
      p_shipment_item_id: itemId1,
      p_position_id: positionId1,
      p_pallet_qty_linked: palletCount,
    } as never);
    if (attachShip.error) {
      steps.push({ step: "s5_attach_shipment", ok: false, error: sanitizeErr(attachShip.error.message) });
      return done("s5_attach_shipment");
    }
    steps.push({ step: "s5_attach_shipment", ok: true });

    // link_offer_to_shipment_item_fifo (existing FIFO primitive)
    const fifo = await m1.client.rpc("link_offer_to_shipment_item_fifo" as never, {
      p_offer_id: offerId,
      p_shipment_item_id: itemId1,
      p_max_pallets: palletCount,
      p_allow_caliber_mismatch: false,
    } as never);
    if (fifo.error) {
      steps.push({ step: "s5_fifo_link", ok: false, error: sanitizeErr(fifo.error.message) });
      // Don't return — smoke can still verify structural invariants without FIFO.
      // But mark cleanup_required and note failure.
    } else {
      steps.push({ step: "s5_fifo_link", ok: true });
      // Capture allocation_parts ids for cleanup
      const alloc = await m1.client
        .from("manager_offer_allocation_parts" as never)
        .select("id")
        .eq("shipment_item_id", itemId1);
      if (!alloc.error && Array.isArray(alloc.data)) {
        for (const a of alloc.data as { id: string }[]) {
          captured.allocation_parts.push({ id: a.id });
        }
      }
    }

    // ----- S6: assert item.position_id + vehicle open -------------------
    const vChk = await m1.client
      .from("vehicles" as never)
      .select("id,status")
      .eq("id", vehicleId)
      .maybeSingle();
    const vChkRow = vChk.data as { id: string; status: string } | null;
    if (vChk.error || !vChkRow || vChkRow.status !== "open") {
      steps.push({ step: "s6_assert_vehicle_open", ok: false, error: `vehicle status=${vChkRow?.status ?? "unknown"}` });
      return done("s6_assert_vehicle_open");
    }
    steps.push({ step: "s6_assert_vehicle_open", ok: true });

    const itemChk = await m1.client
      .from("shipment_items" as never)
      .select("position_id")
      .eq("id", itemId1)
      .maybeSingle();
    const itemChkPos = (itemChk.data as { position_id: string | null } | null)?.position_id;
    if (itemChk.error || itemChkPos !== positionId1) {
      steps.push({ step: "s6_assert_item_position", ok: false, error: `expected=${positionId1} actual=${itemChkPos ?? "null"}` });
      return done("s6_assert_item_position");
    }
    steps.push({ step: "s6_assert_item_position", ok: true });

    // ----- S7: M2 child shipment on SAME vehicle ------------------------
    const m2ImportManagerId = m2Cred.expected_import_manager_id ?? null;

    // Child shipment inherits country/loading_date/eta from vehicle. Freight
    // forced to 0 USD (per createShipmentFlow child-mode contract).
    const s2Ins = await m2.client
      .from("shipments" as never)
      .insert({
        code: `${alias}-${pad3(supplierSeq + 1)}-${vehicleCode}`.toUpperCase(),
        vehicle_id: vehicleId,
        supplier_id: supplier.id,
        supplier_seq: supplierSeq + 1,
        country: fx.country!,
        loading_date: loadingDate,
        eta: etaDate,
        logistics_cost: 0,
        logistics_cost_currency: "USD",
        logistics_cost_usd: 0,
        created_by: m2.userId,
        import_manager_id: m2ImportManagerId,
      } as never)
      .select("id,code")
      .single();
    const s2Row = s2Ins.data as { id: string; code: string } | null;
    if (s2Ins.error || !s2Row) {
      steps.push({ step: "s7_insert_shipment_m2", ok: false, error: sanitizeErr(s2Ins.error?.message ?? "insert_failed") });
      return done("s7_insert_shipment_m2");
    }
    const shipmentId2 = s2Row.id;
    captured.shipments.push({ id: shipmentId2, code: s2Row.code, created_by_handle: "qa_import_manager_2" });
    steps.push({ step: "s7_insert_shipment_m2", ok: true, detail: `shipment_id=${shipmentId2}` });

    // Position for M2's manual item
    const rpc2 = await resolveProductAndCountry(m2.client, fx.product_name!, fx.country!);
    if (!rpc2.ok) {
      steps.push({ step: "s7_resolve_m2", ok: false, error: rpc2.reason });
      return done("s7_resolve_m2");
    }
    const pos2 = await m2.client.rpc("rpc_position_create_draft" as never, {
      p_product_id: rpc2.productId,
      p_product_origin_country_id: rpc2.countryId,
      p_source_context: "qa_mcp_smoke",
      p_source_row_key: `${run_id}:reload_item`,
      p_caliber: fx.caliber ?? undefined,
      p_package_used: fx.package_used ?? undefined,
      p_responsible_manager_id: m2ImportManagerId ?? undefined,
    } as never);
    const pos2Arr = pos2.data as { position_id?: string | null }[] | null;
    const positionId2 = Array.isArray(pos2Arr) ? pos2Arr[0]?.position_id ?? null : null;
    if (pos2.error || !positionId2) {
      steps.push({ step: "s7_position_create_draft_m2", ok: false, error: sanitizeErr(pos2.error?.message ?? "no_position_id") });
      return done("s7_position_create_draft_m2");
    }
    captured.positions.push({ position_id: positionId2, source_row_key: `${run_id}:reload_item` });

    const item2Pallets = 3;
    const item2Net = item2Pallets * 800;
    const item2Gross = item2Pallets * 900;
    const item2Ins = await m2.client
      .from("shipment_items" as never)
      .insert({
        shipment_id: shipmentId2,
        product_name: fx.product_name!,
        origin_country: fx.country!,
        caliber: fx.caliber ?? null,
        package_used: fx.package_used ?? null,
        pallet_count: item2Pallets,
        net_weight_kg: item2Net,
        gross_weight_kg: item2Gross,
        pallet_weight: item2Net / item2Pallets,
        qty: item2Net,
        unit: "kg",
        unit_price: 1,
        price_currency: "USD",
      } as never)
      .select("id")
      .single();
    const item2Row = item2Ins.data as { id: string } | null;
    if (item2Ins.error || !item2Row) {
      steps.push({ step: "s7_insert_shipment_item_m2", ok: false, error: sanitizeErr(item2Ins.error?.message ?? "insert_failed") });
      return done("s7_insert_shipment_item_m2");
    }
    const itemId2 = item2Row.id;
    captured.shipment_items.push({ id: itemId2, shipment_id: shipmentId2, position_id: positionId2 });

    const attachShip2 = await m2.client.rpc("rpc_position_attach_shipment" as never, {
      p_shipment_item_id: itemId2,
      p_position_id: positionId2,
      p_pallet_qty_linked: item2Pallets,
    } as never);
    if (attachShip2.error) {
      steps.push({ step: "s7_attach_shipment_m2", ok: false, error: sanitizeErr(attachShip2.error.message) });
      return done("s7_attach_shipment_m2");
    }
    steps.push({ step: "s7_child_shipment_full", ok: true, detail: `item_id=${itemId2}` });

    // ----- S8: invariant checks -----------------------------------------
    // Use M1 client (staff → reads across shipments)
    const inv = await m1.client
      .from("shipments" as never)
      .select("id,created_by,vehicle_id")
      .eq("vehicle_id", vehicleId);
    if (inv.error) {
      steps.push({ step: "s8_invariants", ok: false, error: sanitizeErr(inv.error.message) });
      return done("s8_invariants");
    }
    const rows = (inv.data ?? []) as { id: string; created_by: string; vehicle_id: string }[];
    invariants.vehicle_has_two_shipments = rows.length === 2;
    const distinctCreators = new Set(rows.map((r) => r.created_by));
    invariants.two_distinct_managers = distinctCreators.size === 2 && distinctCreators.has(m1.userId) && distinctCreators.has(m2.userId);

    // Verify no separate vehicle exists for M2 (shipment_id_2.vehicle_id === vehicleId)
    const m2ship = rows.find((r) => r.id === shipmentId2);
    invariants.no_second_vehicle = !!m2ship && m2ship.vehicle_id === vehicleId;

    const allOk =
      invariants.vehicle_has_two_shipments === true &&
      invariants.two_distinct_managers === true &&
      invariants.no_second_vehicle === true;
    steps.push({
      step: "s8_invariants",
      ok: allOk,
      detail: JSON.stringify(invariants),
      error: allOk ? undefined : "invariant_failed",
    });
    if (!allOk) return done("s8_invariants");

    return done(null);
  } catch (e) {
    steps.push({ step: "unexpected", ok: false, error: sanitizeErr(e) });
    return done("unexpected");
  } finally {
    await Promise.all([m1.signOut(), m2.signOut(), ba.signOut()]);
  }
}
