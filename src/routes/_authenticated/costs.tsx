import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { CostPair } from "@/components/CostPair";

export const Route = createFileRoute("/_authenticated/costs")({
  component: Costs,
});

function Costs() {
  const { data } = useQuery({
    queryKey: ["costs", "recent"],
    queryFn: async () => {
      const { data } = await supabase
        .from("shipment_items")
        .select("id,product_name,unit_price_usd,customs_cost_indicative,customs_cost_invoice,final_cost_indicative,final_cost_invoice,customs_match_id,created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });
  return (
    <div className="space-y-4">
      <PageHeader title="Собівартість" subtitle="Калькуляція позицій поставок (USD)" />
      <SectionCard title="Як рахується">
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          <li><b>Митна база</b> = ціна постачальника $</li>
          <li>Якщо ціна ≤ <b>порогу</b> → митна вартість = <b>Націнка Euro1</b></li>
          <li>Інакше: ПДВ = ціна×0.20; митний збір = (ціна+ПДВ)×% ÷ 100; інв. = ПДВ + збір + 0.015</li>
          <li><b>Собівартість</b> = ціна $ + транспорт $/кг + митна вартість $</li>
        </ul>
      </SectionCard>
      <SectionCard title="Останні розрахунки">
        {!data?.length ? (
          <EmptyState title="Поки немає даних" />
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground [&_th]:bg-table-head [&_th]:font-bold">
                <tr>
                  <th className="py-1 pr-2">Товар</th>
                  <th className="py-1 pr-2 text-right">Ціна $</th>
                  <th className="py-1 pr-2 text-right">Митниця</th>
                  <th className="py-1 text-right">Собів. $/кг</th>
                </tr>
              </thead>
              <tbody>
                {data.map((r: any) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="py-1 pr-2">{r.product_name}{!r.customs_match_id && <span className="ml-1 text-amber-600">·?</span>}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{Number(r.unit_price_usd ?? 0).toFixed(2)}</td>
                    <td className="py-1 pr-2 text-right">
                      <CostPair indicative={r.customs_cost_indicative} invoice={r.customs_cost_invoice} />
                    </td>
                    <td className="py-1 text-right">
                      <CostPair indicative={r.final_cost_indicative} invoice={r.final_cost_invoice} />
                    </td>
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
