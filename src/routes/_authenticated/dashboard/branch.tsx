import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { ArrowLeftRight, Bell, ChevronRight, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";
import { toUaCountry } from "@/lib/countries";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CostPair } from "@/components/CostPair";

export const Route = createFileRoute("/_authenticated/dashboard/branch")({
  component: BranchDashboard,
});

type Row = {
  key: string;
  code: string;
  eta: string | null;
  status: string;
  product: string;
  country: string | null;
  caliber: string;
  pallets: number;
  weight: number;
  indicative: number | null;
  invoice: number | null;
};

const fmtEta = (eta: string | null) =>
  eta
    ? new Date(eta).toLocaleDateString("uk-UA", { day: "2-digit", month: "long" })
    : "Без дати";

function BranchDashboard() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id;
  const [drill, setDrill] = useState<{ product: string; country: string | null } | null>(null);

  const { data } = useQuery({
    queryKey: ["branch-incoming", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data: dists, error } = await supabase
        .from("distributions")
        .select(`
          id,status,
          shipments(id,code,eta,country),
          distribution_items(pallets,qty, shipment_items(id,product_name,caliber,origin_country))
        `)
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return dists ?? [];
    },
  });

  const rows: Row[] = useMemo(
    () =>
      (data ?? []).flatMap((d) =>
        (d.distribution_items ?? [])
          .map((di) => {
            const it = di.shipment_items;
            if (!it) return null;
            return {
              key: `${d.id}-${it.id}`,
              code: d.shipments?.code ?? "—",
              eta: d.shipments?.eta ?? null,
              status: d.status,
              product: it.product_name,
              country: it.origin_country ?? d.shipments?.country ?? null,
              caliber: it.caliber ?? "—",
              pallets: Number(di.pallets ?? 0),
              weight: Number(di.qty ?? 0),
            } as Row;
          })
          .filter(Boolean) as Row[],
      ),
    [data],
  );

  const totalPallets = rows.reduce((s, r) => s + r.pallets, 0);
  const totalWeight = rows.reduce((s, r) => s + r.weight, 0);

  const drillRows = useMemo(() => {
    if (!drill) return [];
    return rows.filter(
      (r) =>
        r.product === drill.product &&
        (drill.country == null || r.country === drill.country),
    );
  }, [drill, rows]);

  // group drill rows by ETA
  const drillGrouped = useMemo(() => {
    const m = new Map<string, Row[]>();
    drillRows.forEach((r) => {
      const k = r.eta ?? "";
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    });
    return Array.from(m.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
  }, [drillRows]);

  const drillTotalP = drillRows.reduce((s, r) => s + r.pallets, 0);
  const drillTotalW = drillRows.reduce((s, r) => s + r.weight, 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Філія" subtitle="Призначені вам товари" />

      {!branchId && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">
          Вам ще не призначено філію. Зверніться до адміністратора.
        </div>
      )}

      {!rows.length ? (
        <EmptyState title="Поки немає вхідних поставок" />
      ) : (
        <SectionCard title="Вхідні позиції">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-border bg-background/40 p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Палет всього</div>
              <div className="text-2xl font-bold tabular-nums">{totalPallets}</div>
            </div>
            <div className="rounded-xl border border-border bg-background/40 p-3">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Вага всього</div>
              <div className="text-2xl font-bold tabular-nums">
                {totalWeight.toLocaleString("uk-UA")} <span className="text-sm font-medium text-muted-foreground">кг</span>
              </div>
            </div>
          </div>

          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[680px] text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Поставка</th>
                  <th className="px-2 py-2 font-medium">Товар</th>
                  <th className="px-2 py-2 font-medium">Країна</th>
                  <th className="px-2 py-2 font-medium">Калібр</th>
                  <th className="px-2 py-2 text-right font-medium">Палет</th>
                  <th className="px-2 py-2 text-right font-medium">Вага</th>
                  <th className="px-2 py-2 font-medium">Прибуття</th>
                  <th className="px-2 py-2 font-medium">Статус</th>
                  <th className="w-6" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr
                    key={r.key}
                    onClick={() => setDrill({ product: r.product, country: r.country })}
                    className="cursor-pointer hover:bg-muted/40 active:bg-muted/60"
                  >
                    <td className="px-2 py-2 font-mono text-[11px] font-semibold">{r.code}</td>
                    <td className="px-2 py-2 font-medium">{r.product}</td>
                    <td className="px-2 py-2 text-muted-foreground">{r.country ? toUaCountry(r.country) : "—"}</td>
                    <td className="px-2 py-2 text-muted-foreground">{r.caliber}</td>
                    <td className="px-2 py-2 text-right font-bold tabular-nums">{r.pallets}п</td>
                    <td className="px-2 py-2 text-right font-bold tabular-nums">{r.weight.toLocaleString("uk-UA")} кг</td>
                    <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">{fmtEta(r.eta)}</td>
                    <td className="px-2 py-2">
                      <StatusChip status={r.status} kind="distribution" />
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

      <div className="grid grid-cols-2 gap-3">
        <Link
          to="/transfers"
          className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-card active:scale-[0.98]"
        >
          <div>
            <div className="text-sm font-semibold">Переміщення</div>
            <div className="text-xs text-muted-foreground">Між філіями</div>
          </div>
          <ArrowLeftRight className="h-5 w-5 text-brand" />
        </Link>
        <Link
          to="/branch-requests"
          className="flex items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-card active:scale-[0.98]"
        >
          <div>
            <div className="text-sm font-semibold">Заявки</div>
            <div className="text-xs text-muted-foreground">Нові запити</div>
          </div>
          <Bell className="h-5 w-5 text-brand" />
        </Link>
      </div>

      <Sheet open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center justify-between gap-2">
              <span>
                {drill?.product}
                {drill?.country && (
                  <span className="text-muted-foreground"> · {toUaCountry(drill.country)}</span>
                )}
              </span>
              <button
                onClick={() => setDrill(null)}
                className="rounded-full p-1 hover:bg-muted"
                aria-label="Закрити"
              >
                <X className="h-4 w-4" />
              </button>
            </SheetTitle>
          </SheetHeader>

          <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Всього призначено філії</div>
            <div className="text-xl font-bold tabular-nums">
              {drillTotalP}п · {drillTotalW.toLocaleString("uk-UA")} кг
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {drillGrouped.map(([eta, list]) => {
              const p = list.reduce((s, r) => s + r.pallets, 0);
              const w = list.reduce((s, r) => s + r.weight, 0);
              return (
                <div key={eta || "no-date"}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <div className="text-sm font-semibold">{fmtEta(eta || null)}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {p}п · {w.toLocaleString("uk-UA")} кг
                    </div>
                  </div>
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {list.map((r) => (
                      <li key={r.key} className="flex items-center justify-between px-3 py-2 text-sm">
                        <div>
                          <div className="font-mono text-[11px] font-semibold">{r.code}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {r.caliber !== "—" ? `Калібр ${r.caliber}` : ""}
                          </div>
                        </div>
                        <div className="text-right tabular-nums">
                          <div className="font-bold">{r.pallets}п</div>
                          <div className="text-[11px] text-muted-foreground">{r.weight.toLocaleString("uk-UA")} кг</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
