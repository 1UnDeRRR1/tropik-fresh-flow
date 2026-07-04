// src/lib/mcp/qa/actors.server.ts
// Server-only: build a JWT-scoped Supabase client per QA test user by calling
// signInWithPassword against the publishable key. Never imports or exposes
// service_role. Sessions are not persisted; storage is disabled so no
// localStorage leak is possible in a Worker context.
//
// Used exclusively by qa_probe_users in this Build. The future write-runner
// will import the same helpers to run scenario steps under real user JWTs.
//
// Rules:
//   - Never returns access tokens to callers.
//   - Never logs email/password/token.
//   - Always calls signOut() after each per-user probe.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { QaTestUserCredential } from "./env";

type ClientLike = SupabaseClient<any, "public", any>;

function newPublishableClient(): ClientLike {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not configured");
  }
  return createClient(url, key, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  }) as ClientLike;
}

export type SignInProbeResult = {
  handle: string;
  configured: true;
  signed_in: boolean;
  user_id: string | null;
  role_match: boolean | null;
  role_detected: string | null;
  expected_role: string;
  expected_import_manager_id: string | null;
  import_manager_link_ok: boolean | null;
  expected_branch_id: string | null;
  branch_link_ok: boolean | null;
  sign_in_error?: string;
};

/** Sanitize an error message so it never echoes email/password/token content. */
function sanitize(msg: string): string {
  return msg
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "<email>")
    .replace(/[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}/g, "<token>")
    .slice(0, 300);
}

/**
 * Sign in as one test user, verify role + reference links under that user's
 * JWT (RLS applies), then sign out. Never returns tokens.
 */
export async function probeTestUser(cred: QaTestUserCredential): Promise<SignInProbeResult> {
  const result: SignInProbeResult = {
    handle: cred.handle,
    configured: true,
    signed_in: false,
    user_id: null,
    role_match: null,
    role_detected: null,
    expected_role: cred.expected_role,
    expected_import_manager_id: cred.expected_import_manager_id,
    import_manager_link_ok: null,
    expected_branch_id: cred.expected_branch_id,
    branch_link_ok: null,
  };

  let client: ClientLike;
  try {
    client = newPublishableClient();
  } catch (e) {
    result.sign_in_error = sanitize(e instanceof Error ? e.message : String(e));
    return result;
  }

  try {
    const signIn = await client.auth.signInWithPassword({
      email: cred.email,
      password: cred.password,
    });
    if (signIn.error || !signIn.data.user) {
      result.sign_in_error = sanitize(signIn.error?.message ?? "sign_in_failed");
      return result;
    }
    result.signed_in = true;
    result.user_id = signIn.data.user.id;

    // Role probe: prefer has_role RPC (security-definer, unaffected by RLS).
    // If the RPC is unavailable, fall back to a user-scoped user_roles SELECT.
    try {
      const rpc = await client.rpc("has_role" as never, {
        _user_id: signIn.data.user.id,
        _role: cred.expected_role as never,
      } as never);
      if (!rpc.error && typeof rpc.data === "boolean") {
        result.role_match = rpc.data;
        result.role_detected = rpc.data ? cred.expected_role : null;
      }
    } catch {
      // ignore, fall through to fallback
    }
    if (result.role_match === null) {
      const roleRows = await client
        .from("user_roles" as never)
        .select("role")
        .eq("user_id", signIn.data.user.id);
      if (!roleRows.error && Array.isArray(roleRows.data)) {
        const roles = (roleRows.data as { role: string }[]).map((r) => r.role);
        result.role_detected = roles.join(",") || null;
        result.role_match = roles.includes(cred.expected_role);
      }
    }

    // Reference-link cross-checks (RLS-scoped selects).
    if (cred.expected_import_manager_id) {
      const q = await client
        .from("import_managers" as never)
        .select("id")
        .eq("id", cred.expected_import_manager_id)
        .maybeSingle();
      result.import_manager_link_ok = !q.error && !!q.data;
    }
    if (cred.expected_branch_id) {
      const q = await client
        .from("branches" as never)
        .select("id")
        .eq("id", cred.expected_branch_id)
        .maybeSingle();
      result.branch_link_ok = !q.error && !!q.data;
    }
  } catch (e) {
    result.sign_in_error = sanitize(e instanceof Error ? e.message : String(e));
  } finally {
    try { await client.auth.signOut(); } catch { /* ignore */ }
  }

  return result;
}
