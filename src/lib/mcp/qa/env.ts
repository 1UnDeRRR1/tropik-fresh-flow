// src/lib/mcp/qa/env.ts
// Pure env gate + shared Supabase-ref parser + pure JSON parsers for QA-MCP
// probe tools. No I/O, no Supabase imports, no throws at module scope.
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

// ---------------------------------------------------------------------------
// QA_MCP_TEST_USER_CREDENTIALS parser (pure).
// Returns either `{ ok: true, credentials }` or `{ ok: false, reason, detail }`.
// Never throws. Never logs. Never echoes passwords.
// ---------------------------------------------------------------------------

export type QaTestUserCredential = {
  handle: string;
  email: string;
  password: string;
  expected_role: string;
  expected_import_manager_id: string | null;
  expected_branch_id: string | null;
  expected_supplier_ids: string[];
};

export type ReadCredentialsResult =
  | { ok: true; credentials: QaTestUserCredential[] }
  | { ok: false; reason: "missing_credentials" | "config_invalid"; detail: string };

const REQUIRED_HANDLES = [
  "qa_import_manager_1",
  "qa_import_manager_2",
  "qa_branch_A",
  "qa_branch_B",
  "qa_logistics",
] as const;

function isStr(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

export function readTestUserCredentials(): ReadCredentialsResult {
  const raw = process.env.QA_MCP_TEST_USER_CREDENTIALS?.trim();
  if (!raw) {
    return { ok: false, reason: "missing_credentials", detail: "QA_MCP_TEST_USER_CREDENTIALS is not set" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      reason: "config_invalid",
      detail: `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "config_invalid", detail: "Root must be a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;
  const out: QaTestUserCredential[] = [];
  const problems: string[] = [];
  for (const handle of REQUIRED_HANDLES) {
    const v = obj[handle];
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      problems.push(`${handle}: missing or not an object`);
      continue;
    }
    const r = v as Record<string, unknown>;
    if (!isStr(r.email)) { problems.push(`${handle}.email must be a non-empty string`); continue; }
    if (!isStr(r.password)) { problems.push(`${handle}.password must be a non-empty string`); continue; }
    if (!isStr(r.expected_role)) { problems.push(`${handle}.expected_role must be a non-empty string`); continue; }
    const expIm = r.expected_import_manager_id;
    const expBr = r.expected_branch_id;
    const expSup = r.expected_supplier_ids;
    out.push({
      handle,
      email: r.email,
      password: r.password,
      expected_role: r.expected_role,
      expected_import_manager_id: isStr(expIm) ? expIm : null,
      expected_branch_id: isStr(expBr) ? expBr : null,
      expected_supplier_ids: Array.isArray(expSup) ? expSup.filter(isStr) : [],
    });
  }
  if (problems.length > 0) {
    return { ok: false, reason: "config_invalid", detail: problems.join("; ") };
  }
  return { ok: true, credentials: out };
}

// ---------------------------------------------------------------------------
// QA_MCP_FIXTURES_JSON parser (pure). Optional.
// ---------------------------------------------------------------------------

export type QaFixturesConfig = {
  supplier_id: string | null;
  country: string | null;
  loading_country: string | null;
  product_name: string | null;
  caliber: string | null;
  package_used: string | null;
  branch_a_id: string | null;
  branch_b_id: string | null;
};

export type ReadFixturesResult =
  | { ok: true; fixtures: QaFixturesConfig }
  | { ok: false; reason: "missing" | "config_invalid"; detail: string };

export function readFixturesConfig(): ReadFixturesResult {
  const raw = process.env.QA_MCP_FIXTURES_JSON?.trim();
  if (!raw) return { ok: false, reason: "missing", detail: "QA_MCP_FIXTURES_JSON is not set" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      ok: false,
      reason: "config_invalid",
      detail: `JSON parse error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "config_invalid", detail: "Root must be a JSON object" };
  }
  const r = parsed as Record<string, unknown>;
  const pick = (k: string): string | null => (isStr(r[k]) ? (r[k] as string) : null);
  return {
    ok: true,
    fixtures: {
      supplier_id: pick("supplier_id"),
      country: pick("country"),
      loading_country: pick("loading_country"),
      product_name: pick("product_name"),
      caliber: pick("caliber"),
      package_used: pick("package_used"),
      branch_a_id: pick("branch_a_id"),
      branch_b_id: pick("branch_b_id"),
    },
  };
}
