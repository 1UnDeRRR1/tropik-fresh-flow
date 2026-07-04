// src/lib/mcp/tools/qa-probe-users.ts
// Read-only preflight probe: verifies QA test users are configured and can
// sign in. Never creates users, never changes roles, never touches Auth
// schema. Returns structured `{ ok:false, reason }` when credentials are
// missing or invalid — does NOT throw.

import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { isQaAdminUser, qaGateStatus, readTestUserCredentials } from "../qa/env";
import { probeTestUser, type SignInProbeResult } from "../qa/actors.server";

type MissingResult = {
  handle: string;
  configured: false;
  signed_in: false;
  user_id: null;
  role_match: null;
  role_detected: null;
  expected_role: string | null;
  expected_import_manager_id: null;
  import_manager_link_ok: null;
  expected_branch_id: null;
  branch_link_ok: null;
  missing_reason: "not_in_credentials_json";
};

const REQUIRED = [
  "qa_import_manager_1",
  "qa_import_manager_2",
  "qa_branch_A",
  "qa_branch_B",
  "qa_logistics",
] as const;

export default defineTool({
  name: "qa_probe_users",
  title: "QA probe users",
  description:
    "Read-only preflight: sign in each configured QA test user via publishable key, verify role and reference links under that user's JWT, then sign out. Never creates users, never mutates roles, never returns tokens.",
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

    const cfg = readTestUserCredentials();
    if (!cfg.ok) {
      const payload = {
        ok: false as const,
        reason: cfg.reason,
        detail: cfg.detail,
        missing_handles: [...REQUIRED],
        config_errors: cfg.reason === "config_invalid" ? [cfg.detail] : [],
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    }

    const byHandle = new Map(cfg.credentials.map((c) => [c.handle, c]));
    const users: (SignInProbeResult | MissingResult)[] = [];
    const missing_handles: string[] = [];

    for (const handle of REQUIRED) {
      const cred = byHandle.get(handle);
      if (!cred) {
        missing_handles.push(handle);
        users.push({
          handle,
          configured: false,
          signed_in: false,
          user_id: null,
          role_match: null,
          role_detected: null,
          expected_role: null,
          expected_import_manager_id: null,
          import_manager_link_ok: null,
          expected_branch_id: null,
          branch_link_ok: null,
          missing_reason: "not_in_credentials_json",
        });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      users.push(await probeTestUser(cred));
    }

    const allOk =
      missing_handles.length === 0 &&
      users.every((u) => u.configured && (u as SignInProbeResult).signed_in && (u as SignInProbeResult).role_match === true);

    const payload = {
      ok: allOk,
      users,
      missing_handles,
      config_errors: [] as string[],
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
  },
});
