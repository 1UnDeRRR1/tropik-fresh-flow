import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, Truck, Building2, Package } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatCard, SectionCard, EmptyState } from "@/components/cards";
import { LoadingPlanManager } from "@/components/LoadingPlanManager";
import { toUaCountry } from "@/lib/countries";
import { countPositionsFromGroups, formatPositions } from "@/lib/positions";
import { computeTriggers } from "@/routes/_authenticated/admin/triggers";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/dashboard/admin")({
  component: AdminDashboard,
});

type Detail = "urgent" | "transit" | "products" | "branches" | null;

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
            "id,code,eta,arrived_at,status,country,created_by,shipment_items(id,product_name,pallet_count,origin_country),distributions(branch_id,distribution_items(pallets,shipment_item_id))",
          )
          .order("eta", { ascending: true })
          .limit(500),
        supabase.from("branches").select("id,name,sort_order").eq("is_active", true).order("sort_order").order("name"),
        supabase.from("profiles").select("id,full_name"),
      ]);

      const ships = (shipsRes.data ?? []) as ShipRow[];
      const branches = branchesRes.data ?? [];
      const profiles = profilesRes.data ?? [];
      const profileName = (id: string | null) =>
        profiles.find((p) => p.id === id)?.full_name ?? "—";
      const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "—";

      // Unified active filter (matches Analytics): status not closed, arrival day still valid
      const active = ships.filter((s) => {
        if (["completed", "cancelled"].includes(s.status)) return false;
        const arrival = s.arrived_at ?? s.eta;
        return !!arrival && arrival >= isoToday;
      });

      // Per-item validity (matches Analytics)
      const validItems = (s: ShipRow) =>
        (s.shipment_items ?? []).filter(
          (i) => (i.product_name || "").trim() && Number(i.pallet_count ?? 0) > 0,
        );

      const urgent = active
        .filter((s) => s.eta && s.eta <= iso24h)
        .map((s) => {
          const items = validItems(s);
          const planned = items.reduce((a, i) => a + Number(i.pallet_count ?? 0), 0);
          const distributed = s.distributions.reduce(
            (a, d) => a + (d.distribution_items ?? []).reduce((aa, di) => aa + Number(di.pallets ?? 0), 0),
            0,
          );
          return { s, undistributed: Math.max(0, planned - distributed) };
        })
        .filter((x) => x.undistributed > 0);

      const transit = active.map((s) => {
        const items = validItems(s);
        const pallets = items.reduce((a, i) => a + Number(i.pallet_count ?? 0), 0);
        return { s, items, pallets };
      }).filter((x) => x.items.length > 0);

      // Products in transit, distributed to at least one branch.
      // Group key: product_name + country (origin_country ?? shipment.country) — matches Analytics
      type ProdAgg = {
        product: string;
        country: string;
        branches: Record<string, number>; // branchName -> pallets
      };
      const byProduct = new Map<string, ProdAgg>();
      for (const { s, items } of transit) {
        const itemMap = new Map(items.map((i) => [i.id, i]));
        for (const d of s.distributions) {
          for (const di of d.distribution_items ?? []) {
            const it = itemMap.get(di.shipment_item_id);
            if (!it) continue;
            const pallets = Number(di.pallets ?? 0);
            if (pallets <= 0) continue;
            const country = toUaCountry(it.origin_country || s.country);
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

      // Group by branch (in branch sort order) -> products alphabetical
      type BranchAgg = {
        branchId: string;
        branchName: string;
        products: Map<string, { product: string; country: string; pallets: number }>;
      };
      const byBranch = new Map<string, BranchAgg>();
      for (const { s, items } of transit) {
        const itemMap = new Map(items.map((i) => [i.id, i]));
        for (const d of s.distributions) {
          for (const di of d.distribution_items ?? []) {
            const it = itemMap.get(di.shipment_item_id);
            if (!it) continue;
            const pallets = Number(di.pallets ?? 0);
            if (pallets <= 0) continue;
            const country = toUaCountry(it.origin_country || s.country);
            const entry =
              byBranch.get(d.branch_id) ??
              { branchId: d.branch_id, branchName: branchName(d.branch_id), products: new Map() };
            const k = `${it.product_name}|${country}`;
            const prev = entry.products.get(k) ?? { product: it.product_name, country, pallets: 0 };
            prev.pallets += pallets;
            entry.products.set(k, prev);
            byBranch.set(d.branch_id, entry);
          }
        }
      }
      const branchOrder = new Map(branches.map((b, i) => [b.id, i]));
      const branchList = Array.from(byBranch.values())
        .sort((a, b) => (branchOrder.get(a.branchId) ?? 999) - (branchOrder.get(b.branchId) ?? 999))
        .map((b) => ({
          branchId: b.branchId,
          branchName: b.branchName,
          products: Array.from(b.products.values()).sort((a, b) =>
            a.product.localeCompare(b.product, "uk"),
          ),
          totalPallets: Array.from(b.products.values()).reduce((a, p) => a + p.pallets, 0),
        }));

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
              const manager = profileName(x.s.created_by);
              // group items per (product+country) within shipment — matches Analytics grouping
              const byProd = new Map<string, { product: string; country: string; pallets: number }>();
              for (const it of x.items) {
                const country = toUaCountry(it.origin_country || x.s.country);
                const k = `${it.product_name}|${country}`;
                const prev = byProd.get(k) ?? { product: it.product_name, country, pallets: 0 };
                prev.pallets += Number(it.pallet_count ?? 0);
                byProd.set(k, prev);
              }
              return Array.from(byProd.values()).map((e) => ({
                key: `${x.s.code}-${e.product}-${e.country}`,
                product: e.product,
                country: e.country,
                code: x.s.code,
                eta: x.s.eta,
                pallets: e.pallets,
                manager,
              }));
            })
            .sort((a, b) => a.product.localeCompare(b.product, "uk")),
        },
        products: productList,
        branches: branchList,
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

  const { data: trigCounts } = useQuery({
    queryKey: ["admin", "triggers", "counts"],
    queryFn: async () => {
      const list = await computeTriggers();
      return {
        red: list.filter((t) => t.level === "red").length,
        yellow: list.filter((t) => t.level === "yellow").length,
        blue: list.filter((t) => t.level === "blue").length,
      };
    },
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link
          to="/admin/triggers"
          className="block rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-left shadow-card"
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold uppercase tracking-wide text-foreground">
              Тригери
            </span>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="mt-2 flex items-center justify-between gap-3 text-base font-bold">
            <span className="text-destructive">Червоні</span>
            <span className="font-normal text-destructive">{trigCounts?.red ?? 0}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-base font-bold">
            <span className="text-warning">Жовті</span>
            <span className="font-normal text-warning">{trigCounts?.yellow ?? 0}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-base font-bold">
            <span className="text-info">Сині</span>
            <span className="font-normal text-info">{trigCounts?.blue ?? 0}</span>
          </div>
        </Link>
        <button type="button" onClick={() => setDetail("transit")} className="text-left">
          <StatCard
            label="В дорозі"
            value={`${data?.transit.count ?? 0}(${data?.transit.pallets ?? 0}п)`}
            hint="Активні поставки"
            icon={<Truck className="h-5 w-5" />}
            tone="success"
          />
        </button>
        <button type="button" onClick={() => setDetail("branches")} className="text-left">
          <StatCard
            label="Філія товари"
            value={data?.branchCount ?? 0}
            hint="Розподілено по філіям"
            icon={<Building2 className="h-5 w-5" />}
            tone="warning"
          />
        </button>
        <button type="button" onClick={() => setDetail("products")} className="text-left">
          <StatCard
            label="Товари по філіям"
            value={formatPositions(countPositionsFromGroups(data?.products ?? [], (p) => p.product))}
            hint="Розподілено в дорозі"
            icon={<Package className="h-5 w-5" />}
            tone="info"
          />
        </button>
      </div>

      <LoadingPlanManager />

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

          {detail === "branches" && (
            <>
              <DialogHeader>
                <DialogTitle>Філія товари</DialogTitle>
              </DialogHeader>
              {(data?.branches ?? []).length === 0 ? (
                <EmptyState title="Розподілених товарів в дорозі немає" />
              ) : (
                <div className="space-y-4">
                  {data!.branches.map((b) => (
                    <div key={b.branchId}>
                      <div className="mb-1 flex items-center justify-between text-sm font-bold">
                        <span>{b.branchName}</span>
                        <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-bold text-foreground">
                          {b.totalPallets}п
                        </span>
                      </div>
                      <ul className="divide-y divide-border rounded-xl border border-border">
                        {b.products.map((p) => (
                          <li
                            key={`${p.product}-${p.country}`}
                            className="flex items-center justify-between px-3 py-2 text-sm"
                          >
                            <span className="truncate">
                              {p.product}
                              {p.country && (
                                <span className="text-muted-foreground"> • {p.country}</span>
                              )}
                            </span>
                            <span className="shrink-0 rounded-full bg-info/15 px-2 py-0.5 text-xs font-bold text-info">
                              {p.pallets}п
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
