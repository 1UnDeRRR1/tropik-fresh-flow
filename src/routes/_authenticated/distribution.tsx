import { createFileRoute, Link, Outlet, useMatches } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Package, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { toUaCountry } from "@/lib/countries";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CostPair } from "@/components/CostPair";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/distribution")({
  component: Distribution,
});

function Distribution() {
  const matches = useMatches();
  const isChild = matches.some((m) => m.routeId === "/_authenticated/distribution/$shipmentId");
  if (isChild) return <Outlet />;
  const { primaryRole } = useAuth();
  if (primaryRole === "branch") return <BranchFreeList />;
  return <DistributionList />;
}

// ============ Branch "Вільно" view ============

const fmtEta = (eta: string | null) =>
  eta
    ? new Date(eta).toLocaleDateString("uk-UA", { day: "2-digit", month: "long" })
    : "Без дати";

type FreeRow = {
  itemId: string;
  shipmentId: string;
  code: string;
  eta: string | null;
  product: string;
  country: string | null;
  caliber: string;
  palletWeight: number;
  free: number;
  weight: number;
  indicative: number | null;
  invoice: number | null;
};

function BranchFreeList() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const [pick, setPick] = useState<FreeRow | null>(null);
  const [pallets, setPallets] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("UAH");
  const [submitting, setSubmitting] = useState(false);

  // Read via branch-safe views — purchase prices are not exposed at all.
  const { data: items } = useQuery({
    queryKey: ["branch-free-items"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipment_items_branch")
        .select("id,shipment_id,product_name,caliber,origin_country,pallet_weight,final_cost_indicative,final_cost_invoice,free_pallets")
        .gt("free_pallets", 0)
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; shipment_id: string; product_name: string;
        caliber: string | null; origin_country: string | null;
        pallet_weight: number | null;
        final_cost_indicative: number | null; final_cost_invoice: number | null;
        free_pallets: number;
      }>;
    },
  });

  const shipmentIds = useMemo(
    () => Array.from(new Set((items ?? []).map((i) => i.shipment_id))),
    [items],
  );

  const { data: ships } = useQuery({
    queryKey: ["branch-free-ships", shipmentIds.join(",")],
    enabled: shipmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipments_branch")
        .select("id,code,eta,country,status")
        .in("id", shipmentIds);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; code: string; eta: string | null;
        country: string | null; status: string;
      }>;
    },
  });

  const { data: pendingReqs } = useQuery({
    queryKey: ["branch-free-pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select("shipment_item_id,pallets,status")
        .eq("status", "pending");
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows: FreeRow[] = useMemo(() => {
    if (!items) return [];
    const sMap = new Map((ships ?? []).map((s) => [s.id, s]));
    const pendMap = new Map<string, number>();
    (pendingReqs ?? []).forEach((r: any) => {
      if (!r.shipment_item_id) return;
      pendMap.set(r.shipment_item_id, (pendMap.get(r.shipment_item_id) ?? 0) + Number(r.pallets ?? 0));
    });
    const out: FreeRow[] = [];
    items.forEach((it) => {
      const s = sMap.get(it.shipment_id);
      if (!s || s.status === "cancelled") return;
      const pending = pendMap.get(it.id) ?? 0;
      const free = Number(it.free_pallets ?? 0) - pending;
      if (free <= 0) return;
      const palletWeight = Number(it.pallet_weight ?? 0);
      out.push({
        itemId: it.id,
        shipmentId: it.shipment_id,
        code: s.code,
        eta: s.eta,
        product: it.product_name,
        country: it.origin_country ?? s.country ?? null,
        caliber: it.caliber ?? "—",
        palletWeight,
        free,
        weight: free * palletWeight,
        indicative: it.final_cost_indicative,
        invoice: it.final_cost_invoice,
      });
    });
    out.sort((a, b) => (a.eta ?? "9999").localeCompare(b.eta ?? "9999"));
    return out;
  }, [items, ships, pendingReqs]);

  const openOffer = (r: FreeRow) => {
    setPick(r);
    setPallets(String(r.free));
    setPrice("");
    setCurrency("UAH");
  };

  const submit = async () => {
    if (!pick || !user || !profile?.branch_id) return;
    const p = Number(pallets);
    const pr = Number(price);
    if (!p || p <= 0 || p > pick.free) {
      toast.error(`Палет від 1 до ${pick.free}`);
      return;
    }
    if (!pr || pr <= 0) {
      toast.error("Вкажіть ціну продажу");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("branch_requests").insert({
      branch_id: profile.branch_id,
      shipment_id: pick.shipmentId,
      shipment_item_id: pick.itemId,
      pallets: p,
      qty: p * pick.palletWeight,
      sale_price: pr,
      sale_currency: currency,
      request_type: "free_offer",
      status: "pending",
      requested_by: user.id,
      notes: `Пропозиція по ${pick.product} (${pick.code}): ${p}п × ${pr} ${currency}/кг`,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Пропозицію відправлено імпорт-менеджеру");
    setPick(null);
    qc.invalidateQueries({ queryKey: ["branch-free-items"] });
    qc.invalidateQueries({ queryKey: ["branch-free-ships"] });
    qc.invalidateQueries({ queryKey: ["branch-free-pending"] });
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Вільно" subtitle="Нерозподілений товар усіх менеджерів" />

      {!rows.length ? (
        <EmptyState title="Немає вільного товару" hint="Усі позиції розподілені або в очікуванні" />
      ) : (
        <SectionCard title="Доступно для запиту">
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Прибуття</th>
                  <th className="px-2 py-2 font-medium">Поставка</th>
                  <th className="px-2 py-2 font-medium">Товар</th>
                  <th className="px-2 py-2 font-medium">Країна</th>
                  <th className="px-2 py-2 font-medium">Калібр</th>
                  <th className="px-2 py-2 text-right font-medium">Палет</th>
                  <th className="px-2 py-2 text-right font-medium">Вага</th>
                  <th className="px-2 py-2 text-right font-medium">Ціна</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr
                    key={r.itemId}
                    onClick={() => openOffer(r)}
                    className="cursor-pointer hover:bg-muted/40 active:bg-muted/60"
                  >
                    <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">{fmtEta(r.eta)}</td>
                    <td className="px-2 py-2 font-mono text-[11px] font-semibold">{r.code}</td>
                    <td className="px-2 py-2 font-medium">{r.product}</td>
                    <td className="px-2 py-2 text-muted-foreground">{r.country ? toUaCountry(r.country) : "—"}</td>
                    <td className="px-2 py-2 text-muted-foreground">{r.caliber}</td>
                    <td className="px-2 py-2 text-right font-bold tabular-nums">{r.free}п</td>
                    <td className="px-2 py-2 text-right font-bold tabular-nums">
                      {r.weight.toLocaleString("uk-UA")} кг
                    </td>
                    <td className="px-2 py-2 text-right">
                      <CostPair indicative={r.indicative} invoice={r.invoice} suffix="/кг" size="xs" />
                    </td>
                    <td className="px-1 py-2 text-muted-foreground">
                      <ChevronRight className="h-4 w-4" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <Sheet open={!!pick} onOpenChange={(o) => !o && setPick(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle className="pr-8">
              <span>
                {pick?.product}
                {pick?.country && (
                  <span className="text-muted-foreground"> · {toUaCountry(pick.country)}</span>
                )}
              </span>
            </SheetTitle>
          </SheetHeader>

          {pick && (
            <div className="mt-3 space-y-4">
              <div className="rounded-xl border border-border bg-background/40 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Поставка</span>
                  <span className="font-mono font-semibold">{pick.code}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Прибуття</span>
                  <span>{fmtEta(pick.eta)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Калібр</span>
                  <span>{pick.caliber}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Доступно</span>
                  <span className="font-bold">{pick.free}п · {pick.weight.toLocaleString("uk-UA")} кг</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Кількість палет</label>
                <Input
                  type="number"
                  min={1}
                  max={pick.free}
                  value={pallets}
                  onChange={(e) => setPallets(e.target.value)}
                  inputMode="numeric"
                />
                <div className="text-[11px] text-muted-foreground">
                  ≈ {(Number(pallets || 0) * pick.palletWeight).toLocaleString("uk-UA")} кг
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">Ціна продажу за кг</label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="0.00"
                    inputMode="decimal"
                    className="flex-1"
                  />
                  <select
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="UAH">UAH</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                  </select>
                </div>
              </div>

              <Button onClick={submit} disabled={submitting} className="w-full">
                {submitting ? "Відправка…" : "Відправити пропозицію"}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ============ Staff distribution list (unchanged) ============

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
