// src/lib/mcp/tools/qa-probe-primitives.ts
// Truly no-write preflight probe.
//
// Read-only RPCs: called with deterministic no-op inputs and classified by
// response / SQLSTATE (`42883` = missing, `42501` = forbidden, application-
// level error = reachable).
//
// Mutating RPCs: DECLARED, never executed. There is no safe catalog-read
// path from PostgREST without adding a DB object, and adding a DB object is
// forbidden in this Build. Reported with:
//   status: "declared_not_called_no_write_build"
//   catalog_exists: "unknown"
//   note: "not checked because no safe existing catalog-read path is available"
//
// Tables/views: `SELECT <cols> LIMIT 0` via service_role SELECT-only wrapper.

import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { isQaAdminUser, qaGateStatus } from "../qa/env";
import { probeColumns, readOnlyAdmin } from "../qa/discovery.server";
import {
  MUTATING_RPCS,
  READ_ONLY_RPCS,
  TABLES,
  VIEWS,
  type PrimitiveEntry,
} from "../qa/primitives-catalog";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type ReadOnlyProbe = {
  name: string;
  kind: "rpc" | "table" | "view";
  exists: boolean;
  reachable: boolean;
  sqlstate?: string;
  error_class?: "missing" | "forbidden" | "app_error" | "unknown";
  columns_present?: string[];
  columns_missing?: string[];
  error_message_sanitized?: string;
};

function classifyRpcError(e: { code?: string; message?: string } | null): {
  exists: boolean;
  reachable: boolean;
  error_class: ReadOnlyProbe["error_class"];
  sqlstate?: string;
} {
  if (!e) return { exists: true, reachable: true, error_class: undefined };
  const code = e.code ?? "";
  if (code === "42883" || code === "PGRST202" || /does not exist/i.test(e.message ?? "")) {
    return { exists: false, reachable: false, error_class: "missing", sqlstate: code || undefined };
  }
  if (code === "42501") {
    return { exists: true, reachable: false, error_class: "forbidden", sqlstate: code };
  }
  // Any application error means the function exists and ran.
  return { exists: true, reachable: true, error_class: "app_error", sqlstate: code || undefined };
}

function sanitize(msg: string | undefined): string | undefined {
  if (!msg) return undefined;
  return msg.slice(0, 200);
}

async function probeReadOnlyRpc(entry: PrimitiveEntry): Promise<ReadOnlyProbe> {
  // Deterministic no-op inputs: an all-zero UUID for id args, empty string
  // for text lookups. Read-only RPCs are safe against these — they return
  // NULL or throw "not found", never write.
  const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
  let payload: Record<string, unknown> = {};
  switch (entry.name) {
    case "rpc_resolve_country":
      // Real signature: rpc_resolve_country({ p_input })
      payload = { p_input: "" };
      break;
    case "rpc_resolve_product_exact":
      // Real signature: rpc_resolve_product_exact({ p_query, p_include_reserve? })
      payload = { p_query: "", p_include_reserve: false };
      break;
    case "has_role":
      payload = { _user_id: ZERO_UUID, _role: "import_manager" };
      break;
    case "current_import_manager_id":
      // Real signature: no arguments (Args: never).
      payload = {};
      break;
    default:
      payload = {};
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (supabaseAdmin as any).rpc(entry.name, payload);
    const cls = classifyRpcError(res.error ?? null);
    return {
      name: entry.name,
      kind: "rpc",
      exists: cls.exists,
      reachable: cls.reachable,
      sqlstate: cls.sqlstate,
      error_class: cls.error_class,
      error_message_sanitized: sanitize(res.error?.message),
    };
  } catch (e) {
    return {
      name: entry.name,
      kind: "rpc",
      exists: false,
      reachable: false,
      error_class: "unknown",
      error_message_sanitized: sanitize(e instanceof Error ? e.message : String(e)),
    };
  }
}

async function probeTableOrView(entry: PrimitiveEntry, kind: "table" | "view"): Promise<ReadOnlyProbe> {
  const cols = entry.columns && entry.columns.length > 0 ? entry.columns : ["*"];
  if (cols[0] === "*") {
    const r = await readOnlyAdmin.read(entry.name).select("*").limit(0).run();
    if (!r.error) return { name: entry.name, kind, exists: true, reachable: true };
    return {
      name: entry.name,
      kind,
      exists: false,
      reachable: false,
      sqlstate: r.error.code,
      error_class: r.error.code === "42P01" ? "missing" : "unknown",
      error_message_sanitized: sanitize(r.error.message),
    };
  }
  const probe = await probeColumns(entry.name, cols);
  return {
    name: entry.name,
    kind,
    exists: probe.exists,
    reachable: probe.exists,
    sqlstate: probe.sqlstate,
    error_class: probe.exists ? undefined : (probe.sqlstate === "42P01" ? "missing" : "unknown"),
    columns_present: probe.columns_present,
    columns_missing: probe.columns_missing,
    error_message_sanitized: sanitize(probe.error_message),
  };
}

export default defineTool({
  name: "qa_probe_primitives",
  title: "QA probe primitives",
  description:
    "Read-only preflight. Calls only known safe read-only RPCs (rpc_resolve_country, rpc_resolve_product_exact, has_role, current_import_manager_id) with no-op arguments. Table/view existence via SELECT ... LIMIT 0 through the SELECT-only wrapper. Mutating RPCs are DECLARED but NEVER executed in this no-write Build; catalog_exists is reported as \"unknown\" because no safe existing catalog-read path is available.",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx: ToolContext) => {
    const gate = qaGateStatus();
    const uid = ctx.isAuthenticated() ? ctx.getUserId() ?? null : null;
    const admin = isQaAdminUser(uid);
    if (!gate.enabled || !gate.allowed_project_ref_match || !admin) {
      const payload = {
        ok: false as const,
        reason: "forbidden_or_disabled" as const,
        gate: {
          qa_mcp_enabled: gate.enabled,
          allowed_project_ref_match: gate.allowed_project_ref_match,
          admin_user_ids_configured: gate.admin_user_ids_configured,
          mcp_user_is_qa_admin: admin,
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    }

    const read_only_probes: ReadOnlyProbe[] = [];
    for (const r of READ_ONLY_RPCS) {
      // eslint-disable-next-line no-await-in-loop
      read_only_probes.push(await probeReadOnlyRpc(r));
    }
    for (const t of TABLES) {
      // eslint-disable-next-line no-await-in-loop
      read_only_probes.push(await probeTableOrView(t, "table"));
    }
    for (const v of VIEWS) {
      // eslint-disable-next-line no-await-in-loop
      read_only_probes.push(await probeTableOrView(v, "view"));
    }

    const required_future_primitives = MUTATING_RPCS.map((r) => ({
      name: r.name,
      kind: "rpc" as const,
      status: "declared_not_called_no_write_build" as const,
      catalog_exists: "unknown" as const,
      note: "not checked because no safe existing catalog-read path is available",
      purpose: r.purpose,
    }));

    const gaps = read_only_probes.filter((p) => !p.exists).map((p) => p.name);
    const ok = gaps.length === 0;

    const payload = {
      ok,
      read_only_probes,
      required_future_primitives,
      gaps,
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
  },
});
