// src/lib/mcp/qa/actor-clients.server.ts
// Server-only: sign in a QA test actor via publishable key + email/password
// and return a JWT-scoped Supabase client. Never persists sessions. Never
// returns access tokens to callers. Callers MUST call signOut() when done.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { QaTestUserCredential } from "./env";

export type ActorClient = SupabaseClient<any, "public", any>;

function newPublishableClient(): ActorClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not configured");
  }
  return createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  }) as ActorClient;
}

/** Sanitize error strings — never echo emails, passwords, tokens. */
export function sanitizeErr(msg: unknown): string {
  const s = msg instanceof Error ? msg.message : typeof msg === "string" ? msg : String(msg);
  return s
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "<email>")
    .replace(/[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}\.[A-Za-z0-9-_]{20,}/g, "<token>")
    .slice(0, 300);
}

export type SignedInActor = {
  client: ActorClient;
  userId: string;
  signOut: () => Promise<void>;
};

export type SignInActorResult =
  | { ok: true; actor: SignedInActor }
  | { ok: false; reason: string };

export async function signInActor(cred: QaTestUserCredential): Promise<SignInActorResult> {
  let client: ActorClient;
  try {
    client = newPublishableClient();
  } catch (e) {
    return { ok: false, reason: sanitizeErr(e) };
  }
  const res = await client.auth.signInWithPassword({
    email: cred.email,
    password: cred.password,
  });
  if (res.error || !res.data.user) {
    try { await client.auth.signOut(); } catch { /* ignore */ }
    return { ok: false, reason: sanitizeErr(res.error?.message ?? "sign_in_failed") };
  }
  const userId = res.data.user.id;
  return {
    ok: true,
    actor: {
      client,
      userId,
      signOut: async () => { try { await client.auth.signOut(); } catch { /* ignore */ } },
    },
  };
}
