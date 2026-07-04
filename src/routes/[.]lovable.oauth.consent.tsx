// src/routes/[.]lovable.oauth.consent.tsx
// Managed Supabase OAuth consent screen for /mcp.
// Users bounce to /login with a `next` param when unauthenticated; login
// returns them here with the same authorization_id.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// The beta supabase.auth.oauth namespace is not in the shipped types; keep a
// tight local wrapper so we don't touch the auto-generated client.
type OauthAuthzDetails = {
  client?: { name?: string; redirect_uris?: string[] } | null;
  redirect_url?: string;
  redirect_to?: string;
  scopes?: string[];
} | null;
type OauthResp = { data: OauthAuthzDetails; error: { message: string } | null };
function oauthClient() {
  return (supabase.auth as unknown as {
    oauth: {
      getAuthorizationDetails: (id: string) => Promise<OauthResp>;
      approveAuthorization: (id: string) => Promise<OauthResp>;
      denyAuthorization: (id: string) => Promise<OauthResp>;
    };
  }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s.authorization_id === "string" ? s.authorization_id : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/login", search: { next } });
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthClient().getAuthorizationDetails(authorizationId);
    if (error) throw new Error(error.message);
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main style={{ padding: 24, maxWidth: 480 }}>
      <h1>Помилка авторизації</h1>
      <p>{String((error as Error)?.message ?? error)}</p>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const oauth = oauthClient();
    const { data, error } = approve
      ? await oauth.approveAuthorization(authorization_id)
      : await oauth.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("No redirect returned by the authorization server.");
      return;
    }
    window.location.href = target;
  }

  const clientName = details?.client?.name ?? "застосунок";

  return (
    <main style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
        Підключити {clientName} до Tropik Fresh Flow
      </h1>
      <p style={{ marginBottom: 16, color: "#555" }}>
        Дозволяє {clientName} використовувати Tropik Fresh Flow від вашого імені.
        Права доступу визначаються ролями та політиками бази — цей дозвіл їх не розширює.
      </p>
      {error && (
        <p role="alert" style={{ color: "#b91c1c", marginBottom: 12 }}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 12 }}>
        <button
          disabled={busy}
          onClick={() => decide(true)}
          style={{
            padding: "10px 16px",
            background: "#111",
            color: "white",
            borderRadius: 8,
            border: "none",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          Дозволити
        </button>
        <button
          disabled={busy}
          onClick={() => decide(false)}
          style={{
            padding: "10px 16px",
            background: "transparent",
            color: "#111",
            borderRadius: 8,
            border: "1px solid #ccc",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          Відхилити
        </button>
      </div>
    </main>
  );
}
