// src/lib/mcp/tools/qa-cleanup-run.ts
//
// Cleanup executor for a previous qa_run_shipment_smoke run. Accepts the
// captured_ids payload returned by the runner and deletes ONLY those rows
// in reverse dependency order. service_role is allowed here (per approved
// scope) because every delete is captured-id-scoped: no date filter, no
// broad DELETE, no reference/master data mutation. Idempotent.

import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isQaAdminUser, qaGateStatus } from "../qa/env";
import { cleanupCapturedIds, validateCapturedIds } from "../qa/cleanup.server";

export default defineTool({
  name: "qa_cleanup_run",
  title: "QA cleanup run",
  description:
    "QA-ONLY: delete rows created by a previous qa_run_shipment_smoke run, using its captured_ids payload. Deletes only by captured ids, in reverse dependency order. Idempotent — safe to rerun. Never touches reference/master data. Never uses date-based filters.",
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  inputSchema: {
    captured_ids: z
      .unknown()
      .describe("The `captured_ids` object returned by qa_run_shipment_smoke."),
  },
  handler: async ({ captured_ids }, ctx: ToolContext) => {
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

    const v = validateCapturedIds(captured_ids);
    if (!v.ok) {
      const payload = { ok: false as const, reason: "invalid_captured_ids" as const, detail: v.reason };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    }

    const result = await cleanupCapturedIds(v.ids);
    const payload = {
      ok: result.cleanup_ok,
      cleanup_ok: result.cleanup_ok,
      run_id: result.run_id,
      results: result.results,
      survivors: result.survivors,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
      isError: !result.cleanup_ok,
    };
  },
});
