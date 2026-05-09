import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Truck, Building2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatCard, SectionCard, EmptyState } from "@/components/cards";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/dashboard/admin")({
  component: AdminDashboard,
});

type Detail = "urgent" | "transit" | "branches" | null;

interface ShipRow {
  id: string;
  code: string;
  eta: string | null;
  status: string;
  created_by: string | null;
  shipment_items: { id: string; product_name: string; pallet_count: number | null }[];
  distributions: {
    branch_id: string;
    distribution_items: { pallets: number | null; shipment_item_id: string }[] | null;
  }[];
}

function AdminDashboard() {
  const [detail, setDetail] = useState<Detail>(null);

  const { data } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: async () => {
      const isoToday = new Date().toISOString().slice(0, 10);
      const iso24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const [shipsRes, branchesRes, profilesRes, suppliersRes] = await Promise.all([
        supabase
          .from("shipments")
          .select(
            "id,code,eta,status,created_by,shipment_items(id,product_name,pallet_count),distributions(branch_id,distribution_items(pallets,shipment_item_id))",
          )
          .order("eta", { ascending: true })
          .limit(500),
        supabase.from("branches").select("id,name").order("sort_order"),
        supabase.from("profiles").select("id,full_name"),
        supabase.from("suppliers").select("id", { count: "exact", head: true }),
      ]);

      const ships = (shipsRes.data ?? []) as ShipRow[];
      const branches = branchesRes.data ?? [];
      const profiles = profilesRes.data ?? [];
      const profileName = (id: string | null) =>
        profiles.find((p) => p.id === id)?.full_name ?? "—";
      const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "—";

      const active = ships.filter((s) => !["completed", "cancelled"].includes(s.status));

      // urgent: ETA <= 24h with undistributed pallets
      const urgent = active
        .filter((s) => s.eta && s.eta >= isoToday && s.eta <= iso24h)
        .map((s) => {
          const planned = s.shipment_items.reduce((a, i) => a + Number(i.pallet_count ?? 0), 0);
          const distributed = s.distributions.reduce(
            (a, d) => a + (d.distribution_items ?? []).reduce((aa, di) => aa + Number(di.pallets ?? 0), 0),
            0,
          );
          return { s, undistributed: Math.max(0, planned - distributed) };
        })
        .filter((x) => x.undistributed > 0);

      // in transit: active with eta in future (or any active)
      const transit = active
        .filter((s) => s.eta && s.eta >= isoToday)
        .map((s) => {
          const pallets = s.shipment_items.reduce((a, i) => a + Number(i.pallet_count ?? 0), 0);
          const products = Array.from(new Set(s.shipment_items.map((i) => i.product_name))).join(", ");
          return { s, pallets, products };
        });

      // branch distribution: branch -> product -> pallets (+ shipment codes, manager)
      type BranchAgg = Record<
        string,
        {
          branchName: string;
          items: Record<
            string,
            { pallets: number; shipments: Set<string>; managers: Set<string> }
          >;
        }
      >;
      const byBranch: BranchAgg = {};
      for (const s of ships) {
        const itemMap = new Map(s.shipment_items.map((i) => [i.id, i]));
        for (const d of s.distributions) {
          for (const di of d.distribution_items ?? []) {
            const it = itemMap.get(di.shipment_item_id);
            if (!it) continue;
            const pallets = Number(di.pallets ?? 0);
            if (pallets <= 0) continue;
            const bn = branchName(d.branch_id);
            const entry = (byBranch[d.branch_id] ??= { branchName: bn, items: {} });
            const itEntry = (entry.items[it.product_name] ??= {
              pallets: 0,
              shipments: new Set(),
              managers: new Set(),
            });
            itEntry.pallets += pallets;
            itEntry.shipments.add(s.code);
            itEntry.managers.add(profileName(s.created_by));
          }
        }
      }

      return {
        urgent: {
          count: urgent.length,
          pallets: urgent.reduce((a, x) => a + x.undistributed, 0),
          list: urgent.map((x) => ({
            code: x.s.code,
            eta: x.s.eta,
            pallets: x.undistributed,
            manager: profileName(x.s.created_by),
          })),
        },
        transit: {
          count: transit.length,
          pallets: transit.reduce((a, x) => a + x.pallets, 0),
          list: transit.map((x) => ({
            code: x.s.code,
            eta: x.s.eta,
            pallets: x.pallets,
            products: x.products,
            manager: profileName(x.s.created_by),
          })),
        },
        branches: {
          count: branches.length,
          list: Object.values(byBranch),
        },
        supplierCount: suppliersRes.count ?? 0,
      };
    },
  });

  // group urgent by manager
  type UrgentRow = { code: string; eta: string | null; pallets: number; manager: string };
  const urgentByManager = (data?.urgent.list ?? []).reduce<Record<string, UrgentRow[]>>(
    (acc, x) => {
      (acc[x.manager] ??= []).push(x);
      return acc;
    },
    {},
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setDetail("urgent")} className="text-left">
          <StatCard
            label="24Г не розподілено"
            value={`${data?.urgent.count ?? 0}(${data?.urgent.pallets ?? 0}п)`}
            hint={(data?.urgent.count ?? 0) > 0 ? "Терміново" : "Все під контролем"}
            icon={<AlertTriangle className="h-5 w-5" />}
            tone="danger"
            pulse={(data?.urgent.count ?? 0) > 0}
          />
        </button>
        <button type="button" onClick={() => setDetail("transit")} className="text-left">
          <StatCard
            label="В дорозі"
            value={`${data?.transit.count ?? 0}(${data?.transit.pallets ?? 0}п)`}
            hint="Активні поставки"
            icon={<Truck className="h-5 w-5" />}
            tone="brand"
          />
        </button>
        <button type="button" onClick={() => setDetail("branches")} className="text-left">
          <StatCard
            label="Філії"
            value={data?.branches.count ?? 0}
            hint="Розподіл по філіях"
            icon={<Building2 className="h-5 w-5" />}
            tone="warning"
          />
        </button>
        <StatCard
          label="Постачальники"
          value={data?.supplierCount ?? 0}
          icon={<Users className="h-4 w-4" />}
        />
      </div>

      <SectionCard title="Master-data">
        <div className="grid grid-cols-2 gap-2 text-sm font-medium">
          <a href="/admin/branches" className="rounded-xl bg-secondary p-3">Філії</a>
          <a href="/admin/managers" className="rounded-xl bg-secondary p-3">Менеджери</a>
          <a href="/admin/suppliers" className="rounded-xl bg-secondary p-3">Постачальники</a>
          <a href="/admin/products" className="rounded-xl bg-secondary p-3">Товари</a>
          <a href="/admin/countries" className="rounded-xl bg-secondary p-3">Логістика</a>
          <a href="/analytics" className="rounded-xl bg-secondary p-3">Аналітика</a>
        </div>
      </SectionCard>

      <Dialog open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          {detail === "urgent" && (
            <>
              <DialogHeader>
                <DialogTitle>24Г не розподілено</DialogTitle>
              </DialogHeader>
              {Object.keys(urgentByManager).length === 0 ? (
                <EmptyState title="Немає термінових поставок" />
              ) : (
                <div className="space-y-4">
                  {Object.entries(urgentByManager).map(([mgr, rows]) => (
                    <div key={mgr}>
                      <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                        {mgr}
                      </div>
                      <ul className="divide-y divide-border rounded-xl border border-border">
                        {rows.map((r) => (
                          <li key={r.code} className="flex items-center justify-between px-3 py-2 text-sm">
                            <div>
                              <div className="font-semibold">{r.code}</div>
                              <div className="text-xs text-muted-foreground">ETA {r.eta ?? "—"}</div>
                            </div>
                            <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-bold text-destructive">
                              {r.pallets}п
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {detail === "transit" && (
            <>
              <DialogHeader>
                <DialogTitle>В дорозі</DialogTitle>
              </DialogHeader>
              {(data?.transit.list ?? []).length === 0 ? (
                <EmptyState title="Немає активних поставок" />
              ) : (
                <ul className="divide-y divide-border rounded-xl border border-border">
                  {data!.transit.list.map((r) => (
                    <li key={r.code} className="px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">{r.code}</span>
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-700">
                          {r.pallets}п
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {r.products || "—"} · ETA {r.eta ?? "—"} · {r.manager}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {detail === "branches" && (
            <>
              <DialogHeader>
                <DialogTitle>Розподіл по філіях</DialogTitle>
              </DialogHeader>
              {(data?.branches.list ?? []).length === 0 ? (
                <EmptyState title="Розподілу ще немає" />
              ) : (
                <div className="space-y-4">
                  {data!.branches.list.map((b) => (
                    <div key={b.branchName}>
                      <div className="mb-1 text-sm font-bold">{b.branchName}</div>
                      <ul className="divide-y divide-border rounded-xl border border-border">
                        {Object.entries(b.items).map(([name, info]) => (
                          <li key={name} className="flex items-center justify-between px-3 py-2 text-sm">
                            <div>
                              <div className="font-medium">{name}</div>
                              <div className="text-xs text-muted-foreground">
                                {Array.from(info.shipments).join(", ")} · {Array.from(info.managers).join(", ")}
                              </div>
                            </div>
                            <span className="rounded-full bg-warning/30 px-2 py-0.5 text-xs font-bold">
                              {info.pallets}п
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
