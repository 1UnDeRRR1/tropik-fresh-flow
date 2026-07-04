// src/lib/mcp/qa/direct-dogruz.server.ts
//
// Server-only: QA-MCP direct-dogruz-without-offer smoke.
//
// Actors: qa_import_manager_1 (M1), qa_import_manager_2 (M2).
// All writes run under the actor's JWT (publishable-key client). service_role
// is NEVER used here. Cleanup is captured-ids-only via existing
// cleanup.server.ts (payload is a superset of CapturedIds).
//
// Scenario (NO offer, NO branch response, NO VS, NO reserve, NO close):
//   S1  Preflight: fixtures + sign in M1/M2 + resolve product+country
//   S2  M1: INSERT vehicle (open) + INSERT parent shipment + INSERT item
//           + rpc_position_create_draft(M1) + rpc_position_attach_shipment
//   S3  M2: INSERT child shipment on SAME vehicle_id + INSERT item
//           + rpc_position_create_draft(M2) + rpc_position_attach_shipment
//   S4  Assertions / invariants
//
// The runner mirrors the business result of the standalone + child
// createShipmentFlow paths under actor JWTs. It does NOT import
// createShipmentFlow (that helper depends on the browser Supabase client
// and shipment UI code paths, and would require production refactor to
// call safely from a server context).

import type { QaTestUserCredential } from "./env";
import { signInActor, sanitizeErr, type ActorClient } from "./actor-clients.server";
import type { CapturedIds } from "./scenario.server";

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

export type StepLog = { step: string; ok: boolean; detail?: string; error?: string };

export type DirectDogruzInvariants = {
  vehicle_status_open: boolean | null;
  two_shipments_same_vehicle: boolean | null;
  no_second_vehicle: boolean | null;
  two_distinct_managers: boolean | null;
  shipment_codes_share_vehicle_suffix: boolean | null;
  parent_vehicle_code_reused: boolean | null;
  no_offers_created: boolean | null;
  no_offer_responses_created: boolean | null;
  no_reserves_created: boolean | null;
  parent_item_has_position_id: boolean | null;
  child_item_has_position_id: boolean | null;
  position_id_minted_count: number;
  total_pallets_within_limit: boolean | null;
  total_gross_within_limit: boolean | null;
};

export type DirectDogruzResult = {
  ok: boolean;
  run_id: string;
  failed_step: string | null;
  steps: StepLog[];
  captured_ids: CapturedIds;
  invariants: DirectDogruzInvariants;
  cleanup_required: boolean;
};

