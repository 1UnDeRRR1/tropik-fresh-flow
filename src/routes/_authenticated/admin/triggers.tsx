import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/admin/triggers")({
  component: TriggersPage,
});

type Level = "red" | "yellow" | "blue";
type Trigger = {
  id: string;
  level: Level;
  code: string;
  title: string;
  detail: string;
  context?: string;
};

const DAY = 24 * 60 * 60 * 1000;

function daysBetween(a: string | null | undefined, b: Date) {
  if (!a) return Infinity;
  return (new Date(a).getTime() - b.getTime()) / DAY;
}

function TriggersPage() {
  const { hasRole, loading } = useAuth();
  const [tab, setTab] = useState<Level>("red");

  const { data: triggers = [], isLoading } = useQuery({
    queryKey: ["admin", "triggers"],
    queryFn: computeTriggers,
    refetchInterval: 60_000,
  });

  if (loading) return null;
  if (!hasRole(["admin", "super_admin"])) return <Navigate to="/dashboard/admin" />;

  const grouped = useMemo(() => {
    return {
      red: triggers.filter((t) => t.level === "red"),
      yellow: triggers.filter((t) => t.level === "yellow"),
      blue: triggers.filter((t) => t.level === "blue"),
    };
  }, [triggers]);

  const tabsCfg: { key: Level; label: string; icon: React.ReactNode; cls: string; hoverCls: string }[] = [
    { key: "red", label: "Червоні", icon: <AlertOctagon className="h-4 w-4" />, cls: "bg-destructive/15 text-destructive border-destructive/30", hoverCls: "hover:bg-destructive/15 hover:text-destructive hover:border-destructive/30" },
    { key: "yellow", label: "Жовті", icon: <AlertTriangle className="h-4 w-4" />, cls: "bg-warning/15 text-[oklch(0.55_0.18_75)] border-warning/40", hoverCls: "hover:bg-warning/15 hover:text-[oklch(0.55_0.18_75)] hover:border-warning/40" },
    { key: "blue", label: "Сині", icon: <Info className="h-4 w-4" />, cls: "bg-info/15 text-info border-info/30", hoverCls: "hover:bg-info/15 hover:text-info hover:border-info/30" },
  ];

  const list = grouped[tab];

  return (
    <div className="space-y-4">
      <PageHeader title="Тригери" subtitle="Критичні події по всій системі" />

      <div className="grid grid-cols-3 gap-2">
        {tabsCfg.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-xl border p-3 text-left transition ${
                active ? t.cls : `border-border bg-card text-foreground ${t.hoverCls}`
              }`}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase">
                {t.icon}
                <span>{t.label}</span>
              </div>
              <div className="mt-1 text-2xl font-extrabold">{grouped[t.key].length}</div>
            </button>
          );
        })}
      </div>

      <SectionCard title={tabsCfg.find((x) => x.key === tab)!.label}>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Завантаження…</div>
        ) : list.length === 0 ? (
          <EmptyState title="Тригерів немає" />
        ) : (
          <ul className="space-y-2">
            {list.map((t) => (
              <li
                key={t.id}
                className={`rounded-xl border p-3 ${
                  t.level === "red"
                    ? "border-destructive/30 bg-destructive/5"
                    : t.level === "yellow"
                      ? "border-warning/40 bg-warning/5"
                      : "border-info/30 bg-info/5"
                }`}
              >
                <div className="text-sm font-bold">{t.title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{t.detail}</div>
                {t.context && (
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {t.context}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}

export async function computeTriggers(): Promise<Trigger[]> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const isoDaysAgo = (n: number) =>
    new Date(now.getTime() - n * DAY).toISOString().slice(0, 10);

  const [shipsRes, vehiclesRes, branchesRes, brReqRes, mgrsRes, vacsRes, suppRes, distRes] =
    await Promise.all([
      supabase
        .from("shipments")
        .select(
          "id,code,eta,arrived_at,status,country,loading_date,vehicle_id,supplier_id,import_manager_id,created_by,created_at,logistics_cost_usd,shipment_items(id,product_name,pallet_count,unit_price_usd,origin_country,created_at)",
        )
        .limit(1000),
      supabase.from("vehicles").select("id,country,country_code,loading_date,status,total_pallets,total_weight_kg,created_at"),
      supabase.from("branches").select("id,name,is_active").eq("is_active", true),
      supabase
        .from("branch_requests")
        .select("id,branch_id,shipment_item_id,sale_price,status,created_at,decision_notes")
        .gte("created_at", isoDaysAgo(30)),
      supabase.from("import_managers").select("id,full_name,is_active"),
      supabase.from("manager_vacations").select("id,import_manager_id,start_date,end_date"),
      supabase.from("suppliers").select("id,import_manager_id"),
      supabase.from("distributions").select("id,shipment_id,branch_id,distribution_items(pallets,shipment_item_id)"),
    ]);

  const ships = shipsRes.data ?? [];
  const vehicles = vehiclesRes.data ?? [];
  const branches = branchesRes.data ?? [];
  const brReq = brReqRes.data ?? [];
  const mgrs = mgrsRes.data ?? [];
  const vacs = vacsRes.data ?? [];
  const suppliers = suppRes.data ?? [];
  const distributions = distRes.data ?? [];

  const out: Trigger[] = [];

  const onVacation = (mid: string) =>
    vacs.some((v) => v.import_manager_id === mid && v.start_date <= today && v.end_date >= today);

  const supplierMgr = new Map(suppliers.map((s) => [s.id, s.import_manager_id]));
  const mgrName = (id: string | null | undefined) => mgrs.find((m) => m.id === id)?.full_name ?? "—";
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "—";

  const shipMgr = (s: any) => s.import_manager_id ?? supplierMgr.get(s.supplier_id) ?? null;

  // Distribution sums per shipment_item
  const distByItem = new Map<string, number>();
  for (const d of distributions) {
    for (const di of d.distribution_items ?? []) {
      const k = di.shipment_item_id;
      distByItem.set(k, (distByItem.get(k) ?? 0) + Number(di.pallets ?? 0));
    }
  }

  // ---------- RED ----------

  // 1. Vehicle not closed before loading (≤24h)
  for (const v of vehicles) {
    if (v.status === "closed") continue;
    const d = daysBetween(v.loading_date, now);
    if (d <= 1 && d >= -1) {
      out.push({
        id: `r1-${v.id}`,
        level: "red",
        code: "VEHICLE_NOT_CLOSED",
        title: "Авто не закрите перед завантаженням",
        detail: `${v.country} · завантаження ${v.loading_date ?? "—"} · ${v.total_pallets}п`,
        context: "Авто",
      });
    }
  }

  // 2. Undistributed before arrival (≤24h)
  for (const s of ships) {
    if (["completed", "cancelled"].includes(s.status)) continue;
    const arrival = s.arrived_at ?? s.eta;
    const d = daysBetween(arrival, now);
    if (d > 1 || d < -1) continue;
    const items = (s.shipment_items ?? []).filter(
      (i: any) => (i.product_name || "").trim() && Number(i.pallet_count ?? 0) > 0,
    );
    const planned = items.reduce((a: number, i: any) => a + Number(i.pallet_count ?? 0), 0);
    const distributed = items.reduce((a: number, i: any) => a + (distByItem.get(i.id) ?? 0), 0);
    const undist = Math.max(0, planned - distributed);
    if (undist > 0) {
      out.push({
        id: `r2-${s.id}`,
        level: "red",
        code: "UNDISTRIBUTED_BEFORE_ETA",
        title: "Нерозподілений товар перед прибуттям",
        detail: `${s.code} · ETA ${arrival} · ${undist}п не розподілено`,
        context: `Менеджер: ${mgrName(shipMgr(s))}`,
      });
    }
  }

  // 3. Inactive branch — no requests with qty + price in last 14 days
  const since14 = isoDaysAgo(14);
  for (const b of branches) {
    const has = brReq.some(
      (r) => r.branch_id === b.id && r.created_at >= since14 && (r.sale_price ?? 0) > 0,
    );
    if (!has) {
      out.push({
        id: `r3-${b.id}`,
        level: "red",
        code: "INACTIVE_BRANCH",
        title: "Неактивна філія",
        detail: `${b.name} — немає заявок з ціною за 14 днів`,
        context: "Філія",
      });
    }
  }

  // 4. Inactive import manager — no shipments in last 7 days (skip if on vacation)
  const since7 = isoDaysAgo(7);
  for (const m of mgrs) {
    if (!m.is_active) continue;
    if (onVacation(m.id)) continue;
    const has = ships.some((s) => {
      const mid = shipMgr(s);
      return mid === m.id && s.created_at >= since7;
    });
    if (!has) {
      out.push({
        id: `r4-${m.id}`,
        level: "red",
        code: "INACTIVE_MANAGER",
        title: "Неактивний менеджер",
        detail: `${m.full_name} — не створював поставок за 7 днів`,
        context: "Менеджер",
      });
    }
  }

  // ---------- YELLOW ----------

  // 1. Branch missing common position (in ≥80% of branches over last 7 days, absent in this branch)
  const totalBranches = branches.length;
  if (totalBranches > 0) {
    const threshold = Math.ceil(totalBranches * 0.8);
    // product => set(branch_id) over recent 7 days distributions
    const itemBranches = new Map<string, Set<string>>();
    for (const d of distributions) {
      const ship = ships.find((s) => s.id === d.shipment_id);
      if (!ship) continue;
      if (ship.created_at < since7) continue;
      for (const di of d.distribution_items ?? []) {
        if (Number(di.pallets ?? 0) <= 0) continue;
        const it = (ship.shipment_items ?? []).find((i: any) => i.id === di.shipment_item_id);
        if (!it) continue;
        const key = (it.product_name || "").trim();
        if (!key) continue;
        const set = itemBranches.get(key) ?? new Set();
        set.add(d.branch_id);
        itemBranches.set(key, set);
      }
    }
    for (const [product, set] of itemBranches.entries()) {
      if (set.size < threshold) continue;
      for (const b of branches) {
        if (set.has(b.id)) continue;
        out.push({
          id: `y1-${product}-${b.id}`,
          level: "yellow",
          code: "BRANCH_MISSING_COMMON",
          title: "Філія без популярної позиції",
          detail: `${b.name} не має «${product}» (є у ${set.size}/${totalBranches} філій)`,
          context: "Філія / Товар",
        });
      }
    }
  }

  // 2. Manager has 3+ open vehicles — vehicle has no manager direct field; aggregate by ship's manager
  const openVehiclesByMgr = new Map<string, number>();
  for (const v of vehicles) {
    if (v.status !== "open") continue;
    // find managers from shipments on this vehicle
    const mids = new Set<string>();
    for (const s of ships) {
      if (s.vehicle_id !== v.id) continue;
      const mid = shipMgr(s);
      if (mid) mids.add(mid);
    }
    for (const mid of mids) openVehiclesByMgr.set(mid, (openVehiclesByMgr.get(mid) ?? 0) + 1);
  }
  for (const [mid, n] of openVehiclesByMgr.entries()) {
    if (n >= 3) {
      out.push({
        id: `y2-${mid}`,
        level: "yellow",
        code: "TOO_MANY_OPEN_VEHICLES",
        title: "Забагато відкритих авто",
        detail: `${mgrName(mid)} має ${n} відкритих авто одночасно`,
        context: "Менеджер",
      });
    }
  }

  // 3. ETA ≤48h, ≥50% undistributed, transit ≥4 days
  for (const s of ships) {
    if (["completed", "cancelled"].includes(s.status)) continue;
    const arrival = s.arrived_at ?? s.eta;
    const d = daysBetween(arrival, now);
    if (d > 2 || d < 0) continue;
    if (!s.loading_date || !arrival) continue;
    const transit = (new Date(arrival).getTime() - new Date(s.loading_date).getTime()) / DAY;
    if (transit < 4) continue;
    const items = (s.shipment_items ?? []).filter(
      (i: any) => (i.product_name || "").trim() && Number(i.pallet_count ?? 0) > 0,
    );
    const planned = items.reduce((a: number, i: any) => a + Number(i.pallet_count ?? 0), 0);
    if (planned === 0) continue;
    const distributed = items.reduce((a: number, i: any) => a + (distByItem.get(i.id) ?? 0), 0);
    const ratio = (planned - distributed) / planned;
    if (ratio >= 0.5) {
      out.push({
        id: `y3-${s.id}`,
        level: "yellow",
        code: "HIGH_UNDISTRIBUTED_NEAR_ETA",
        title: "Багато нерозподіленого перед ETA",
        detail: `${s.code} · ${Math.round(ratio * 100)}% не розподілено · transit ${Math.round(transit)} дн.`,
        context: `Менеджер: ${mgrName(shipMgr(s))}`,
      });
    }
  }

  // 4. Branch dominates position — one branch holds ≥50% of distributed qty for a product
  const prodBranchPallets = new Map<string, Map<string, number>>();
  for (const d of distributions) {
    const ship = ships.find((s) => s.id === d.shipment_id);
    if (!ship) continue;
    for (const di of d.distribution_items ?? []) {
      const it = (ship.shipment_items ?? []).find((i: any) => i.id === di.shipment_item_id);
      if (!it) continue;
      const key = (it.product_name || "").trim();
      if (!key) continue;
      const pal = Number(di.pallets ?? 0);
      if (pal <= 0) continue;
      const m = prodBranchPallets.get(key) ?? new Map();
      m.set(d.branch_id, (m.get(d.branch_id) ?? 0) + pal);
      prodBranchPallets.set(key, m);
    }
  }
  for (const [product, m] of prodBranchPallets.entries()) {
    const total = Array.from(m.values()).reduce((a, b) => a + b, 0);
    if (total <= 0) continue;
    for (const [bid, pal] of m.entries()) {
      if (pal / total >= 0.5 && m.size > 1) {
        out.push({
          id: `y4-${product}-${bid}`,
          level: "yellow",
          code: "BRANCH_DOMINATES",
          title: "Філія домінує по позиції",
          detail: `${branchName(bid)} тримає ${Math.round((pal / total) * 100)}% «${product}»`,
          context: "Філія / Товар",
        });
      }
    }
  }

  // ---------- BLUE ----------

  // 1. Transport price spike: same country, current vehicle vs previous (cost per pallet via shipment.logistics_cost_usd / total_pallets)
  const vehiclesByCountry = new Map<string, any[]>();
  for (const v of vehicles) {
    const arr = vehiclesByCountry.get(v.country) ?? [];
    arr.push(v);
    vehiclesByCountry.set(v.country, arr);
  }
  for (const [country, arr] of vehiclesByCountry.entries()) {
    const sorted = arr
      .map((v) => {
        const log = ships
          .filter((s) => s.vehicle_id === v.id)
          .reduce((a, s) => a + Number(s.logistics_cost_usd ?? 0), 0);
        const pallets = Number(v.total_pallets ?? 0);
        const perPal = pallets > 0 ? log / pallets : 0;
        return { v, perPal };
      })
      .filter((x) => x.perPal > 0)
      .sort((a, b) => new Date(a.v.created_at).getTime() - new Date(b.v.created_at).getTime());
    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i];
      const prev = sorted[i - 1];
      if (cur.perPal >= prev.perPal * 1.3) {
        out.push({
          id: `b1-${cur.v.id}`,
          level: "blue",
          code: "TRANSPORT_SPIKE",
          title: "Скачок ціни транспорту",
          detail: `${country}: ${cur.perPal.toFixed(1)}$/п vs попереднє ${prev.perPal.toFixed(1)}$/п (+${Math.round(((cur.perPal - prev.perPal) / prev.perPal) * 100)}%)`,
          context: "Авто",
        });
      }
    }
  }

  // 2. Purchase price spike vs avg over last 7 days for product+country
  const itemsFlat: Array<{ product: string; country: string; price: number; date: string; ship: any }> = [];
  for (const s of ships) {
    for (const it of s.shipment_items ?? []) {
      const product = (it.product_name || "").trim();
      if (!product) continue;
      const price = Number(it.unit_price_usd ?? 0);
      if (price <= 0) continue;
      const country = it.origin_country || s.country || "";
      itemsFlat.push({ product, country, price, date: it.created_at, ship: s });
    }
  }
  for (const it of itemsFlat) {
    if (it.date < since7) continue;
    const peers = itemsFlat.filter(
      (p) =>
        p.product === it.product &&
        p.country === it.country &&
        p.date >= isoDaysAgo(14) &&
        p.date < it.date,
    );
    if (peers.length === 0) continue;
    const avg = peers.reduce((a, b) => a + b.price, 0) / peers.length;
    if (it.price >= avg * 1.3) {
      out.push({
        id: `b2-${it.ship.id}-${it.product}`,
        level: "blue",
        code: "PURCHASE_SPIKE",
        title: "Скачок закупівельної ціни",
        detail: `${it.product} (${it.country}) · ${it.price.toFixed(2)}$ vs середнє ${avg.toFixed(2)}$ (+${Math.round(((it.price - avg) / avg) * 100)}%)`,
        context: `${it.ship.code} · ${mgrName(shipMgr(it.ship))}`,
      });
    }
  }

  // 3. Low branch price approved (≥3 requests, lowest accepted, ≥2 higher rejected)
  const reqByItem = new Map<string, typeof brReq>();
  for (const r of brReq) {
    if (!r.shipment_item_id) continue;
    const arr = reqByItem.get(r.shipment_item_id) ?? [];
    arr.push(r);
    reqByItem.set(r.shipment_item_id, arr);
  }
  for (const [itemId, reqs] of reqByItem.entries()) {
    if (reqs.length < 3) continue;
    const accepted = reqs.find((r) => r.status === "approved");
    if (!accepted || !accepted.sale_price) continue;
    const higherRejected = reqs.filter(
      (r) => r.status === "rejected" && (r.sale_price ?? 0) > (accepted.sale_price ?? 0),
    );
    if (higherRejected.length < 2) continue;
    const minPrice = Math.min(...reqs.map((r) => Number(r.sale_price ?? Infinity)));
    if (Number(accepted.sale_price) > minPrice) continue;
    // find product
    let product = "—";
    for (const s of ships) {
      const it = (s.shipment_items ?? []).find((i: any) => i.id === itemId);
      if (it) {
        product = it.product_name;
        break;
      }
    }
    out.push({
      id: `b3-${itemId}`,
      level: "blue",
      code: "LOW_PRICE_APPROVED",
      title: "Затверджено низьку ціну",
      detail: `${product} · прийнято ${accepted.sale_price}, відхилено ${higherRejected.length} вищих`,
      context: `Філія: ${branchName(accepted.branch_id)}`,
    });
  }

  return out;
}
