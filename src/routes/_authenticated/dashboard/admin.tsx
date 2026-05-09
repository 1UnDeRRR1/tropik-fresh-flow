import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Truck, Building2, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatCard, SectionCard, EmptyState } from "@/components/cards";
import { toUaCountry } from "@/lib/countries";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/dashboard/admin")({
  component: AdminDashboard,
});

type Detail = "urgent" | "transit" | "products" | null;

interface ShipRow {
  id: string;
  code: string;
  eta: string | null;
  arrived_at: string | null;
  status: string;
  country: string | null;
  created_by: string | null;
  shipment_items: { id: string; product_name: string; pallet_count: number | null; origin_country: string | null }[];
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

      const [shipsRes, branchesRes, profilesRes] = await Promise.all([
        supabase
          .from("shipments")
          .select(
            "id,code,eta,status,country,created_by,shipment_items(id,product_name,pallet_count),distributions(branch_id,distribution_items(pallets,shipment_item_id))",
          )
          .order("eta", { ascending: true })
          .limit(500),
        supabase.from("branches").select("id,name").order("sort_order"),
        supabase.from("profiles").select("id,full_name"),
      ]);

      const ships = (shipsRes.data ?? []) as ShipRow[];
      const branches = branchesRes.data ?? [];
      const profiles = profilesRes.data ?? [];
      const profileName = (id: string | null) =>
        profiles.find((p) => p.id === id)?.full_name ?? "—";
      const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "—";

      const active = ships.filter((s) => !["completed", "cancelled"].includes(s.status));

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

      const transit = active
        .filter((s) => s.eta && s.eta >= isoToday)
        .map((s) => {
          const pallets = s.shipment_items.reduce((a, i) => a + Number(i.pallet_count ?? 0), 0);
          const products = Array.from(new Set(s.shipment_items.map((i) => i.product_name))).join(", ");
          return { s, pallets, products };
        });

      // Products in transit, distributed to at least one branch.
      // Group key: product_name + country
      type ProdAgg = {
        product: string;
        country: string;
        branches: Record<string, number>; // branchName -> pallets
      };
      const byProduct = new Map<string, ProdAgg>();
      for (const { s } of transit) {
        const country = toUaCountry(s.country);
        const itemMap = new Map(s.shipment_items.map((i) => [i.id, i]));
        for (const d of s.distributions) {
          for (const di of d.distribution_items ?? []) {
            const it = itemMap.get(di.shipment_item_id);
            if (!it) continue;
            const pallets = Number(di.pallets ?? 0);
            if (pallets <= 0) continue;
            const key = `${it.product_name}|${country}`;
            const entry =
              byProduct.get(key) ??
              { product: it.product_name, country, branches: {} };
            const bn = branchName(d.branch_id);
            entry.branches[bn] = (entry.branches[bn] ?? 0) + pallets;
            byProduct.set(key, entry);
          }
        }
      }
      const productList = Array.from(byProduct.values()).sort((a, b) =>
        a.product.localeCompare(b.product, "uk"),
      );

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
          list: transit
            .flatMap((x) => {
              const byProd = new Map<string, number>();
              for (const it of x.s.shipment_items) {
                const p = Number(it.pallet_count ?? 0);
                byProd.set(it.product_name, (byProd.get(it.product_name) ?? 0) + p);
              }
              const country = toUaCountry(x.s.country);
              const manager = profileName(x.s.created_by);
              const entries = Array.from(byProd.entries());
              if (entries.length === 0) {
                return [{
                  key: x.s.code,
                  product: "—",
                  country,
                  code: x.s.code,
                  eta: x.s.eta,
                  pallets: 0,
                  manager,
                }];
              }
              return entries.map(([product, pallets]) => ({
                key: `${x.s.code}-${product}`,
                product,
                country,
                code: x.s.code,
                eta: x.s.eta,
                pallets,
                manager,
              }));
            })
            .sort((a, b) => a.product.localeCompare(b.product, "uk")),
        },
        products: productList,
        branchCount: branches.length,
      };
    },
  });

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
            tone="success"
          />
        </button>
        <StatCard
          label="Філії"
          value={data?.branchCount ?? 0}
          hint="Усього"
          icon={<Building2 className="h-5 w-5" />}
          tone="warning"
        />
        <button type="button" onClick={() => setDetail("products")} className="text-left">
          <StatCard
            label="Товари по філіям"
            value={data?.products.length ?? 0}
            hint="Розподілено в дорозі"
            icon={<Package className="h-5 w-5" />}
            tone="info"
          />
        </button>
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
                    <li key={r.key} className="px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold">{r.product}</span>
                        <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-xs font-bold text-success">
                          {r.pallets}п
                        </span>
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.country ? `${r.country} · ` : ""}{r.code} · ETA {r.eta ?? "—"} · {r.manager}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {detail === "products" && (
            <>
              <DialogHeader>
                <DialogTitle>Товари по філіям</DialogTitle>
              </DialogHeader>
              {(data?.products ?? []).length === 0 ? (
                <EmptyState title="Розподілених товарів в дорозі немає" />
              ) : (
                <div className="space-y-4">
                  {data!.products.map((p) => (
                    <div key={`${p.product}-${p.country}`}>
                      <div className="mb-1 text-sm font-bold">
                        {p.product}
                        {p.country && (
                          <span className="text-muted-foreground"> • {p.country}</span>
                        )}
                      </div>
                      <ul className="divide-y divide-border rounded-xl border border-border">
                        {Object.entries(p.branches)
                          .sort(([a], [b]) => a.localeCompare(b, "uk"))
                          .map(([bn, pal]) => (
                            <li
                              key={bn}
                              className="flex items-center justify-between px-3 py-2 text-sm"
                            >
                              <span>{bn}</span>
                              <span className="rounded-full bg-info/15 px-2 py-0.5 text-xs font-bold text-info">
                                {pal}п
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