export type DirectDogruzInput = {
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

const VEHICLE_MAX_PALLETS = 26;
const VEHICLE_MAX_GROSS_KG = 21_500;

function randId(): string {
  const g = globalThis.crypto as Crypto | undefined;
  if (g && typeof g.randomUUID === "function") return g.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function pad3(n: number): string { return String(n).padStart(3, "0"); }

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
  let out = "";
  for (const ch of name) {
    const lo = ch.toLowerCase();
    const m = CYR[lo];
    out += m !== undefined ? (ch === lo ? m : m.toUpperCase()) : ch;
  }
  const lat = out.replace(/[^a-zA-Z]/g, "");
  return (lat.slice(0, 3) || "XXX").toUpperCase();
}

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

export async function runDirectDogruzNoOffer(input: DirectDogruzInput): Promise<DirectDogruzResult> {
  // NOTE: run_id keeps `qa-mcp-smoke-` prefix so existing qa_cleanup_run
  // validator accepts the payload without any cleanup change.
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
  const invariants: DirectDogruzInvariants = {
    vehicle_status_open: null,
    two_shipments_same_vehicle: null,
    no_second_vehicle: null,
    two_distinct_managers: null,
    shipment_codes_share_vehicle_suffix: null,
    parent_vehicle_code_reused: null,
    no_offers_created: null,
    no_offer_responses_created: null,
    no_reserves_created: null,
    parent_item_has_position_id: null,
    child_item_has_position_id: null,
    position_id_minted_count: 0,
    total_pallets_within_limit: null,
    total_gross_within_limit: null,
  };

  const done = (failed_step: string | null): DirectDogruzResult => ({
    ok: failed_step === null,
    run_id,
    failed_step,
    steps,
    captured_ids: captured,
    invariants,
    cleanup_required:
      captured.positions.length > 0 ||
      captured.vehicles.length > 0 ||
      captured.shipments.length > 0 ||
      captured.shipment_items.length > 0,
  });

  // --- S1a. Fixtures ------------------------------------------------------
  const fx = input.fixtures;
  const missing: string[] = [];
  if (!fx.supplier_id) missing.push("supplier_id");
  if (!fx.country) missing.push("country");
  if (!fx.product_name) missing.push("product_name");
  if (missing.length > 0) {
    steps.push({ step: "fixtures_check", ok: false, error: `fixture_missing: ${missing.join(",")}` });
    return done("fixtures_check");
  }

  // --- S1b. Actor lookup + sign in ---------------------------------------
  const byHandle = new Map(input.credentials.map((c) => [c.handle, c]));
  const m1Cred = byHandle.get("qa_import_manager_1");
  const m2Cred = byHandle.get("qa_import_manager_2");
  if (!m1Cred || !m2Cred) {
    steps.push({ step: "actor_lookup", ok: false, error: "missing credentials for m1/m2" });
    return done("actor_lookup");
  }
  const m1SI = await signInActor(m1Cred);
  if (!m1SI.ok) { steps.push({ step: "signin_m1", ok: false, error: m1SI.reason }); return done("signin_m1"); }
  const m2SI = await signInActor(m2Cred);
  if (!m2SI.ok) {
    await m1SI.actor.signOut();
    steps.push({ step: "signin_m2", ok: false, error: m2SI.reason });
    return done("signin_m2");
  }
  const m1 = m1SI.actor, m2 = m2SI.actor;
  captured.actors = { m1_user_id: m1.userId, m2_user_id: m2.userId };
  steps.push({ step: "signin_actors", ok: true });

  try {
    // --- S1c. Supplier lookup --------------------------------------------
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
    const m2ImportManagerId = m2Cred.expected_import_manager_id ?? null;

    // --- S1d. Resolve product + country ----------------------------------
    const rpc = await resolveProductAndCountry(m1.client, fx.product_name!, fx.country!);
    if (!rpc.ok) {
      steps.push({ step: "resolve_product_country", ok: false, error: rpc.reason });
      return done("resolve_product_country");
    }
    steps.push({ step: "resolve_product_country", ok: true });

    // --- S2. M1 creates open vehicle + parent shipment + item -----------
    const alias = supplierAlias(supplier);
    const ccode = countryCode3(fx.country!);

    const vSeqRpc = await m1.client.rpc("next_vehicle_sequence" as never, { p_country_code: ccode } as never);
    if (vSeqRpc.error) {
      steps.push({ step: "s2_next_vehicle_sequence", ok: false, error: sanitizeErr(vSeqRpc.error.message) });
      return done("s2_next_vehicle_sequence");
    }
    const vehicleSeq = Number(vSeqRpc.data ?? 1);
    const sSeqRpc1 = await m1.client.rpc("next_supplier_sequence" as never, { p_supplier_id: supplier.id } as never);
    if (sSeqRpc1.error) {
      steps.push({ step: "s2_next_supplier_sequence", ok: false, error: sanitizeErr(sSeqRpc1.error.message) });
      return done("s2_next_supplier_sequence");
    }
    const supplierSeq1 = Number(sSeqRpc1.data ?? 1);
    const vehicleCode = `${ccode}-${pad3(vehicleSeq)}`;
    const parentShipmentCode = `${alias}-${pad3(supplierSeq1)}-${vehicleCode}`.toUpperCase();

    const today = new Date();
    const loadingDate = today.toISOString().slice(0, 10);
    const etaDate = new Date(today.getTime() + 7 * 86400_000).toISOString().slice(0, 10);

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
      steps.push({ step: "s2_insert_vehicle", ok: false, error: sanitizeErr(vIns.error?.message ?? "insert_failed") });
      return done("s2_insert_vehicle");
    }
    const vehicleId = vehicleRow.id;
    captured.vehicles.push({ id: vehicleId, code: vehicleCode });
    steps.push({ step: "s2_insert_vehicle", ok: true, detail: `vehicle_id=${vehicleId} code=${vehicleCode}` });

    const parentIns = await m1.client
      .from("shipments" as never)
      .insert({
        code: parentShipmentCode,
        vehicle_id: vehicleId,
        supplier_id: supplier.id,
        supplier_seq: supplierSeq1,
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
    const parentRow = parentIns.data as { id: string } | null;
    if (parentIns.error || !parentRow) {
      steps.push({ step: "s2_insert_parent_shipment", ok: false, error: sanitizeErr(parentIns.error?.message ?? "insert_failed") });
      return done("s2_insert_parent_shipment");
    }
    const parentShipmentId = parentRow.id;
    captured.shipments.push({ id: parentShipmentId, code: parentShipmentCode, created_by_handle: "qa_import_manager_1" });
    steps.push({ step: "s2_insert_parent_shipment", ok: true, detail: `shipment_id=${parentShipmentId}` });

    // Mint position for parent item
    const pos1 = await m1.client.rpc("rpc_position_create_draft" as never, {
      p_product_id: rpc.productId,
      p_product_origin_country_id: rpc.countryId,
      p_source_context: "qa_mcp_direct_dogruz",
      p_source_row_key: `${run_id}:parent_item`,
      p_caliber: fx.caliber ?? undefined,
      p_package_used: fx.package_used ?? undefined,
      p_responsible_manager_id: m1ImportManagerId ?? undefined,
    } as never);
    const pos1Arr = pos1.data as { position_id?: string | null }[] | null;
    const positionId1 = Array.isArray(pos1Arr) ? pos1Arr[0]?.position_id ?? null : null;
    if (pos1.error || !positionId1) {
      steps.push({ step: "s2_position_create_draft_m1", ok: false, error: sanitizeErr(pos1.error?.message ?? "no_position_id") });
      return done("s2_position_create_draft_m1");
    }
    captured.positions.push({ position_id: positionId1, source_row_key: `${run_id}:parent_item` });
    invariants.position_id_minted_count += 1;
    steps.push({ step: "s2_position_create_draft_m1", ok: true, detail: `position_id=${positionId1}` });

    const parentPallets = 5;
    const parentNet = parentPallets * 800;
    const parentGross = parentPallets * 900;
    const parentItemIns = await m1.client
      .from("shipment_items" as never)
      .insert({
        shipment_id: parentShipmentId,
        product_name: fx.product_name!,
        origin_country: fx.country!,
        caliber: fx.caliber ?? null,
        package_used: fx.package_used ?? null,
        pallet_count: parentPallets,
        net_weight_kg: parentNet,
        gross_weight_kg: parentGross,
        pallet_weight: parentNet / parentPallets,
        qty: parentNet,
        unit: "kg",
        unit_price: 1,
        price_currency: "USD",
      } as never)
      .select("id")
      .single();
    const parentItemRow = parentItemIns.data as { id: string } | null;
    if (parentItemIns.error || !parentItemRow) {
      steps.push({ step: "s2_insert_parent_item", ok: false, error: sanitizeErr(parentItemIns.error?.message ?? "insert_failed") });
      return done("s2_insert_parent_item");
    }
    const parentItemId = parentItemRow.id;
    captured.shipment_items.push({ id: parentItemId, shipment_id: parentShipmentId, position_id: positionId1 });
    steps.push({ step: "s2_insert_parent_item", ok: true, detail: `item_id=${parentItemId}` });

    const attach1 = await m1.client.rpc("rpc_position_attach_shipment" as never, {
      p_shipment_item_id: parentItemId,
      p_position_id: positionId1,
      p_pallet_qty_linked: parentPallets,
    } as never);
    if (attach1.error) {
      steps.push({ step: "s2_attach_shipment_m1", ok: false, error: sanitizeErr(attach1.error.message) });
      return done("s2_attach_shipment_m1");
    }
    steps.push({ step: "s2_attach_shipment_m1", ok: true });

    // --- S3. M2 adds child shipment on SAME vehicle ---------------------
    // Re-read parent vehicle as source of truth (status must still be open)
    const vRead = await m2.client
      .from("vehicles" as never)
      .select("id,code,country,loading_date,eta,status")
      .eq("id", vehicleId)
      .maybeSingle();
    const vReadRow = vRead.data as {
      id: string; code: string; country: string;
      loading_date: string | null; eta: string | null; status: string;
    } | null;
    if (vRead.error || !vReadRow) {
      steps.push({ step: "s3_reread_vehicle", ok: false, error: sanitizeErr(vRead.error?.message ?? "vehicle_not_found") });
      return done("s3_reread_vehicle");
    }
    if (vReadRow.status !== "open") {
      steps.push({ step: "s3_reread_vehicle", ok: false, error: `vehicle_not_open: ${vReadRow.status}` });
      return done("s3_reread_vehicle");
    }
    steps.push({ step: "s3_reread_vehicle", ok: true, detail: `status=${vReadRow.status}` });

    const sSeqRpc2 = await m2.client.rpc("next_supplier_sequence" as never, { p_supplier_id: supplier.id } as never);
    if (sSeqRpc2.error) {
      steps.push({ step: "s3_next_supplier_sequence", ok: false, error: sanitizeErr(sSeqRpc2.error.message) });
      return done("s3_next_supplier_sequence");
    }
    const supplierSeq2 = Number(sSeqRpc2.data ?? supplierSeq1 + 1);
    // Child shipment REUSES parent vehicleCode as suffix.
    const childShipmentCode = `${alias}-${pad3(supplierSeq2)}-${vReadRow.code}`.toUpperCase();

    // Child inherits country/loading_date/eta from parent vehicle; freight=0.
    const childIns = await m2.client
      .from("shipments" as never)
      .insert({
        code: childShipmentCode,
        vehicle_id: vehicleId,
        supplier_id: supplier.id,
        supplier_seq: supplierSeq2,
        country: vReadRow.country,
        loading_date: vReadRow.loading_date,
        eta: vReadRow.eta,
        logistics_cost: 0,
        logistics_cost_currency: "USD",
        logistics_cost_usd: 0,
        created_by: m2.userId,
        import_manager_id: m2ImportManagerId,
      } as never)
      .select("id,code")
      .single();
    const childRow = childIns.data as { id: string; code: string } | null;
    if (childIns.error || !childRow) {
      steps.push({ step: "s3_insert_child_shipment", ok: false, error: sanitizeErr(childIns.error?.message ?? "insert_failed") });
      return done("s3_insert_child_shipment");
    }
    const childShipmentId = childRow.id;
    captured.shipments.push({ id: childShipmentId, code: childRow.code, created_by_handle: "qa_import_manager_2" });
    steps.push({ step: "s3_insert_child_shipment", ok: true, detail: `shipment_id=${childShipmentId}` });

    // Mint position for M2's manual item
    const rpc2 = await resolveProductAndCountry(m2.client, fx.product_name!, fx.country!);
    if (!rpc2.ok) {
      steps.push({ step: "s3_resolve_m2", ok: false, error: rpc2.reason });
      return done("s3_resolve_m2");
    }
    const pos2 = await m2.client.rpc("rpc_position_create_draft" as never, {
      p_product_id: rpc2.productId,
      p_product_origin_country_id: rpc2.countryId,
      p_source_context: "qa_mcp_direct_dogruz",
      p_source_row_key: `${run_id}:child_item`,
      p_caliber: fx.caliber ?? undefined,
      p_package_used: fx.package_used ?? undefined,
      p_responsible_manager_id: m2ImportManagerId ?? undefined,
    } as never);
    const pos2Arr = pos2.data as { position_id?: string | null }[] | null;
    const positionId2 = Array.isArray(pos2Arr) ? pos2Arr[0]?.position_id ?? null : null;
    if (pos2.error || !positionId2) {
      steps.push({ step: "s3_position_create_draft_m2", ok: false, error: sanitizeErr(pos2.error?.message ?? "no_position_id") });
      return done("s3_position_create_draft_m2");
    }
    captured.positions.push({ position_id: positionId2, source_row_key: `${run_id}:child_item` });
    invariants.position_id_minted_count += 1;
    steps.push({ step: "s3_position_create_draft_m2", ok: true, detail: `position_id=${positionId2}` });

    const childPallets = 3;
    const childNet = childPallets * 800;
    const childGross = childPallets * 900;
    const childItemIns = await m2.client
      .from("shipment_items" as never)
      .insert({
        shipment_id: childShipmentId,
        product_name: fx.product_name!,
        origin_country: fx.country!,
        caliber: fx.caliber ?? null,
        package_used: fx.package_used ?? null,
        pallet_count: childPallets,
        net_weight_kg: childNet,
        gross_weight_kg: childGross,
        pallet_weight: childNet / childPallets,
        qty: childNet,
        unit: "kg",
        unit_price: 1,
        price_currency: "USD",
      } as never)
      .select("id")
      .single();
    const childItemRow = childItemIns.data as { id: string } | null;
    if (childItemIns.error || !childItemRow) {
      steps.push({ step: "s3_insert_child_item", ok: false, error: sanitizeErr(childItemIns.error?.message ?? "insert_failed") });
      return done("s3_insert_child_item");
    }
    const childItemId = childItemRow.id;
    captured.shipment_items.push({ id: childItemId, shipment_id: childShipmentId, position_id: positionId2 });
    steps.push({ step: "s3_insert_child_item", ok: true, detail: `item_id=${childItemId}` });

    const attach2 = await m2.client.rpc("rpc_position_attach_shipment" as never, {
      p_shipment_item_id: childItemId,
      p_position_id: positionId2,
      p_pallet_qty_linked: childPallets,
    } as never);
    if (attach2.error) {
      steps.push({ step: "s3_attach_shipment_m2", ok: false, error: sanitizeErr(attach2.error.message) });
      return done("s3_attach_shipment_m2");
    }
    steps.push({ step: "s3_attach_shipment_m2", ok: true });

    // --- S4. Invariants --------------------------------------------------
    const vFinal = await m1.client
      .from("vehicles" as never)
      .select("id,code,status")
      .eq("id", vehicleId)
      .maybeSingle();
    const vFinalRow = vFinal.data as { id: string; code: string; status: string } | null;
    invariants.vehicle_status_open = !!vFinalRow && vFinalRow.status === "open";
    invariants.parent_vehicle_code_reused = !!vFinalRow && vFinalRow.code === vehicleCode;

    const shipmentsInVehicle = await m1.client
      .from("shipments" as never)
      .select("id,code,created_by,vehicle_id")
      .eq("vehicle_id", vehicleId);
    if (shipmentsInVehicle.error) {
      steps.push({ step: "s4_invariants_shipments", ok: false, error: sanitizeErr(shipmentsInVehicle.error.message) });
      return done("s4_invariants_shipments");
    }
    const shipRows = (shipmentsInVehicle.data ?? []) as { id: string; code: string; created_by: string; vehicle_id: string }[];
    invariants.two_shipments_same_vehicle = shipRows.length === 2
      && shipRows.every((r) => r.vehicle_id === vehicleId);
    const distinctCreators = new Set(shipRows.map((r) => r.created_by));
    invariants.two_distinct_managers = distinctCreators.size === 2
      && distinctCreators.has(m1.userId) && distinctCreators.has(m2.userId);
    const childInSet = shipRows.find((r) => r.id === childShipmentId);
    invariants.no_second_vehicle = !!childInSet && childInSet.vehicle_id === vehicleId;

    // Shipment codes share vehicle suffix `${ccode}-${pad3(vehicleSeq)}`.
    const suffix = vehicleCode.toUpperCase();
    invariants.shipment_codes_share_vehicle_suffix = shipRows.length === 2
      && shipRows.every((r) => r.code.toUpperCase().endsWith(suffix));

    // No offers/responses created by this run (we never inserted any).
    invariants.no_offers_created = captured.offers.length === 0;
    invariants.no_offer_responses_created = captured.offer_responses.length === 0;

    // No reserves created: assert via a captured-vehicle-scoped SELECT.
    const resChk = await m1.client
      .from("vehicle_reserves" as never)
      .select("id")
      .eq("vehicle_id", vehicleId)
      .limit(1);
    invariants.no_reserves_created = !resChk.error
      && Array.isArray(resChk.data)
      && (resChk.data as unknown[]).length === 0;

    // Item.position_id persisted for both
    const itemsChk = await m1.client
      .from("shipment_items" as never)
      .select("id,position_id")
      .in("id", [parentItemId, childItemId]);
    const itemRows = (itemsChk.data ?? []) as { id: string; position_id: string | null }[];
    const parentItemChk = itemRows.find((r) => r.id === parentItemId);
    const childItemChk = itemRows.find((r) => r.id === childItemId);
    invariants.parent_item_has_position_id = !!parentItemChk?.position_id && parentItemChk.position_id === positionId1;
    invariants.child_item_has_position_id = !!childItemChk?.position_id && childItemChk.position_id === positionId2;

    // Capacity: parent + child pallets/gross <= vehicle limits
    const totalPallets = parentPallets + childPallets;
    const totalGross = parentGross + childGross;
    invariants.total_pallets_within_limit = totalPallets <= VEHICLE_MAX_PALLETS;
    invariants.total_gross_within_limit = totalGross <= VEHICLE_MAX_GROSS_KG;

    const coreOk =
      invariants.vehicle_status_open === true &&
      invariants.two_shipments_same_vehicle === true &&
      invariants.no_second_vehicle === true &&
      invariants.two_distinct_managers === true &&
      invariants.shipment_codes_share_vehicle_suffix === true &&
      invariants.parent_vehicle_code_reused === true &&
      invariants.no_offers_created === true &&
      invariants.no_offer_responses_created === true &&
      invariants.parent_item_has_position_id === true &&
      invariants.child_item_has_position_id === true &&
      invariants.total_pallets_within_limit === true &&
      invariants.total_gross_within_limit === true;

    steps.push({
      step: "s4_invariants",
      ok: coreOk,
      detail: JSON.stringify(invariants),
      error: coreOk ? undefined : "invariant_failed",
    });
    if (!coreOk) return done("s4_invariants");

    return done(null);
  } catch (e) {
    steps.push({ step: "unexpected", ok: false, error: sanitizeErr(e) });
    return done("unexpected");
  } finally {
    await Promise.all([m1.signOut(), m2.signOut()]);
  }
}
