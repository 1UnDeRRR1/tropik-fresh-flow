import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { SectionCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";
import { toUaCountry } from "@/lib/countries";

export const Route = createFileRoute("/_calendar/branch")({
  component: BranchCalendarPage,
});

const fmtEta = (eta: string | null) =>
  eta
    ? new Date(eta).toLocaleDateString("uk-UA", {
        day: "2-digit",
        month: "long",
        weekday: "short",
      })
    : "Без дати";

interface DistRow {
  id: string;
  shipment_id: string;
  branch_id: string;
  distribution_items: Array<{
    pallets: number | null;
    shipment_item_id: string | null;
  }>;
}

interface ShipRow {
  id: string;
  code: string;
  status: string;
  eta: string | null;
  country: string | null;
  import_manager_id: string | null;
}

interface ItemRow {
  id: string;
  shipment_id: string;
  product_name: string;
  caliber: string | null;
  origin_country: string | null;
  final_cost_indicative: number | null;
  final_cost_invoice: number | null;
}

interface ManagerRow {
  user_id: string;
  full_name: string | null;
}

function BranchCalendarPage() {
  const { primaryRole } = useAuth();
  // Belongs to /_calendar; staff users still have other dashboards.
  if (primaryRole !== "calendar_branch") return <Navigate to="/" />;

  const distQuery = useQuery({
    queryKey: ["calendar-branch-dist"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributions")
        .select("id,shipment_id,branch_id,distribution_items(pallets,shipment_item_id)")
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as DistRow[];
    },
    refetchInterval: 60_000,
  });

  const shipmentIds = useMemo(
    () => Array.from(new Set((distQuery.data ?? []).map((d) => d.shipment_id))),
    [distQuery.data],
  );

  const shipQuery = useQuery({
    enabled: shipmentIds.length > 0,
    queryKey: ["calendar-branch-ships", shipmentIds.join(",")],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (s: string) => { in: (c: string, v: string[]) => Promise<{ data: unknown; error: unknown }> };
        };
      })
        .from("shipments_branch")
        .select("id,code,status,eta,country,import_manager_id")
        .in("id", shipmentIds);
      if (error) throw error as Error;
      return (data ?? []) as ShipRow[];
    },
  });

  const itemQuery = useQuery({
    enabled: shipmentIds.length > 0,
    queryKey: ["calendar-branch-items", shipmentIds.join(",")],
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (s: string) => { in: (c: string, v: string[]) => Promise<{ data: unknown; error: unknown }> };
        };
      })
        .from("shipment_items_branch")
        .select(
          "id,shipment_id,product_name,caliber,origin_country,final_cost_indicative,final_cost_invoice",
        )
        .in("shipment_id", shipmentIds);
      if (error) throw error as Error;
      return (data ?? []) as ItemRow[];
    },
  });

  const managerIds = useMemo(
    () =>
      Array.from(
        new Set(
          (shipQuery.data ?? [])
            .map((s) => s.import_manager_id)
            .filter((x): x is string => !!x),
        ),
      ),
    [shipQuery.data],
  );

  const managerQuery = useQuery({
    enabled: managerIds.length > 0,
    queryKey: ["calendar-branch-managers", managerIds.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_managers")
        .select("user_id,full_name")
        .in("user_id", managerIds);
      if (error) throw error;
      return (data ?? []) as ManagerRow[];
    },
  });

  const grouped = useMemo(() => {
    const ships = new Map((shipQuery.data ?? []).map((s) => [s.id, s]));
    const items = new Map((itemQuery.data ?? []).map((i) => [i.id, i]));
    const managers = new Map(
      (managerQuery.data ?? []).map((m) => [m.user_id, m.full_name ?? ""]),
    );
    type Row = {
      key: string;
      eta: string | null;
      product: string;
      caliber: string | null;
      pallets: number;
      country: string | null;
      status: string;
      manager: string;
      indicative: number | null;
      invoice: number | null;
      shipmentCode: string;
    };
    const rows: Row[] = [];
    (distQuery.data ?? []).forEach((d) => {
      const s = ships.get(d.shipment_id);
      if (!s || s.status === "cancelled") return;
      const byItem = new Map<string, number>();
      (d.distribution_items ?? []).forEach((di) => {
        if (!di.shipment_item_id) return;
        byItem.set(
          di.shipment_item_id,
          (byItem.get(di.shipment_item_id) ?? 0) + Number(di.pallets ?? 0),
        );
      });
      byItem.forEach((pallets, itemId) => {
        if (pallets <= 0) return;
        const it = items.get(itemId);
        if (!it) return;
        rows.push({
          key: `${d.id}:${itemId}`,
          eta: s.eta,
          product: it.product_name,
          caliber: it.caliber,
          pallets,
          country: it.origin_country ?? s.country ?? null,
          status: s.status,
          manager: managers.get(s.import_manager_id ?? "") ?? "—",
          indicative: it.final_cost_indicative,
          invoice: it.final_cost_invoice,
          shipmentCode: s.code,
        });
      });
    });
    rows.sort((a, b) =>
      (a.eta ?? "9999").localeCompare(b.eta ?? "9999"),
    );
    const groups = new Map<string, Row[]>();
    rows.forEach((r) => {
      const key = r.eta ?? "—";
      const arr = groups.get(key) ?? [];
      arr.push(r);
      groups.set(key, arr);
    });
    return Array.from(groups.entries());
  }, [distQuery.data, shipQuery.data, itemQuery.data, managerQuery.data]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight md:text-3xl">
          Календар філії
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Очікувані надходження на вашу філію
        </p>
      </div>

      {grouped.length === 0 ? (
        <EmptyState title="Поки немає надходжень" hint="Очікуйте розподілу від менеджера" />
      ) : (
        <div className="space-y-4">
          {grouped.map(([eta, rows]) => (
            <SectionCard key={eta} title={fmtEta(eta === "—" ? null : eta)}>
              <div className="-mx-2 overflow-x-auto">
                <table className="w-full min-w-[640px] text-xs">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-2 py-2 font-medium">Товар</th>
                      <th className="px-2 py-2 font-medium">Калібр</th>
                      <th className="px-2 py-2 font-medium">Країна</th>
                      <th className="px-2 py-2 text-right font-medium">Палет</th>
                      <th className="px-2 py-2 font-medium">Статус</th>
                      <th className="px-2 py-2 font-medium">Менеджер</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => (
                      <tr key={r.key}>
                        <td className="px-2 py-2 font-medium">{r.product}</td>
                        <td className="px-2 py-2 text-muted-foreground">
                          {r.caliber ?? "—"}
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">
                          {toUaCountry(r.country ?? "") || "—"}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums font-semibold">
                          {r.pallets}
                        </td>
                        <td className="px-2 py-2">
                          <StatusChip status={r.status} />
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">
                          {r.manager}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          ))}
        </div>
      )}
    </div>
  );
}
