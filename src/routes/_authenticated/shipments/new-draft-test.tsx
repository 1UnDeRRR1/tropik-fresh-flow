import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { DraftOfferLineRow } from "@/components/DraftOfferLineRow";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/shipments/new-draft-test")({
  component: NewDraftTestPage,
});

type AuthDebug = {
  hasSession: boolean;
  userId: string | null;
  email: string | null;
  role: string | null;
  aud: string | null;
  tokenPreview: string | null;
  pingRole: string | null;
  pingError: string | null;
};

function NewDraftTestPage() {
  const navigate = useNavigate();
  const [auth, setAuth] = useState<AuthDebug | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      const token = session?.access_token ?? null;

      // Ping: ask Postgres which role it sees us as.
      let pingRole: string | null = null;
      let pingError: string | null = null;
      try {
        const { data: r, error } = await supabase.rpc("rpc_resolve_offer_line_defaults", {
          p_product_input: "__ping__",
          p_country_input: "Spain",
          p_package_input: null,
          p_force_refresh: false,
        });
        if (error) pingError = `${error.code ?? ""} ${error.message}`;
        else pingRole = `ok (${Array.isArray(r) ? r.length : typeof r} rows)`;
      } catch (e) {
        pingError = (e as Error).message;
      }

      // Parse role from JWT (best-effort, client-side only — debug)
      let role: string | null = null;
      let aud: string | null = null;
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split(".")[1]));
          role = payload.role ?? null;
          aud = payload.aud ?? null;
        } catch {
          /* ignore */
        }
      }

      if (!cancelled) {
        setAuth({
          hasSession: !!session,
          userId: session?.user?.id ?? null,
          email: session?.user?.email ?? null,
          role,
          aud,
          tokenPreview: token ? `${token.slice(0, 12)}…${token.slice(-6)}` : null,
          pingRole,
          pingError,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Нова поставка · draft test"
        subtitle="Тестова таблиця для перевірки resolver/autofill. Дані не зберігаються в БД."
        action={
          <Button variant="outline" onClick={() => navigate({ to: "/shipments" })}>
            Закрити
          </Button>
        }
      />

      <div className="rounded-md border bg-muted/30 p-3 text-xs font-mono">
        <div className="mb-1 font-semibold">Auth debug</div>
        {!auth ? (
          <div>checking session…</div>
        ) : (
          <pre className="whitespace-pre-wrap">{JSON.stringify(auth, null, 2)}</pre>
        )}
      </div>

      <DraftOfferLineRow onConfirmToast={(m) => toast(m)} />
    </div>
  );
}
