// src/lib/mcp/tools/qa-run-shipment-smoke.ts
//
// Gated E2E shipment lifecycle smoke runner. Executes real writes under
// actor JWTs from QA_MCP_TEST_USER_CREDENTIALS, then returns captured_ids
// for the caller to feed to qa_cleanup_run. Never uses service_role.
// Never returns tokens or passwords.

import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import {
  isQaAdminUser,
  qaGateStatus,
  readFixturesConfig,
  readTestUserCredentials,
} from "../qa/env";
import { runShipmentSmoke } from "../qa/scenario.server";

export default defineTool({
  name: "qa_run_shipment_smoke",
  title: "QA run shipment smoke",
  description:
    "QA-ONLY write-and-cleanup harness. Runs the real shipment lifecycle end to end (offer → branch response → take into work → shipment + item + child shipment on same vehicle) under actor JWTs, then returns captured_ids for qa_cleanup_run. Never uses service_role. Never returns tokens.",
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
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

    const creds = readTestUserCredentials();
    if (!creds.ok) {
      const payload = { ok: false as const, reason: creds.reason, detail: creds.detail };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    }
    const fx = readFixturesConfig();
    if (!fx.ok) {
      const payload = { ok: false as const, reason: fx.reason, detail: fx.detail };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    }

    const result = await runShipmentSmoke({
      credentials: creds.credentials,
      fixtures: fx.fixtures,
    });

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
      isError: !result.ok,
    };
  },
});
