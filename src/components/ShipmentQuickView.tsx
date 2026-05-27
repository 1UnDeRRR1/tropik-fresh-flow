import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/cards";
import { CostPair } from "@/components/CostPair";
import { cn } from "@/lib/utils";

type Item = {
  id: string;
  product_name: string;
  origin_country: string | null;
  caliber: string | null;
  variety: string | null;
  pallet_count: number | null;
  pallet_weight: number | null;
  net_weight_kg: number | null;
  gross_weight_kg: number | null;
  unit_price: number | null;
  price_currency: string | null;
  final_cost_indicative: number | null;
  final_cost_invoice: number | null;
};

type DistRow = {
  branch_id: string;
  branches: { name: string } | null;
  distribution_items: { shipment_item_id: string; pallets: number | null }[] | null;
};

export function ShipmentQuickView({
  shipmentId,
  code,
  className,
}: {
  shipmentId: string;
  code: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [openItem, setOpenItem] = useState<Item | null>(null);
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ["shipment-quickview", shipmentId],
    enabled: open,
    queryFn: async () => {
      const [itRes, dRes] = await Promise.all([
        supabase
          .from("shipment_items")
          .select(
            "id,product_name,origin_country,caliber,variety,pallet_count,pallet_weight,net_weight_kg,gross_weight_kg,unit_price,price_currency,final_cost_indicative,final_cost_invoice",
          )
          .eq("shipment_id", shipmentId),
        supabase
          .from("distributions")
          .select("branch_id, branches(name), distribution_items(shipment_item_id,pallets)")
          .eq("shipment_id", shipmentId),
      ]);
      if (itRes.error) throw itRes.error;
      if (dRes.error) throw dRes.error;
      return {
        items: (itRes.data ?? []) as Item[],
        dists: (dRes.data ?? []) as DistRow[],
      };
    },
  });

  const distByItem = new Map<string, { branch: string; pallets: number }[]>();
  for (const d of data?.dists ?? []) {
    for (const di of d.distribution_items ?? []) {
      const arr = distByItem.get(di.shipment_item_id) ?? [];
      const palletsNum = Number(di.pallets ?? 0);
      if (palletsNum > 0) {
        arr.push({ branch: d.branches?.name ?? "—", pallets: palletsNum });
        distByItem.set(di.shipment_item_id, arr);
      }
    }
  }

  const goDistribute = (itemId?: string) => {
    setOpen(false);
    setOpenItem(null);
    navigate({
      to: "/distribution/$shipmentId",
      params: { shipmentId },
      search: itemId ? { itemId } : {},
    });
  };

  const goEdit = () => {
    setOpen(false);
    setOpenItem(null);
    navigate({ to: "/shipments/$id/products", params: { id: shipmentId } });
  };


  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {code}
      </button>

      {/* Level 1: items in shipment */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-mono">{code}</DialogTitle>
          </DialogHeader>
          {!isLoading && data?.items.length ? (
            <div className="flex gap-2 -mt-1">
              <Button variant="outline" size="sm" className="flex-1" onClick={goEdit}>Редагувати</Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => goDistribute()}>Розподілити</Button>
            </div>
          ) : null}

          {isLoading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Завантаження…</div>
          ) : !data?.items.length ? (
            <EmptyState title="Немає позицій" />
          ) : (
            <>
              <ul className="divide-y divide-border">
                {data.items.map((it) => {
                  const pallets = Number(it.pallet_count ?? 0);
                  const rows = distByItem.get(it.id) ?? [];
                  const distributed = rows.reduce((a, b) => a + b.pallets, 0);
                  const remaining = pallets - distributed;
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => setOpenItem(it)}
                        className="flex w-full flex-col gap-1 py-2.5 text-left active:opacity-70"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold">
                            {it.product_name}
                            {it.caliber ? <span className="text-muted-foreground"> ·{it.caliber}</span> : null}
                          </span>
                          <span className="shrink-0 text-sm font-bold tabular-nums text-brand">{pallets}п</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                          {it.variety ? <span>{it.variety}</span> : null}
                          {it.origin_country ? <span>{it.origin_country}</span> : null}
                          <span className="text-success">розпод. {distributed}п</span>
                          <span className={remaining < 0 ? "text-destructive" : remaining === 0 ? "text-success" : "text-warning"}>
                            залиш. {remaining}п
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                          {it.unit_price ? (
                            <span className="text-muted-foreground">
                              закуп. {Number(it.unit_price).toFixed(2)} {it.price_currency ?? ""}
                            </span>
                          ) : null}
                          <CostPair indicative={it.final_cost_indicative} invoice={it.final_cost_invoice} suffix=" кг" size="xs" />
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Level 2: distribution per branch for selected item */}
      <Dialog open={!!openItem} onOpenChange={(o) => !o && setOpenItem(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              {openItem?.product_name}
              {openItem?.caliber ? <span className="text-muted-foreground"> ·{openItem.caliber}</span> : null}
              <div className="mt-0.5 text-xs font-normal text-muted-foreground font-mono">
                {code}
                {openItem?.origin_country ? <span> · {openItem.origin_country}</span> : null}
              </div>
            </DialogTitle>
          </DialogHeader>
          {openItem
            ? (() => {
                const total = Number(openItem.pallet_count ?? 0);
                const rows = (distByItem.get(openItem.id) ?? [])
                  .slice()
                  .sort((a, b) => a.branch.localeCompare(b.branch, "uk"));
                const distributed = rows.reduce((a, b) => a + b.pallets, 0);
                const remaining = total - distributed;
                return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-secondary px-2 py-1.5">
                        <div className="text-[10px] text-muted-foreground">Всього</div>
                        <div className="text-sm font-bold tabular-nums">{total}п</div>
                      </div>
                      <div className="rounded-lg bg-success/15 px-2 py-1.5">
                        <div className="text-[10px] text-success">Розпод.</div>
                        <div className="text-sm font-bold tabular-nums text-success">{distributed}п</div>
                      </div>
                      <div className={cn("rounded-lg px-2 py-1.5", remaining < 0 ? "bg-destructive/15" : "bg-warning/15")}>
                        <div className={cn("text-[10px]", remaining < 0 ? "text-destructive" : "text-warning")}>Залиш.</div>
                        <div className={cn("text-sm font-bold tabular-nums", remaining < 0 ? "text-destructive" : "text-warning")}>
                          {remaining}п
                        </div>
                      </div>
                    </div>

                    {rows.length ? (
                      <ul className="divide-y divide-border rounded-xl border border-border">
                        {rows.map((r) => (
                          <li key={r.branch} className="flex items-center justify-between gap-2 px-3 py-2">
                            <span className="truncate text-sm font-medium">{r.branch}</span>
                            <span className="text-sm font-bold tabular-nums text-brand">{r.pallets}п</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState title="Ще не розподілено" hint="Усі палети — у залишку." />
                    )}

                    <Button className="w-full" onClick={goDistribute}>Розподілити</Button>
                  </div>
                );
              })()
            : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
