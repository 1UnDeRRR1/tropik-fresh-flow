// src/lib/mcp/qa/primitives-catalog.ts
// Pure constant module — single source of truth for the primitives the future
// write-runner will call. `qa_probe_primitives` uses this catalog to know what
// to probe (read-only kind) and what to declare (mutating kind, NEVER called
// in a no-write Build).
//
// No I/O. No imports. Safe to import from anywhere.

export type PrimitiveKind = "rpc_read_only" | "rpc_mutating" | "table" | "view";

export type PrimitiveEntry = {
  name: string;
  kind: PrimitiveKind;
  purpose: string;
  /** For tables/views: columns the future runner reads/writes; probed via
   * `SELECT <col> ... LIMIT 0`. For RPCs: informational only. */
  columns?: string[];
};

// Safe-to-call RPCs: pure lookups / predicates. Probing calls them with
// deterministic no-op inputs and classifies by response / SQLSTATE.
export const READ_ONLY_RPCS: PrimitiveEntry[] = [
  { name: "rpc_resolve_country", kind: "rpc_read_only", purpose: "Canonicalise a country name to countries row." },
  { name: "rpc_resolve_product_exact", kind: "rpc_read_only", purpose: "Resolve product name + variety to a products row." },
  { name: "has_role", kind: "rpc_read_only", purpose: "Predicate: does user_id have the given app_role." },
  { name: "current_import_manager_id", kind: "rpc_read_only", purpose: "Return the import_managers.id linked to a user_id." },
];

// Mutating RPCs — DECLARED but NEVER executed in a no-write Build.
// The future write-runner slice will inline these against per-actor JWT
// clients, wrapped by qa_run_full_shipment_flow + qa_cleanup_run.
export const MUTATING_RPCS: PrimitiveEntry[] = [
  { name: "rpc_position_create_draft", kind: "rpc_mutating", purpose: "Mint a new operational_position row." },
  { name: "rpc_position_attach_offer", kind: "rpc_mutating", purpose: "Attach an offer to an existing position." },
  { name: "rpc_position_attach_shipment", kind: "rpc_mutating", purpose: "Attach a shipment_item to an existing position." },
  { name: "rpc_position_rollback_birth", kind: "rpc_mutating", purpose: "Undo a freshly minted position (rollback path)." },
  { name: "link_offer_to_shipment_item_fifo", kind: "rpc_mutating", purpose: "Consume manager_offer allocation into a shipment_item FIFO-style." },
  { name: "create_vehicle_reserve", kind: "rpc_mutating", purpose: "Reserve pallets/gross on an open vehicle for a manager." },
  { name: "release_vehicle_reserve", kind: "rpc_mutating", purpose: "Release a caller's reserve." },
  { name: "close_vehicle_reserves", kind: "rpc_mutating", purpose: "Close all reserves on a vehicle." },
  { name: "confirm_shipment_item_customs_override", kind: "rpc_mutating", purpose: "Confirm manual customs duty override on shipment_item." },
  { name: "archive_cancel_manager_offer", kind: "rpc_mutating", purpose: "Cancel manager_offer + write archive snapshots." },
];

// Tables the future runner will INSERT/UPDATE/DELETE against. Probed here
// with `SELECT <col> LIMIT 0` only — existence + column presence, no data.
export const TABLES: PrimitiveEntry[] = [
  { name: "manager_offers", kind: "table", purpose: "Offer parent row.", columns: ["id", "status", "import_manager_id", "created_by"] },
  { name: "manager_offer_targets", kind: "table", purpose: "Offer → branch targets.", columns: ["id", "offer_id", "branch_id"] },
  { name: "manager_offer_responses", kind: "table", purpose: "Branch response rows.", columns: ["id", "offer_id", "branch_id", "approved_pallets", "status"] },
  { name: "manager_offer_allocation_parts", kind: "table", purpose: "Fact-only allocation ledger.", columns: ["id", "status", "shipment_id", "shipment_item_id"] },
  { name: "manager_offer_shipment_links", kind: "table", purpose: "Offer ↔ shipment linkage.", columns: ["id", "offer_id", "shipment_id"] },
  { name: "branch_requests", kind: "table", purpose: "Branch → HQ requests.", columns: ["id", "branch_id", "status"] },
  { name: "branch_request_items", kind: "table", purpose: "Requested lines.", columns: ["id", "request_id", "product_id"] },
  { name: "vehicles", kind: "table", purpose: "Truck / vehicle envelope.", columns: ["id", "code", "status", "country"] },
  { name: "shipments", kind: "table", purpose: "Shipment parent row.", columns: ["id", "code", "vehicle_id", "supplier_id", "import_manager_id", "created_by"] },
  { name: "shipment_items", kind: "table", purpose: "Products within a shipment.", columns: ["id", "shipment_id", "product_id", "pallet_count", "position_id"] },
  { name: "shipment_item_changes", kind: "table", purpose: "Audit trail of item changes.", columns: ["id", "shipment_item_id"] },
  { name: "shipment_changes", kind: "table", purpose: "Audit trail of shipment changes.", columns: ["id", "shipment_id"] },
  { name: "operational_positions", kind: "table", purpose: "Product position lifecycle anchor.", columns: ["id"] },
  { name: "position_shipment_links", kind: "table", purpose: "Position ↔ shipment_item links.", columns: ["id", "position_id", "shipment_item_id"] },
  { name: "vehicle_reserves", kind: "table", purpose: "Reserve capacity on open vehicle.", columns: ["id", "vehicle_id", "owner_user_id", "pallets", "gross_kg", "status"] },
  { name: "distributions", kind: "table", purpose: "Distribution parent row.", columns: ["id", "shipment_id"] },
  { name: "distribution_items", kind: "table", purpose: "Distribution allocation lines.", columns: ["id", "distribution_id"] },
];

// Views the future runner reads (branch price boundary).
export const VIEWS: PrimitiveEntry[] = [
  { name: "branch_visible_prices", kind: "view", purpose: "Branch-safe price projection.", columns: ["shipment_item_id"] },
];

export const ALL_PRIMITIVES: PrimitiveEntry[] = [
  ...READ_ONLY_RPCS,
  ...MUTATING_RPCS,
  ...TABLES,
  ...VIEWS,
];
