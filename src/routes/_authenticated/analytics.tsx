import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CostPair } from "@/components/CostPair";
import { ChevronRight } from "lucide-react";
import { countPositions, countPositionsFromGroups, formatPositions } from "@/lib/positions";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: Analytics,
});

type ItemRow = {
  id: string;
  product_name: string;
  origin_country: string | null;
  caliber: string | null;
  variety: string | null;
  pallet_count: number | null;
  pallet_weight: number | null;
  unit_price: number | null;
  price_currency: string | null;
  final_cost_indicative: number | null;
  final_cost_invoice: number | null;
};

type ShipmentRow = {
  id: string;
  code: string;
  country: string | null;
  eta: string | null;
  arrived_at: string | null;
  status: string | null;
  import_manager_id: string | null;
  supplier_id: string | null;
  shipment_items: ItemRow[];
};

type Manager = { id: string; full_name: string; user_id: string | null };
type Supplier = { id: string; name: string };
type Branch = { id: string; name: string };
type DistItem = { shipment_item_id: string; pallets: number | null };
type Dist = { branch_id: string; distribution_items: DistItem[] };

function todayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

type Flat = {
  item: ItemRow;
  shipment: ShipmentRow;
};

function Analytics() {
  const { user, hasRole } = useAuth();
  const isStaffAll = hasRole(["admin", "super_admin"]);
  const today = todayISO();

  const { data, isLoading } = useQuery({
    queryKey: ["analytics-v2", user?.id, isStaffAll],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase
        .from("shipments")
        .select(
          "id,code,country,eta,arrived_at,status,import_manager_id,supplier_id, shipment_items(id,product_name,origin_country,caliber,variety,pallet_count,pallet_weight,unit_price,price_currency,final_cost_indicative,final_cost_invoice)",
        )
        .order("eta", { ascending: true })
        .limit(1000);
      if (!isStaffAll) q = q.eq("import_manager_id", user!.id);
      const [shRes, mgrRes, supRes, brRes, distRes] = await Promise.all([
        q,
        supabase.from("import_managers").select("id,full_name,user_id"),
        supabase.from("suppliers").select("id,name"),
        supabase.from("branches").select("id,name").eq("is_active", true),
        supabase.from("distributions").select("branch_id, shipment_id, distribution_items(shipment_item_id,pallets)"),
      ]);
      if (shRes.error) throw shRes.error;
      return {
        shipments: (shRes.data ?? []) as ShipmentRow[],
        managers: (mgrRes.data ?? []) as Manager[],
        suppliers: (supRes.data ?? []) as Supplier[],
        branches: (brRes.data ?? []) as Branch[],
        distributions: (distRes.data ?? []) as Dist[],
      };
    },
  });

  const mgrMap = useMemo(() => new Map((data?.managers ?? []).map((m) => [m.id, m.full_name])), [data]);
  const supMap = useMemo(() => new Map((data?.suppliers ?? []).map((s) => [s.id, s.name])), [data]);
  const brMap = useMemo(() => new Map((data?.branches ?? []).map((b) => [b.id, b.name])), [data]);

  // Per-item distribution map: itemId -> Map<branchId, pallets>
  const distByItem = useMemo(() => {
    const m = new Map<string, Map<string, number>>();
    for (const d of data?.distributions ?? []) {
      for (const di of d.distribution_items ?? []) {
        const inner = m.get(di.shipment_item_id) ?? new Map<string, number>();
        inner.set(d.branch_id, (inner.get(d.branch_id) ?? 0) + Number(di.pallets ?? 0));
        m.set(di.shipment_item_id, inner);
      }
    }
    return m;
  }, [data]);

  // Active items: ETA day still valid (today <= arrival)
  const activeFlat = useMemo<Flat[]>(() => {
    const out: Flat[] = [];
    for (const sh of data?.shipments ?? []) {
      if (sh.status && ["completed", "cancelled"].includes(sh.status)) continue;
      const arrival = sh.arrived_at ?? sh.eta;
      if (!arrival || arrival < today) continue;
      for (const it of sh.shipment_items ?? []) {
        const name = (it.product_name || "").trim();
        const pallets = Number(it.pallet_count ?? 0);
        if (!name || pallets <= 0) continue;
        out.push({ item: it, shipment: sh });
      }
    }
    return out;
  }, [data, today]);

  // Level 1: grouped by product+country
  type Group = {
    key: string;
    product: string;
    country: string;
    pallets: number;
    positions: number;
    shipments: number;
    flats: Flat[];
  };
  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, Group>();
    const shipSets = new Map<string, Set<string>>();
    for (const f of activeFlat) {
      const country = (f.item.origin_country || f.shipment.country || "").trim();
      const product = f.item.product_name.trim();
      const key = `${product}__${country}`;
      const g =
        m.get(key) ?? { key, product, country, pallets: 0, positions: 0, shipments: 0, flats: [] };
      g.pallets += Number(f.item.pallet_count ?? 0);
      g.positions += 1;
      g.flats.push(f);
      m.set(key, g);
      const s = shipSets.get(key) ?? new Set<string>();
      s.add(f.shipment.id);
      shipSets.set(key, s);
    }
    for (const [k, g] of m) g.shipments = shipSets.get(k)?.size ?? 0;
    return Array.from(m.values()).sort(
      (a, b) => a.product.localeCompare(b.product, "uk") || a.country.localeCompare(b.country, "uk"),
    );
  }, [activeFlat]);

  const [openGroup, setOpenGroup] = useState<Group | null>(null);
  const [openItem, setOpenItem] = useState<Flat | null>(null);
  const [view, setView] = useState<"product" | "manager" | "supplier">("product");

  // Grouping by manager / supplier (admins only)
  type ProdSub = {
    product: string;
    country: string;
    pallets: number;
    positions: number;
    shipments: number;
    flats: Flat[];
  };
  type OwnerGroup = {
    key: string;
    name: string;
    pallets: number;
    positions: number;
    basePositions: number;
    shipments: number;
    products: ProdSub[];
  };
  const ownerGroups = useMemo<OwnerGroup[]>(() => {
    if (view === "product") return [];
    const map = new Map<string, OwnerGroup>();
    const ownerShipSets = new Map<string, Set<string>>();
    const prodShipSets = new Map<string, Set<string>>();
    for (const f of activeFlat) {
      const ownerId =
        view === "manager" ? f.shipment.import_manager_id ?? "" : f.shipment.supplier_id ?? "";
      const ownerName =
        view === "manager"
          ? mgrMap.get(ownerId) ?? "— Без менеджера"
          : supMap.get(ownerId) ?? "— Без постачальника";
      const key = ownerId || `__none_${view}`;
      const og =
        map.get(key) ?? { key, name: ownerName, pallets: 0, positions: 0, basePositions: 0, shipments: 0, products: [] };
      const product = f.item.product_name.trim();
      const country = (f.item.origin_country || f.shipment.country || "").trim();
      const pallets = Number(f.item.pallet_count ?? 0);
      let pg = og.products.find((p) => p.product === product && p.country === country);
      if (!pg) {
        pg = { product, country, pallets: 0, positions: 0, shipments: 0, flats: [] };
        og.products.push(pg);
      }
      pg.pallets += pallets;
      pg.positions += 1;
      pg.flats.push(f);
      og.pallets += pallets;
      og.positions += 1;
      map.set(key, og);
      const oset = ownerShipSets.get(key) ?? new Set<string>();
      oset.add(f.shipment.id);
      ownerShipSets.set(key, oset);
      const pkey = `${key}__${product}__${country}`;
      const pset = prodShipSets.get(pkey) ?? new Set<string>();
      pset.add(f.shipment.id);
      prodShipSets.set(pkey, pset);
    }
    const arr = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "uk"));
    for (const g of arr) {
      g.shipments = ownerShipSets.get(g.key)?.size ?? 0;
      g.products.sort(
        (a, b) => a.product.localeCompare(b.product, "uk") || a.country.localeCompare(b.country, "uk"),
      );
      g.basePositions = countPositionsFromGroups(g.products, (p) => p.product).base;
      for (const p of g.products) {
        p.shipments = prodShipSets.get(`${g.key}__${p.product}__${p.country}`)?.size ?? 0;
      }
    }
    return arr;
  }, [activeFlat, view, mgrMap, supMap]);

  const [openOwner, setOpenOwner] = useState<OwnerGroup | null>(null);

  const totalPallets = useMemo(
    () => activeFlat.reduce((a, f) => a + Number(f.item.pallet_count ?? 0), 0),
    [activeFlat],
  );
  // total = unique product+country combinations (matches the grouped rows shown below);
  // base  = unique products ignoring country.
  const positionsCount = useMemo(
    () => countPositionsFromGroups(groups, (g) => g.product),
    [groups],
  );
  const totalShipments = useMemo(() => {
    const s = new Set<string>();
    for (const f of activeFlat) s.add(f.shipment.id);
    return s.size;
  }, [activeFlat]);

  return (
    <div className="space-y-4">
      <PageHeader title="Аналітика" subtitle="Усі активні товари в системі" />

      {isStaffAll && (
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex rounded-lg bg-muted p-1 text-xs font-medium">
            {(
              [
                { v: "product", label: "Товар" },
                { v: "manager", label: "Менеджер" },
                { v: "supplier", label: "Постачальник" },
              ] as const
            ).map((t) => (
              <button
                key={t.v}
                type="button"
                onClick={() => setView(t.v)}
                className={`rounded-md px-3 py-1.5 transition-colors ${
                  view === t.v ? "bg-background text-foreground shadow" : "text-muted-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-muted-foreground">
            <span className="font-bold tabular-nums text-foreground">{totalShipments}</span> пост. ·{" "}
            <span className="font-bold tabular-nums text-foreground">{formatPositions(positionsCount)}</span> поз. ·{" "}
            <span className="font-bold tabular-nums text-brand">{totalPallets}п</span>
          </span>
        </div>
      )}

      {view === "product" && (
      <SectionCard title="Товар · країна · палети">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Завантаження…</p>
        ) : !groups.length ? (
          <EmptyState title="Немає активних товарів" hint="Товари зникають з аналітики наступного дня після прибуття." />
        ) : (
          <ul className="divide-y divide-border">
            {groups.map((g) => (
              <li key={g.key}>
                <button
                  type="button"
                  onClick={() => setOpenGroup(g)}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left active:opacity-70"
                >
                  <div className="min-w-0 flex-1 text-sm">
                    <div>
                      <span className="font-medium">{g.product}</span>
                      {g.country ? <span className="text-muted-foreground"> · {g.country}</span> : null}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {g.shipments} пост. · {formatPositions({ base: 1, total: g.positions })} поз.
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-sm font-bold tabular-nums text-brand">{g.pallets}п</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      )}

      {view !== "product" && (
        <SectionCard title={view === "manager" ? "Менеджер · палети" : "Постачальник · палети"}>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Завантаження…</p>
          ) : !ownerGroups.length ? (
            <EmptyState title="Немає активних товарів" />
          ) : (
            <ul className="divide-y divide-border">
              {ownerGroups.map((og) => (
                <li key={og.key}>
                  <button
                    type="button"
                    onClick={() => setOpenOwner(og)}
                    className="flex w-full items-center justify-between gap-3 py-2.5 text-left active:opacity-70"
                  >
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-medium">{og.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {og.shipments} пост. · {formatPositions({ base: og.basePositions, total: og.positions })} поз.
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-sm font-bold tabular-nums text-brand">{og.pallets}п</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      )}

      {/* Owner detail dialog */}
      <Dialog open={!!openOwner} onOpenChange={(o) => !o && setOpenOwner(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              {openOwner?.name}
              <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                {openOwner?.shipments} пост. · {openOwner ? formatPositions({ base: openOwner.basePositions, total: openOwner.positions }) : "0 / 0"} поз. · {openOwner?.pallets}п
              </div>
            </DialogTitle>
          </DialogHeader>
          {openOwner ? (
            <ul className="divide-y divide-border">
              {openOwner.products.map((p) => (
                <li key={`${p.product}__${p.country}`}>
                  <button
                    type="button"
                    onClick={() =>
                      setOpenGroup({
                        key: `${p.product}__${p.country}`,
                        product: p.product,
                        country: p.country,
                        pallets: p.pallets,
                        positions: p.positions,
                        shipments: p.shipments,
                        flats: p.flats,
                      })
                    }
                    className="flex w-full items-center justify-between gap-3 py-2.5 text-left active:opacity-70"
                  >
                    <div className="min-w-0 flex-1 text-sm">
                      <div>
                        <span className="font-medium">{p.product}</span>
                        {p.country ? <span className="text-muted-foreground"> · {p.country}</span> : null}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {p.shipments} пост. · {formatPositions({ base: 1, total: p.positions })} поз.
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="text-sm font-bold tabular-nums text-brand">{p.pallets}п</span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Level 2: positions of selected product+country */}
      <Dialog open={!!openGroup} onOpenChange={(o) => !o && setOpenGroup(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              {openGroup?.product}
              {openGroup?.country ? <span className="text-muted-foreground"> · {openGroup.country}</span> : null}
            </DialogTitle>
          </DialogHeader>
          {openGroup ? (
            <ul className="divide-y divide-border">
              {openGroup.flats
                .slice()
                .sort((a, b) => (a.shipment.eta ?? "").localeCompare(b.shipment.eta ?? ""))
                .map((f) => {
                  const it = f.item;
                  const sh = f.shipment;
                  const pallets = Number(it.pallet_count ?? 0);
                  const weight = pallets * Number(it.pallet_weight ?? 0);
                  const dist = distByItem.get(it.id);
                  const distributed = dist ? Array.from(dist.values()).reduce((a, b) => a + b, 0) : 0;
                  const remaining = pallets - distributed;
                  return (
                    <li key={`${sh.id}-${it.id}`}>
                      <button
                        type="button"
                        onClick={() => setOpenItem(f)}
                        className="flex w-full flex-col gap-1 py-2.5 text-left active:opacity-70"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold">
                            ETA {sh.eta ?? "—"}
                          </span>
                          <span className="shrink-0 text-sm font-bold tabular-nums text-brand">{pallets}п</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span className="font-mono text-foreground">{sh.code}</span>
                          {it.caliber ? <span>·{it.caliber}</span> : null}
                          <span>{supMap.get(sh.supplier_id ?? "") ?? "—"}</span>
                          <span>{(it.origin_country || sh.country) ?? "—"}</span>
                          <span>{Math.round(weight)} кг</span>
                          <span className="text-success">розпод. {distributed}п</span>
                          <span className={remaining < 0 ? "text-destructive" : "text-warning"}>залиш. {remaining}п</span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 text-[11px]">
                          <span className="text-muted-foreground">
                            закуп. {Number(it.unit_price ?? 0).toFixed(2)} {it.price_currency ?? ""}
                          </span>
                          <CostPair indicative={it.final_cost_indicative} invoice={it.final_cost_invoice} suffix=" кг" size="xs" />
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Менеджер: {mgrMap.get(sh.import_manager_id ?? "") ?? "—"}
                        </div>
                      </button>
                    </li>
                  );
                })}
            </ul>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Level 3: distribution per item by branch */}
      <Dialog open={!!openItem} onOpenChange={(o) => !o && setOpenItem(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              {openItem?.item.product_name}
              {openItem?.item.caliber ? <span className="text-muted-foreground"> ·{openItem.item.caliber}</span> : null}
              <div className="mt-0.5 text-xs font-normal text-muted-foreground">
                {openItem?.shipment.code} · {(openItem?.item.origin_country || openItem?.shipment.country) ?? ""}
              </div>
            </DialogTitle>
          </DialogHeader>
          {openItem
            ? (() => {
                const total = Number(openItem.item.pallet_count ?? 0);
                const dist = distByItem.get(openItem.item.id);
                const rows = dist
                  ? Array.from(dist.entries())
                      .map(([bid, p]) => ({ branch: brMap.get(bid) ?? "—", pallets: p }))
                      .filter((r) => r.pallets > 0)
                      .sort((a, b) => a.branch.localeCompare(b.branch, "uk"))
                  : [];
                const distributed = rows.reduce((a, b) => a + b.pallets, 0);
                const remaining = total - distributed;
                return (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg bg-secondary px-2 py-1.5">
                        <div className="text-[10px] text-muted-foreground">Всього</div>
                        <div className="text-sm font-bold tabular-nums">{total}п</div>
                      </div>
                      <div className="rounded-lg bg-success/15 px-2 py-1.5">
                        <div className="text-[10px] text-success">Розпод.</div>
                        <div className="text-sm font-bold tabular-nums text-success">{distributed}п</div>
                      </div>
                      <div className={`rounded-lg px-2 py-1.5 ${remaining < 0 ? "bg-destructive/15" : "bg-warning/15"}`}>
                        <div className={`text-[10px] ${remaining < 0 ? "text-destructive" : "text-warning"}`}>Залиш.</div>
                        <div className={`text-sm font-bold tabular-nums ${remaining < 0 ? "text-destructive" : "text-warning"}`}>
                          {remaining}п
                        </div>
                      </div>
                    </div>

                    {rows.length ? (
                      <ul className="divide-y divide-border rounded-xl border border-border">
                        {rows.map((r) => (
                          <li key={r.branch} className="flex items-center justify-between gap-2 px-3 py-2">
                            <span className="truncate text-sm font-medium">{r.branch}</span>
                            <span className="text-sm font-bold tabular-nums text-brand">{r.pallets}п</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState title="Ще не розподілено" hint="Усі палети — у залишку." />
                    )}
                  </div>
                );
              })()
            : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
