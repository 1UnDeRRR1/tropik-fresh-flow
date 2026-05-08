import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/distribution/$shipmentId")({
  component: DistributionMatrix,
});

type Item = {
  id: string;
  product_name: string;
  caliber: string | null;
  pallet_count: number;
  pallet_weight: number;
};

type Branch = { id: string; name: string; sort_order: number };

function DistributionMatrix() {
  const { shipmentId } = Route.useParams();
  const qc = useQueryClient();
  const [grid, setGrid] = useState<Record<string, Record<string, number>>>({});
  // grid[itemId][branchId] = pallets

  const { data, isLoading } = useQuery({
    queryKey: ["matrix", shipmentId],
    queryFn: async () => {
      const [shRes, itemsRes, branchesRes, distRes] = await Promise.all([
        supabase.from("shipments").select("id,code,status").eq("id", shipmentId).single(),
        supabase.from("shipment_items").select("id,product_name,caliber,pallet_count,pallet_weight").eq("shipment_id", shipmentId).order("created_at"),
        supabase.from("branches").select("id,name,sort_order").order("sort_order"),
        supabase
          .from("distributions")
          .select("id,branch_id, distribution_items(shipment_item_id,pallets,qty)")
          .eq("shipment_id", shipmentId),
      ]);
      const items = (itemsRes.data ?? []) as Item[];
      const branches = (branchesRes.data ?? []) as Branch[];
      const initial: Record<string, Record<string, number>> = {};
      items.forEach((it) => {
        initial[it.id] = {};
        branches.forEach((b) => (initial[it.id][b.id] = 0));
      });
      (distRes.data ?? []).forEach((d) => {
        d.distribution_items?.forEach((di) => {
          if (initial[di.shipment_item_id] && d.branch_id) {
            initial[di.shipment_item_id][d.branch_id] = Number(di.pallets ?? 0);
          }
        });
      });
      setGrid(initial);
      return { shipment: shRes.data, items, branches };
    },
  });

  const totals = useMemo(() => {
    const map: Record<string, { distributed: number; remaining: number; total: number }> = {};
    data?.items.forEach((it) => {
      const distributed = Object.values(grid[it.id] ?? {}).reduce((a, b) => a + Number(b || 0), 0);
      const total = Number(it.pallet_count ?? 0);
      map[it.id] = { distributed, remaining: total - distributed, total };
    });
    return map;
  }, [grid, data]);

  const setCell = (itemId: string, branchId: string, val: number) => {
    setGrid((g) => ({ ...g, [itemId]: { ...(g[itemId] ?? {}), [branchId]: val } }));
  };

  const save = async () => {
    if (!data) return;
    try {
      // For each branch with any pallets — upsert distribution and replace its items for this shipment
      for (const branch of data.branches) {
        const branchTotals = data.items
          .map((it) => ({ itemId: it.id, pallets: Number(grid[it.id]?.[branch.id] ?? 0), weightPerPallet: Number(it.pallet_weight ?? 0) }))
          .filter((x) => x.pallets > 0);

        // find or create distribution row
        const { data: existing } = await supabase
          .from("distributions").select("id").eq("shipment_id", shipmentId).eq("branch_id", branch.id).maybeSingle();

        let distId = existing?.id;
        if (!distId && branchTotals.length > 0) {
          const { data: created, error: ce } = await supabase
            .from("distributions").insert({ shipment_id: shipmentId, branch_id: branch.id, status: "planned" })
            .select("id").single();
          if (ce) throw ce;
          distId = created.id;
        }

        if (distId) {
          await supabase.from("distribution_items").delete().eq("distribution_id", distId);
          if (branchTotals.length > 0) {
            const rows = branchTotals.map((x) => ({
              distribution_id: distId!,
              shipment_item_id: x.itemId,
              pallets: x.pallets,
              qty: x.pallets * x.weightPerPallet,
            }));
            const { error: ie } = await supabase.from("distribution_items").insert(rows);
            if (ie) throw ie;
          } else if (existing?.id) {
            await supabase.from("distributions").delete().eq("id", existing.id);
          }
        }
      }

      // Move shipment status forward if still draft
      if (data.shipment?.status === "draft" || data.shipment?.status === "arrived") {
        await supabase.from("shipments").update({ status: "distributing" }).eq("id", shipmentId);
      }

      toast.success("Розподіл збережено");
      qc.invalidateQueries({ queryKey: ["matrix", shipmentId] });
      qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Помилка збереження");
    }
  };

  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Завантаження…</p>;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Розподіл по філіях"
        subtitle={`Поставка ${data.shipment?.code ?? ""}`}
        action={
          <Link to="/shipments/$id" params={{ id: shipmentId }} className="text-xs text-brand">
            До поставки
          </Link>
        }
      />

      <SectionCard title="Матриця розподілу" action={<Button size="sm" onClick={save} className="bg-brand text-brand-foreground hover:bg-brand/90">Зберегти</Button>}>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="min-w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card px-2 py-2 text-left font-semibold">Товар</th>
                <th className="bg-card px-2 py-2 text-right font-semibold">FACT</th>
                <th className="bg-card px-2 py-2 text-right font-semibold">Розпод.</th>
                <th className="bg-card px-2 py-2 text-right font-semibold">Залиш.</th>
                {data.branches.map((b) => (
                  <th key={b.id} className="bg-card px-1 py-2 text-center font-semibold whitespace-nowrap">
                    {b.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => {
                const t = totals[it.id] ?? { distributed: 0, remaining: 0, total: 0 };
                return (
                  <tr key={it.id} className="border-t border-border">
                    <td className="sticky left-0 z-10 bg-background px-2 py-2 font-medium whitespace-nowrap">
                      {it.product_name}
                      {it.caliber && <span className="ml-1 text-muted-foreground">·{it.caliber}</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{t.total}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-brand">{t.distributed}</td>
                    <td className={cn("px-2 py-2 text-right tabular-nums font-semibold", t.remaining < 0 ? "text-destructive" : "")}>
                      {t.remaining}
                    </td>
                    {data.branches.map((b) => (
                      <td key={b.id} className="px-0.5 py-1">
                        <input
                          type="number"
                          min={0}
                          inputMode="decimal"
                          value={grid[it.id]?.[b.id] ?? 0}
                          onChange={(e) => setCell(it.id, b.id, Number(e.target.value) || 0)}
                          className="h-9 w-14 rounded-md border border-input bg-background px-1 text-center text-xs tabular-nums focus:border-brand focus:outline-none"
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Введіть кількість палет по кожній філії. FACT — отримана кількість палет з інвойсу. Залиш. показує скільки ще не розподілено.
        </p>
      </SectionCard>
    </div>
  );
}
