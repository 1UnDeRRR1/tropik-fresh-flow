import { createFileRoute, Link, Outlet, useMatches } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Package, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { toUaCountry } from "@/lib/countries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/distribution")({
  component: Distribution,
});

function Distribution() {
  const matches = useMatches();
  const isChild = matches.some((m) => m.routeId === "/_authenticated/distribution/$shipmentId");
  if (isChild) return <Outlet />;
  return <DistributionList />;
}

type ShipRow = {
  id: string;
  code: string;
  eta: string | null;
  status: string;
  country: string | null;
  shipment_items: { pallet_count: number | null }[] | null;
  distributions: { distribution_items: { pallets: number | null }[] | null }[] | null;
};

type Bucket = { id: string; code: string; eta: string | null; country: string | null; planned: number; distributed: number; remaining: number };

function DistributionList() {
  const { user, loading } = useAuth();

  const { data } = useQuery({
    queryKey: ["distribution-list", user?.id],
    enabled: !loading && !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id,code,eta,status,country,shipment_items(pallet_count),distributions(distribution_items(pallets))")
        .neq("status", "cancelled")
        .order("eta", { ascending: true, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ShipRow[];
    },
  });

  const isoToday = new Date().toISOString().slice(0, 10);
  const iso24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rows: Bucket[] = (data ?? []).map((s) => {
    const planned = (s.shipment_items ?? []).reduce((a, i) => a + Number(i.pallet_count ?? 0), 0);
    const distributed = (s.distributions ?? []).reduce(
      (a, d) => a + (d.distribution_items ?? []).reduce((aa, di) => aa + Number(di.pallets ?? 0), 0),
      0,
    );
    return { id: s.id, code: s.code, eta: s.eta, country: s.country, planned, distributed, remaining: Math.max(0, planned - distributed) };
  });

  const urgent = rows.filter((r) => r.eta && r.eta >= isoToday && r.eta <= iso24h && r.remaining > 0);
  const notDist = rows.filter((r) => r.remaining > 0 && (!r.eta || r.eta > iso24h));
  const done = rows.filter((r) => r.distributed > 0);

  // Scroll to anchored section
  useEffect(() => {
    const h = window.location.hash?.slice(1);
    if (!h || !data) return;
    const el = document.getElementById(h);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [data]);

  return (
    <div className="space-y-4">
      <PageHeader title="Розподіл" subtitle="Виберіть поставку для розподілу по філіях" />

      <section id="urgent">
        <SectionCard title="24 години — терміново">
          {!urgent.length ? <EmptyState title="Немає термінових поставок" /> : <List rows={urgent} tone="danger" icon={<AlertTriangle className="h-4 w-4" />} />}
        </SectionCard>
      </section>

      <section id="not">
        <SectionCard title="Нерозподілено">
          {!notDist.length ? <EmptyState title="Немає нерозподілених поставок" hint="Створіть поставку та додайте товари" /> : <List rows={notDist} icon={<Package className="h-4 w-4" />} />}
        </SectionCard>
      </section>

      <section id="done">
        <SectionCard title="Розподілено">
          {!done.length ? <EmptyState title="Розподілів ще немає" /> : <List rows={done} variant="done" icon={<CheckCircle2 className="h-4 w-4" />} />}
        </SectionCard>
      </section>
    </div>
  );
}

function List({ rows, tone, icon, variant }: { rows: Bucket[]; tone?: "danger" | "brand"; icon?: React.ReactNode; variant?: "done" }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => {
        const isDone = variant === "done";
        const fullyDistributed = isDone && r.remaining === 0;
        const iconClass = isDone
          ? fullyDistributed
            ? "bg-emerald-500/15 text-emerald-600"
            : "bg-warning/15 text-warning"
          : tone === "danger"
            ? "bg-destructive/15 text-destructive"
            : tone === "brand"
              ? "bg-brand/15 text-brand"
              : "bg-muted text-muted-foreground";
        const badgeText = isDone
          ? fullyDistributed
            ? "✓"
            : `${r.distributed}п`
          : r.remaining > 0
            ? `${r.remaining}п`
            : "✓";
        const badgeClass = isDone
          ? "bg-emerald-500/15 text-emerald-600"
          : r.remaining > 0
            ? "bg-brand/15 text-brand"
            : "bg-emerald-500/15 text-emerald-600";
        return (
          <li key={r.id}>
            <Link
              to="/distribution/$shipmentId"
              params={{ shipmentId: r.id }}
              className="flex items-center justify-between gap-3 py-3 transition active:scale-[0.99]"
            >
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", iconClass)}>
                {icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.code}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {toUaCountry(r.country) || "—"} · ETA {r.eta ?? "—"} · {r.distributed}/{r.planned}п
                </div>
              </div>
              <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold", badgeClass)}>
                {badgeText}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
