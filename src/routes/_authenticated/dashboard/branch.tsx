import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";
import { toUaCountry } from "@/lib/countries";
import { CostPair } from "@/components/CostPair";

export const Route = createFileRoute("/_authenticated/dashboard/branch")({
  component: BranchDashboard,
});

const FIELD_LABEL: Record<string, string> = {
  qty: "К-сть",
  unit_price: "Ціна",
  caliber: "Калібр",
  pallet_count: "Палет",
  eta: "Дата прибуття",
};

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
          shipments(id,code,eta,country, suppliers(name)),
          distribution_items(pallets,qty, shipment_items(id,product_name,caliber,pallet_count,pallet_weight,invoice_price,indicative_price,final_cost_indicative,final_cost_invoice))
        `)
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const itemIds = (dists ?? [])
        .flatMap((d) => d.distribution_items?.map((di) => di.shipment_items?.id) ?? [])
        .filter(Boolean) as string[];

      let changes: { shipment_item_id: string; field: string; old_value: string | null; new_value: string | null; created_at: string }[] = [];
      if (itemIds.length) {
        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const { data: ch } = await supabase
          .from("shipment_item_changes")
          .select("shipment_item_id,field,old_value,new_value,created_at")
          .in("shipment_item_id", itemIds)
          .gte("created_at", since)
          .order("created_at", { ascending: false });
        changes = ch ?? [];
      }
      return { dists: dists ?? [], changes };
    },
  });

  type Dist = NonNullable<typeof data>["dists"][number];
  type Change = NonNullable<typeof data>["changes"][number];

  // Group by arrival date
  const groups = new Map<string, Dist[]>();
  data?.dists.forEach((d) => {
    const eta = d.shipments?.eta ?? "Без дати";
    const arr = groups.get(eta) ?? [];
    arr.push(d);
    groups.set(eta, arr);
  });
  const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => (a < b ? -1 : 1));

  const changesByItem = new Map<string, Change[]>();
  data?.changes.forEach((c) => {
    const arr = changesByItem.get(c.shipment_item_id) ?? [];
    arr.push(c);
    changesByItem.set(c.shipment_item_id, arr);
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Філія" subtitle="Вхідні поставки за датою прибуття" />

      {!branchId && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">
          Вам ще не призначено філію. Зверніться до адміністратора.
        </div>
      )}

      {!sortedGroups.length ? (
        <EmptyState title="Поки немає вхідних поставок" />
      ) : (
        sortedGroups.map(([eta, dists]) => (
          <SectionCard
            key={eta}
            title={eta === "Без дати" ? "Без дати прибуття" : new Date(eta).toLocaleDateString("uk-UA", { weekday: "long", day: "2-digit", month: "long" })}
          >
            <div className="space-y-3">
              {dists.map((d) => (
                <div key={d.id} className="rounded-xl border border-border bg-background/40 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold">{d.shipments?.code}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.shipments?.suppliers?.name ?? "—"} · {toUaCountry(d.shipments?.country ?? "")}
                      </div>
                    </div>
                    <StatusChip status={d.status} kind="distribution" />
                  </div>
                  <ul className="mt-2 divide-y divide-border">
                    {d.distribution_items?.map((di, idx) => {
                      const it = di.shipment_items;
                      if (!it) return null;
                      const itemChanges = changesByItem.get(it.id) ?? [];
                      return (
                        <li key={idx} className="py-2 text-sm">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium">{it.product_name}</div>
                              <div className="text-xs text-muted-foreground">
                                {it.caliber ? `Калібр ${it.caliber} · ` : ""}
                                {Number(di.pallets ?? 0)} пал. · {Number(di.qty ?? 0)} кг
                              </div>
                            </div>
                            <div className="text-right text-xs">
                              <CostPair indicative={it.final_cost_indicative} invoice={it.final_cost_invoice} suffix="/кг" />
                              <div className="text-[10px] text-muted-foreground">собівартість</div>
                            </div>
                          </div>
                          {itemChanges.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {itemChanges.slice(0, 4).map((c, i) => (
                                <span
                                  key={i}
                                  className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning"
                                >
                                  {FIELD_LABEL[c.field] ?? c.field}: {c.old_value ?? "—"} → {c.new_value ?? "0"}
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </SectionCard>
        ))
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
