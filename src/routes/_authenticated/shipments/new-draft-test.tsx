import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { DraftOfferLineRow } from "@/components/DraftOfferLineRow";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
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
  const { user, session, loading } = useAuth();
  const [auth, setAuth] = useState<AuthDebug | null>(null);

  const hasSession = !!session && !!user;

  useEffect(() => {
    if (!hasSession) {
      setAuth(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const s = data.session;
      const token = s?.access_token ?? null;

      let pingRole: string | null = null;
      let pingError: string | null = null;
      try {
        const { data: r, error } = await supabase.rpc("rpc_resolve_offer_line_defaults" as never, {
          p_product_query: "__ping__",
          p_country_query: "Spain",
          p_package_used: null,
          p_include_reserve: false,
        } as never);
        if (error) pingError = `${error.code ?? ""} ${error.message}`;
        else pingRole = `ok (${Array.isArray(r) ? (r as unknown[]).length : typeof r} rows)`;
      } catch (e) {
        pingError = (e as Error).message;
      }

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
          hasSession: !!s,
          userId: s?.user?.id ?? null,
          email: s?.user?.email ?? null,
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
  }, [hasSession]);

  if (loading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Перевірка сесії…</div>
    );
  }

  if (!hasSession) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-foreground">
          9D AUTH GATE v1
        </div>
        <PageHeader
          title="Нова поставка · draft test"
          subtitle="Потрібен вхід у систему для тесту resolver."
        />
        <div className="rounded-md border bg-muted/30 p-6 text-sm">
          <p className="mb-4 font-medium">
            Потрібен вхід у систему для тесту resolver
          </p>
          <p className="mb-4 text-muted-foreground">
            RPC <code>rpc_resolve_offer_line_defaults</code> викликається лише
            від authenticated user. Анонімний доступ не відкривається.
          </p>
          <Button
            onClick={() =>
              navigate({
                to: "/login",
                search: { redirect: "/shipments/new-draft-test" } as never,
              })
            }
          >
            Увійти
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-foreground">
        9D AUTH GATE v1
      </div>
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
