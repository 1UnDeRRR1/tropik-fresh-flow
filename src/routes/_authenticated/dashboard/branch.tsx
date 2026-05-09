import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";

export const Route = createFileRoute("/_authenticated/dashboard/branch")({
  component: BranchDashboard,
});

function BranchDashboard() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id;

  const { data } = useQuery({
    queryKey: ["branch-incoming", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data: dists, error } = await supabase
        .from("distributions")
        .select(`
          id,status,
          shipments(id,code,eta),
          distribution_items(pallets,qty, shipment_items(id,product_name,caliber,final_cost_indicative,final_cost_invoice))
        `)
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return dists ?? [];
    },
  });

  // Flatten to rows: one row per product position
  const rows = (data ?? []).flatMap((d) =>
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
          caliber: it.caliber ?? "—",
          pallets: Number(di.pallets ?? 0),
          weight: Number(di.qty ?? 0),
          indicative: Number(it.final_cost_indicative ?? 0),
          invoice: Number(it.final_cost_invoice ?? 0),
        };
      })
      .filter(Boolean) as Array<{
      key: string;
      code: string;
      eta: string | null;
      status: string;
      product: string;
      caliber: string;
      pallets: number;
      weight: number;
      indicative: number;
      invoice: number;
    }>,
  );

  const totalPallets = rows.reduce((s, r) => s + r.pallets, 0);
  const totalWeight = rows.reduce((s, r) => s + r.weight, 0);

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
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Поставка</th>
                  <th className="px-2 py-2 font-medium">Товар</th>
                  <th className="px-2 py-2 font-medium">Калібр</th>
                  <th className="px-2 py-2 text-right font-medium">Палет</th>
                  <th className="px-2 py-2 text-right font-medium">Вага</th>
                  <th className="px-2 py-2 text-right font-medium">Індикатив</th>
                  <th className="px-2 py-2 text-right font-medium">Інвойс</th>
                  <th className="px-2 py-2 font-medium">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="px-2 py-2 font-mono text-[11px] font-semibold">{r.code}</td>
                    <td className="px-2 py-2 font-medium">{r.product}</td>
                    <td className="px-2 py-2 text-muted-foreground">{r.caliber}</td>
                    <td className="px-2 py-2 text-right font-bold tabular-nums">{r.pallets}п</td>
                    <td className="px-2 py-2 text-right font-bold tabular-nums">{r.weight.toLocaleString("uk-UA")} кг</td>
                    <td className="px-2 py-2 text-right tabular-nums text-success font-semibold">${r.indicative.toFixed(2)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-destructive font-semibold">${r.invoice.toFixed(2)}</td>
                    <td className="px-2 py-2">
                      <StatusChip status={r.status} kind="distribution" />
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
    </div>
  );
}
