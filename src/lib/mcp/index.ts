import { auth, defineMcp } from "@lovable.dev/mcp-js";
import echoTool from "./tools/echo";
import qaWhoamiTool from "./tools/qa-whoami";
import qaProbeUsersTool from "./tools/qa-probe-users";
import qaProbeFixturesTool from "./tools/qa-probe-fixtures";
import qaProbePrimitivesTool from "./tools/qa-probe-primitives";
import qaRunShipmentSmokeTool from "./tools/qa-run-shipment-smoke";
import qaCleanupRunTool from "./tools/qa-cleanup-run";
import { parseSupabaseRef } from "./qa/env";

// Resolve the Supabase OAuth issuer for /mcp.
// Order:
//   1. import.meta.env.VITE_MCP_OAUTH_ISSUER  (explicit full-URL override)
//   2. Parse import.meta.env.VITE_SUPABASE_URL → https://<ref>.supabase.co/auth/v1
// If neither resolves, fail closed at module load with a clear error.
// Vite inlines import.meta.env.VITE_* as string literals at build time, so the
// manifest extractor and the Worker cold-start both see the same value.
function resolveMcpOauthIssuer(): string {
  const override = (import.meta.env.VITE_MCP_OAUTH_ISSUER as string | undefined)?.trim();
  if (override) return override;
  const ref = parseSupabaseRef(import.meta.env.VITE_SUPABASE_URL as string | undefined);
  if (ref) return `https://${ref}.supabase.co/auth/v1`;
  throw new Error(
    "[mcp] Cannot resolve OAuth issuer: set VITE_MCP_OAUTH_ISSUER or ensure VITE_SUPABASE_URL is defined at build time.",
  );
}

// Registration is a BUILD-time decision (Vite inlines VITE_*), so the MCP
// manifest and the Worker bundle agree. Finer runtime gates (QA_MCP_ENABLED,
// project-ref match, admin allow-list) are enforced inside qa_whoami itself
// via process.env, and reported in its response payload.
const qaTools =
  import.meta.env.VITE_QA_MCP_TOOLS_ENABLED === "true"
    ? [
        qaWhoamiTool,
        qaProbeUsersTool,
        qaProbeFixturesTool,
        qaProbePrimitivesTool,
        qaRunShipmentSmokeTool,
        qaCleanupRunTool,
      ]
    : [];

export default defineMcp({
  name: "tropik-fresh-flow-mcp",
  title: "Tropik Fresh Flow MCP",
  version: "0.1.0",
  instructions:
    "Tools for Tropik Fresh Flow. `echo` verifies connectivity. QA tools (prefix `qa_`) are a read-only test harness, gated by env and admin allow-list; they never expose business data.",
  auth: auth.oauth.issuer({
    issuer: resolveMcpOauthIssuer(),
    acceptedAudiences: "authenticated",
  }),
  tools: [echoTool, ...qaTools],
});
