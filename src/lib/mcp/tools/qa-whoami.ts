// src/lib/mcp/tools/qa-whoami.ts
// Read-only QA-MCP health probe. Returns booleans and gate status only.
// Never reads business data, secrets, JWTs, or DB rows.
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { qaGateStatus, isQaAdminUser } from "../qa/env";

export default defineTool({
  name: "qa_whoami",
  title: "QA whoami / health",
  description:
    "Read-only QA-MCP health probe. Returns booleans and gate status only. Does not read business data, secrets, JWTs, or DB rows.",
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_args, ctx: ToolContext) => {
    const gate = qaGateStatus();
    const authed = ctx.isAuthenticated();
    const uid = authed ? ctx.getUserId() ?? null : null;
    const payload = {
      qa_mcp_enabled: gate.enabled,
      detected_environment: process.env.NODE_ENV ?? "unknown",
      project_ref: gate.project_ref,
      allowed_project_ref_match: gate.allowed_project_ref_match,
      supabase_env_present: gate.supabase_env,
      admin_user_ids_configured: gate.admin_user_ids_configured,
      mcp_user_authenticated: authed,
      mcp_user_id: uid,
      mcp_user_is_qa_admin: isQaAdminUser(uid),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
