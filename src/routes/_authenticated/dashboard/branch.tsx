import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";

import { toUaCountry } from "@/lib/countries";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CostPair } from "@/components/CostPair";
import { OfferDialog } from "@/components/OfferDialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard/branch")({
  component: BranchDashboard,
});

type Row = {
  key: string;
  shipment_item_id: string;
  distribution_id: string;
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
  const [offerRow, setOfferRow] = useState<Row | null>(null);

  const { data: dists } = useQuery({
    queryKey: ["branch-incoming-dists", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributions")
        .select(`id,status,shipment_id,distribution_items(pallets,qty,shipment_item_id)`)
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; status: string; shipment_id: string;
        distribution_items: Array<{ pallets: number | null; qty: number | null; shipment_item_id: string | null }> | null;
      }>;
    },
  });

  const itemIds = useMemo(
    () => Array.from(new Set((dists ?? []).flatMap((d) => (d.distribution_items ?? []).map((di) => di.shipment_item_id).filter(Boolean) as string[]))),
    [dists],
  );
  const shipmentIds = useMemo(
    () => Array.from(new Set((dists ?? []).map((d) => d.shipment_id).filter(Boolean))),
    [dists],
  );

  const { data: items } = useQuery({
    queryKey: ["branch-incoming-items", itemIds.join(",")],
    enabled: itemIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipment_items_branch")
        .select("id,product_name,caliber,origin_country,final_cost_indicative,final_cost_invoice")
        .in("id", itemIds);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; product_name: string; caliber: string | null;
        origin_country: string | null;
        final_cost_indicative: number | null; final_cost_invoice: number | null;
      }>;
    },
  });

  const { data: ships } = useQuery({
    queryKey: ["branch-incoming-ships", shipmentIds.join(",")],
    enabled: shipmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipments_branch")
        .select("id,code,eta,country")
        .in("id", shipmentIds);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; code: string; eta: string | null; country: string | null;
      }>;
    },
  });

  const { data: outOffers } = useQuery({
    queryKey: ["branch-outgoing-offers", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("branch_transfer_offers")
        .select("shipment_item_id,distribution_id,status,offered_pallets,accepted_pallets")
        .eq("from_branch_id", branchId!);
      if (error) throw error;
      return (data ?? []) as Array<{
        shipment_item_id: string;
        distribution_id: string;
        status: string;
        offered_pallets: number;
        accepted_pallets: number;
      }>;
    },
  });

  const offerStats = useMemo(() => {
    const m = new Map<string, { pending: number; accepted: number }>();
    (outOffers ?? []).forEach((o) => {
      const k = `${o.distribution_id}-${o.shipment_item_id}`;
      const cur = m.get(k) ?? { pending: 0, accepted: 0 };
      if (o.status === "pending") cur.pending += Number(o.offered_pallets || 0);
      if (o.status === "accepted" || o.status === "partially_accepted")
        cur.accepted += Number(o.accepted_pallets || 0);
      m.set(k, cur);
    });
    return m;
  }, [outOffers]);

  const statsFor = (r: { distribution_id: string; shipment_item_id: string; pallets: number }) => {
    const s = offerStats.get(`${r.distribution_id}-${r.shipment_item_id}`) ?? { pending: 0, accepted: 0 };
    const free = Math.max(0, r.pallets - s.pending - s.accepted);
    return { pending: s.pending, accepted: s.accepted, free };
  };

  const rows: Row[] = useMemo(() => {
    if (!dists) return [];
    const iMap = new Map((items ?? []).map((i) => [i.id, i]));
    const sMap = new Map((ships ?? []).map((s) => [s.id, s]));
    return dists.flatMap((d) =>
      (d.distribution_items ?? [])
        .map((di) => {
          if (!di.shipment_item_id) return null;
          const it = iMap.get(di.shipment_item_id);
          if (!it) return null;
          const s = sMap.get(d.shipment_id);
          return {
            key: `${d.id}-${it.id}`,
            shipment_item_id: it.id,
            distribution_id: d.id,
            code: s?.code ?? "—",
            eta: s?.eta ?? null,
            status: d.status,
            product: it.product_name,
            country: it.origin_country ?? s?.country ?? null,
            caliber: it.caliber ?? "—",
            pallets: Number(di.pallets ?? 0),
            weight: Number(di.qty ?? 0),
            indicative: it.final_cost_indicative,
            invoice: it.final_cost_invoice,
          } as Row;
        })
        .filter(Boolean) as Row[],
    );
  }, [dists, items, ships]);


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
      <PageHeader title="Філія" subtitle="Підтверджений товар" />

      {!branchId && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">
          Вам ще не призначено філію. Зверніться до адміністратора.
        </div>
      )}

      {!rows.length ? (
        <EmptyState title="Поки немає підтвердженого товару" />
      ) : (
        <SectionCard title="Підтверджений товар">
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
                  <th className="px-2 py-2 text-right font-normal">Вага</th>
                  <th className="px-2 py-2 text-right font-medium">Ціна</th>
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
                    <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">{fmtEta(r.eta)}</td>
                    <td className="px-2 py-2 font-mono text-[11px] font-semibold">{r.code}</td>
                    <td className="px-2 py-2 font-medium">{r.product}</td>
                    <td className="px-2 py-2 text-muted-foreground">{r.country ? toUaCountry(r.country) : "—"}</td>
                    <td className="px-2 py-2 text-muted-foreground">{r.caliber}</td>
                    <td className="px-2 py-2 text-right font-bold tabular-nums">
                      {(() => {
                        const s = statsFor(r);
                        return s.pending > 0 ? (
                          <span>
                            {s.free}п <span className="text-muted-foreground font-normal">/</span>{" "}
                            <span className="text-blue-600">{s.pending}п</span>
                          </span>
                        ) : (
                          <span>{s.free}п</span>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-2 text-right font-normal tabular-nums">{r.weight.toLocaleString("uk-UA")} кг</td>
                    <td className="px-2 py-2 text-right">
                      <CostPair indicative={r.indicative} invoice={r.invoice} suffix=" кг" size="xs" />
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


      <Sheet open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent side="top" className="mt-[env(safe-area-inset-top)] max-h-[85vh] overflow-y-auto rounded-b-2xl">
          <SheetHeader className="text-left">
            <SheetTitle className="pr-8">
              <span>
                {drill?.product}
                {drill?.country && (
                  <span className="text-muted-foreground"> · {toUaCountry(drill.country)}</span>
                )}
              </span>
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
                    {list.map((r) => {
                      const s = statsFor(r);
                      return (
                        <li key={r.key} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-[11px] font-semibold">{r.code}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {r.caliber !== "—" ? `Калібр ${r.caliber}` : ""}
                            </div>
                          </div>
                          <div className="text-right tabular-nums">
                            <div className="font-bold">
                              {s.pending > 0 ? (
                                <>
                                  {s.free}п <span className="text-muted-foreground font-normal">/</span>{" "}
                                  <span className="text-blue-600">{s.pending}п</span>
                                </>
                              ) : (
                                <>{s.free}п</>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              всього {r.pallets}п · {r.weight.toLocaleString("uk-UA")} кг
                            </div>
                          </div>
                          <Button
                            size="sm"
                            className="h-8 px-2 text-xs"
                            disabled={s.free <= 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOfferRow({ ...r, pallets: s.free });
                            }}
                          >
                            Запропонувати
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      <OfferDialog
        open={!!offerRow}
        onClose={() => setOfferRow(null)}
        item={
          offerRow
            ? {
                shipment_item_id: offerRow.shipment_item_id,
                distribution_id: offerRow.distribution_id,
                product_name: offerRow.product,
                caliber: offerRow.caliber,
                available_pallets: offerRow.pallets,
                shipment_code: offerRow.code,
              }
            : null
        }
      />
    </div>
  );
}
