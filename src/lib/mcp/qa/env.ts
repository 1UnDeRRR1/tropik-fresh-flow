// src/lib/mcp/qa/env.ts
// Pure env gate + shared Supabase-ref parser. No I/O, no Supabase imports, no throws.
// Runtime gates for QA-MCP. Registration is a separate build-time decision
// (see src/lib/mcp/index.ts, VITE_QA_MCP_TOOLS_ENABLED).

const REF_RE = /^https:\/\/([a-z0-9-]+)\.supabase\.co/i;

export function parseSupabaseRef(url: string | undefined | null): string | null {
  if (!url) return null;
  const m = url.match(REF_RE);
  return m ? m[1] : null;
}

export type QaGateStatus = {
  enabled: boolean;
  project_ref: string | null;
  allowed_project_ref_match: boolean;
  supabase_env: { url: boolean; publishable_key: boolean };
  admin_user_ids_configured: boolean;
};

export function resolveQaProjectRef(): string | null {
  const override = process.env.QA_SUPABASE_PROJECT_REF?.trim();
  if (override) return override;
  return parseSupabaseRef(process.env.SUPABASE_URL);
}

export function qaGateStatus(): QaGateStatus {
  const enabled = process.env.QA_MCP_ENABLED === "true";
  const ref = resolveQaProjectRef();
  const allowList = (process.env.QA_MCP_ALLOWED_PROJECT_REFS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const admins = (process.env.QA_MCP_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    enabled,
    project_ref: ref,
    allowed_project_ref_match: !!ref && allowList.includes(ref),
    supabase_env: {
      url: !!process.env.SUPABASE_URL,
      publishable_key: !!process.env.SUPABASE_PUBLISHABLE_KEY,
    },
    admin_user_ids_configured: admins.length > 0,
  };
}

export function isQaAdminUser(userId: string | undefined | null): boolean {
  if (!userId) return false;
  const admins = (process.env.QA_MCP_ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return admins.includes(userId);
}
