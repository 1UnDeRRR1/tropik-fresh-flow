import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { allocateTransport, fmtKg } from "@/lib/transport";
import { fmtUSD } from "@/lib/currency";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: Analytics,
});

type Row = {
  id: string;
  code: string;
  status: string;
  logistics_cost_usd: number | null;
  shipment_items: Array<{ id: string; pallet_count: number | null; pallet_weight: number | null }>;
};

function Analytics() {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics-transport-usd"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id,code,status,logistics_cost_usd, shipment_items(id,pallet_count,pallet_weight)")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });

  const rows = (data ?? []).map((sh) => {
    const totalCostUsd = Number(sh.logistics_cost_usd ?? 0);
    const alloc = allocateTransport(sh.shipment_items ?? [], totalCostUsd);
    const avgPerKg = alloc.shipmentTotalWeight > 0 ? totalCostUsd / alloc.shipmentTotalWeight : 0;
    return { id: sh.id, code: sh.code, status: sh.status, totalCostUsd, totalWeight: alloc.shipmentTotalWeight, avgPerKg };
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Аналітика" subtitle="Транспортні витрати у USD" />

      <SectionCard title="Розподіл транспортних витрат (USD)">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Завантаження…</p>
        ) : !rows.length ? (
          <EmptyState title="Дані зʼявляться після перших поставок" />
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[480px] text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 text-left font-medium">Поставка</th>
                  <th className="py-2 text-right font-medium">Вага</th>
                  <th className="py-2 text-right font-medium">Транспорт</th>
                  <th className="py-2 text-right font-medium">$/кг</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-2 pr-2 font-medium">
                      <Link to="/shipments/$id" params={{ id: r.id }} className="text-brand hover:underline">{r.code}</Link>
                    </td>
                    <td className="py-2 text-right tabular-nums">{fmtKg(r.totalWeight)}</td>
                    <td className="py-2 text-right tabular-nums">{fmtUSD(r.totalCostUsd)}</td>
                    <td className="py-2 text-right tabular-nums text-brand">{fmtUSD(r.avgPerKg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
