// src/lib/mcp/tools/qa-direct-dogruz-no-offer.ts
//
// Gated QA-MCP write scenario: direct open-vehicle creation by M1 followed
// by a direct child shipment by M2 on the SAME vehicle. No offer, no branch
// response, no VS flow, no reserve, no close. Returns captured_ids for
// qa_cleanup_run. Never uses service_role. Never returns tokens.

import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import {
  isQaAdminUser,
  qaGateStatus,
  readFixturesConfig,
  readTestUserCredentials,
} from "../qa/env";
import { runDirectDogruzNoOffer } from "../qa/direct-dogruz.server";

export default defineTool({
  name: "qa_direct_dogruz_no_offer",
  title: "QA direct dogruz without offer",
  description:
    "QA-ONLY write scenario. Creates a direct open vehicle shipment with import manager 1, then creates a second direct shipment by import manager 2 inside the same open vehicle. No offer, no branch response, no VS, no reserve, no close. Returns captured_ids for qa_cleanup_run. Never returns tokens.",
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

    const result = await runDirectDogruzNoOffer({
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
