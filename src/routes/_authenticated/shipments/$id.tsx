import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, StatCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";

export const Route = createFileRoute("/_authenticated/shipments/$id")({
  component: ShipmentDetail,
});

function ShipmentDetail() {
  const { id } = Route.useParams();
  const { data } = useQuery({
    queryKey: ["shipment", id],
    queryFn: async () => {
      const [s, items] = await Promise.all([
        supabase.from("shipments").select("*, suppliers(name,country)").eq("id", id).single(),
        supabase.from("shipment_items").select("*").eq("shipment_id", id),
      ]);
      return { shipment: s.data, items: items.data ?? [] };
    },
  });

  const sh = data?.shipment;
  if (!sh) return <p className="text-sm text-muted-foreground">Завантаження…</p>;

  const itemsTotal = data!.items.reduce((acc, it) => acc + Number(it.qty) * Number(it.unit_price), 0);
  const totalCost =
    itemsTotal +
    Number(sh.customs_cost ?? 0) +
    Number(sh.logistics_cost ?? 0) +
    Number(sh.other_costs ?? 0);
  const totalQty = data!.items.reduce((acc, it) => acc + Number(it.qty), 0);
  const unitCost = totalQty > 0 ? totalCost / totalQty : 0;

  return (
    <div className="space-y-4">
      <PageHeader title={sh.code} subtitle={sh.suppliers?.name ?? ""} action={<StatusChip status={sh.status} />} />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Позицій" value={data!.items.length} />
        <StatCard label="Загальна вага" value={`${Number(sh.total_weight_kg ?? 0)} кг`} />
        <StatCard label="Загальна собівартість" value={`${totalCost.toFixed(2)} ${sh.currency}`} tone="primary" />
        <StatCard label="Сер. ціна за од." value={`${unitCost.toFixed(2)} ${sh.currency}`} tone="brand" />
      </div>

      <SectionCard title="Витрати">
        <dl className="grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Митниця</dt>
          <dd className="text-right">{Number(sh.customs_cost ?? 0)} {sh.currency}</dd>
          <dt className="text-muted-foreground">Логістика</dt>
          <dd className="text-right">{Number(sh.logistics_cost ?? 0)} {sh.currency}</dd>
          <dt className="text-muted-foreground">Інше</dt>
          <dd className="text-right">{Number(sh.other_costs ?? 0)} {sh.currency}</dd>
          <dt className="text-muted-foreground">Курс</dt>
          <dd className="text-right">{Number(sh.fx_rate ?? 1)}</dd>
        </dl>
      </SectionCard>

      <SectionCard title="Позиції">
        {!data!.items.length ? (
          <EmptyState title="Позицій ще немає" hint="Додайте товари до поставки" />
        ) : (
          <ul className="divide-y divide-border">
            {data!.items.map((it) => (
              <li key={it.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <div className="font-medium">{it.product_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {Number(it.qty)} {it.unit} · {Number(it.unit_price)} {sh.currency}
                  </div>
                </div>
                <span className="font-semibold">{(Number(it.qty) * Number(it.unit_price)).toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
