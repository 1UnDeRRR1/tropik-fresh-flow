import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CostPair } from "@/components/CostPair";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CompactFilterSelect } from "@/components/CompactFilterSelect";
import { useReadOnly } from "@/components/ReadOnlyShell";
import { useProductAliases } from "@/hooks/useProductAliases";
import { useCountryAliases } from "@/hooks/useCountryAliases";
import { countPositionsFromGroups, formatPositions } from "@/lib/positions";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: Analytics,
});

const ALL = "__all";
const NO_COUNTRY = "__no_country__";
const NO_COUNTRY_LABEL = "— Без країни";

type ItemRow = {
  id: string;
  product_name: string;
  origin_country: string | null;
  caliber: string | null;
  variety: string | null;
  pallet_count: number | null;
  pallet_weight: number | null;
  net_weight_kg: number | null;
  gross_weight_kg: number | null;
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

export function Analytics() {
  const { user, hasRole } = useAuth();
  const isStaffAll = hasRole(["admin", "super_admin", "owner"]);
  const isReadOnly = useReadOnly();
  const productAliases = useProductAliases();
  const countryAliases = useCountryAliases();
  const navigate = useNavigate();
  const today = todayISO();
  const { data: currentManagerId } = useQuery({
    queryKey: ["current-import-manager-id", user?.id],
    enabled: !!user && !isStaffAll,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("current_import_manager_id");
      if (error) throw error;
      return data ?? null;
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["analytics-v2", user?.id, isStaffAll],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase
        .from("shipments")
        .select(
          "id,code,country,eta,arrived_at,status,import_manager_id,supplier_id, shipment_items(id,product_name,origin_country,caliber,variety,pallet_count,pallet_weight,net_weight_kg,gross_weight_kg,unit_price,price_currency,final_cost_indicative,final_cost_invoice)",
        )
        .order("eta", { ascending: true })
        .limit(1000);
      if (!isStaffAll && currentManagerId) q = q.eq("import_manager_id", currentManagerId);
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

  const mgrMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const mgr of data?.managers ?? []) {
      // Shipments store auth user_id in import_manager_id; fall back to row id for safety.
      if (mgr.user_id) m.set(mgr.user_id, mgr.full_name);
      m.set(mgr.id, mgr.full_name);
    }
    return m;
  }, [data]);
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

  const [productFilter, setProductFilter] = useState<string>(ALL);
  const [countryFilter, setCountryFilter] = useState<string>(ALL);
  const [managerFilter, setManagerFilter] = useState<string>(ALL);
  const [branchFilter, setBranchFilter] = useState<string>(ALL);

  // Filter options derived from activeFlat
  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const f of activeFlat) {
      const n = f.item.product_name.trim();
      if (n) set.add(n);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk")).map((v) => ({ value: v, label: v }));
  }, [activeFlat]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    let hasMissing = false;
    for (const f of activeFlat) {
      const c = (f.item.origin_country ?? "").trim();
      if (c) set.add(c);
      else hasMissing = true;
    }
    const arr = Array.from(set).sort((a, b) => a.localeCompare(b, "uk")).map((v) => ({ value: v, label: v }));
    if (hasMissing) arr.push({ value: NO_COUNTRY, label: NO_COUNTRY_LABEL });
    return arr;
  }, [activeFlat]);

  const managerOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const f of activeFlat) {
      const id = f.shipment.import_manager_id;
      if (id) ids.add(id);
    }
    return Array.from(ids)
      .map((id) => ({ value: id, label: mgrMap.get(id) ?? "—" }))
      .sort((a, b) => a.label.localeCompare(b.label, "uk"));
  }, [activeFlat, mgrMap]);

  const branchOptions = useMemo(
    () =>
      (data?.branches ?? [])
        .map((b) => ({ value: b.id, label: b.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "uk")),
    [data],
  );

  // AND filter
  const filteredFlat = useMemo<Flat[]>(() => {
    return activeFlat.filter((f) => {
      if (productFilter !== ALL && f.item.product_name.trim() !== productFilter) return false;
      if (countryFilter !== ALL) {
        const c = (f.item.origin_country ?? "").trim();
        if (countryFilter === NO_COUNTRY ? c !== "" : c !== countryFilter) return false;
      }
      if (managerFilter !== ALL && f.shipment.import_manager_id !== managerFilter) return false;
      if (branchFilter !== ALL) {
        const inner = distByItem.get(f.item.id);
        if (!inner || (inner.get(branchFilter) ?? 0) <= 0) return false;
      }
      return true;
    });
  }, [activeFlat, productFilter, countryFilter, managerFilter, branchFilter, distByItem]);

  // Level 1: grouped by product+country (using product origin only)
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
    for (const f of filteredFlat) {
      const country = (f.item.origin_country ?? "").trim();
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
  }, [filteredFlat]);

  const [openGroup, setOpenGroup] = useState<Group | null>(null);
  const [openItem, setOpenItem] = useState<Flat | null>(null);

  const totalPallets = useMemo(
    () => filteredFlat.reduce((a, f) => a + Number(f.item.pallet_count ?? 0), 0),
    [filteredFlat],
  );
  const positionsCount = useMemo(
    () => countPositionsFromGroups(groups, (g) => g.product),
    [groups],
  );
  const totalShipments = useMemo(() => {
    const s = new Set<string>();
    for (const f of filteredFlat) s.add(f.shipment.id);
    return s.size;
  }, [filteredFlat]);

  return (
    <div className="space-y-4">
      <PageHeader title="Аналітика" subtitle="Усі активні товари в системі" />

      {isStaffAll && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Товар</label>
              <CompactFilterSelect value={productFilter} onChange={setProductFilter} options={productOptions} allLabel="Всі товари" allValue={ALL} aliases={productAliases} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Країна походження</label>
              <CompactFilterSelect value={countryFilter} onChange={setCountryFilter} options={countryOptions} allLabel="Всі країни" allValue={ALL} aliases={countryAliases} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Менеджер</label>
              <CompactFilterSelect value={managerFilter} onChange={setManagerFilter} options={managerOptions} allLabel="Всі менеджери" allValue={ALL} />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Філія</label>
              <CompactFilterSelect value={branchFilter} onChange={setBranchFilter} options={branchOptions} allLabel="Всі філії" allValue={ALL} />
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <span className="font-bold tabular-nums text-foreground">{totalShipments}</span> пост. ·{" "}
            <span className="font-bold tabular-nums text-foreground">{formatPositions(positionsCount)}</span> поз. ·{" "}
            <span className="font-bold tabular-nums text-brand">{totalPallets}п</span>
          </div>
        </div>
      )}

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
                  const net = Number(it.net_weight_kg ?? 0);
                  const weight = net > 0 ? net : pallets * Number(it.pallet_weight ?? 0);
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
                          <span>{it.origin_country ?? "—"}</span>
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
                {openItem?.shipment.code} · {openItem?.item.origin_country ?? ""}
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

                    {isStaffAll && !isReadOnly ? (
                      <Button
                        className="w-full"
                        data-mutation
                        onClick={() => {
                          const sid = openItem?.shipment.id;
                          if (!sid) return;
                          setOpenItem(null);
                          setOpenGroup(null);
                          navigate({ to: "/distribution/$shipmentId", params: { shipmentId: sid } });
                        }}
                      >
                        Розподілити
                      </Button>
                    ) : null}
                  </div>
                );
              })()
            : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
