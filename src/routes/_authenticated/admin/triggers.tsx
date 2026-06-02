import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AlertOctagon, AlertTriangle, ChevronRight, ExternalLink, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { useAuth } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin/triggers")({
  component: TriggersPage,
});

type Level = "red" | "yellow" | "blue";
type LinkTarget = {
  to: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
};
type Emphasis = "critical" | "warn" | "info" | "muted";
type Highlight = {
  label: string;
  value: string;
  emphasis?: Emphasis;
};
type Trigger = {
  id: string;
  level: Level;
  code: string;
  title: string;
  detail: string;
  context?: string;
  link?: LinkTarget;
  reason: string;
  highlights: Highlight[];
};

const DAY = 24 * 60 * 60 * 1000;

function daysBetween(a: string | null | undefined, b: Date) {
  if (!a) return Infinity;
  return (new Date(a).getTime() - b.getTime()) / DAY;
}

function emphasisCls(e: Emphasis | undefined) {
  switch (e) {
    case "critical":
      return "bg-destructive/10 text-destructive border-destructive/30";
    case "warn":
      return "bg-warning/15 text-[oklch(0.55_0.18_75)] border-warning/40";
    case "info":
      return "bg-info/10 text-info border-info/30";
    default:
      return "bg-muted text-foreground border-border";
  }
}

function levelHeaderCls(level: Level) {
  if (level === "red") return "border-l-4 border-destructive bg-destructive/5";
  if (level === "yellow") return "border-l-4 border-warning bg-warning/5";
  return "border-l-4 border-info bg-info/5";
}

function levelTitleCls(level: Level) {
  if (level === "red") return "text-destructive";
  if (level === "yellow") return "text-[oklch(0.55_0.18_75)]";
  return "text-info";
}

function TriggerSnapshotModal({
  trigger,
  open,
  onClose,
}: {
  trigger: Trigger | null;
  open: boolean;
  onClose: () => void;
}) {
  if (!trigger) return null;
  const Icon = trigger.level === "red" ? AlertOctagon : trigger.level === "yellow" ? AlertTriangle : Info;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <div className={cn("p-4", levelHeaderCls(trigger.level))}>
          <DialogHeader className="space-y-1.5 text-left">
            <DialogTitle className={cn("flex items-center gap-2 text-base font-bold", levelTitleCls(trigger.level))}>
              <Icon className="h-5 w-5 shrink-0" />
              <span>{trigger.title}</span>
            </DialogTitle>
            <DialogDescription className="text-xs uppercase tracking-wide text-muted-foreground">
              {trigger.code}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Причина
            </div>
            <div className="mt-1 text-sm">{trigger.reason}</div>
          </div>

          {trigger.highlights.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Ключові значення
              </div>
              <div className="grid grid-cols-2 gap-2">
                {trigger.highlights.map((h, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg border px-2.5 py-2",
                      emphasisCls(h.emphasis),
                    )}
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                      {h.label}
                    </div>
                    <div className="mt-0.5 text-sm font-bold tabular-nums break-words">
                      {h.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {trigger.context && (
            <div className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              {trigger.context}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 border-t bg-card p-3 sm:justify-between">
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Закрити
            </Button>
          </DialogClose>
          {trigger.link && (
            <Button asChild size="sm" onClick={onClose}>
              <Link {...(trigger.link as any)}>
                <ExternalLink className="mr-1.5 h-4 w-4" />
                Відкрити джерело
              </Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TriggersPage() {
  const { hasRole, loading } = useAuth();
  const [tab, setTab] = useState<Level>("red");
  const [active, setActive] = useState<Trigger | null>(null);

  const { data: triggers = [], isLoading } = useQuery({
    queryKey: ["admin", "triggers"],
    queryFn: computeTriggers,
    refetchInterval: 60_000,
  });

  if (loading) return null;
  if (!hasRole("super_admin")) return <Navigate to="/dashboard/admin" />;

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
          const isActive = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-xl border p-3 text-left transition ${
                isActive ? t.cls : `border-border bg-card text-foreground ${t.hoverCls}`
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
            {list.map((t) => {
              const cls = `w-full text-left rounded-xl border p-3 transition hover:brightness-95 active:scale-[0.99] ${
                t.level === "red"
                  ? "border-destructive/30 bg-destructive/5"
                  : t.level === "yellow"
                    ? "border-warning/40 bg-warning/5"
                    : "border-info/30 bg-info/5"
              }`;
              return (
                <li key={t.id}>
                  <button type="button" onClick={() => setActive(t)} className={cls}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-bold">{t.title}</div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{t.detail}</div>
                    {t.context && (
                      <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        {t.context}
                      </div>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <TriggerSnapshotModal trigger={active} open={!!active} onClose={() => setActive(null)} />
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
          "id,code,eta,arrived_at,status,country,loading_date,vehicle_id,supplier_id,import_manager_id,created_by,created_at,logistics_cost_usd,shipment_items(id,product_name,pallet_count,unit_price_usd,final_cost_indicative,origin_country,created_at)",
        )
        .limit(1000),
      supabase.from("vehicles").select("id,code,country,country_code,loading_date,status,total_pallets,total_weight_kg,created_at"),
      supabase.from("branches").select("id,name,is_active").eq("is_active", true),
      supabase
        .from("branch_requests")
        .select("id,branch_id,shipment_item_id,sale_price,sale_currency,pallets,approved_qty,status,created_at,decision_notes")
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
        link: { to: "/shipments", search: { focus: `v:${v.id}`, level: "red" } },
        reason: "До дати завантаження залишилось ≤24 год, але авто все ще відкрите.",
        highlights: [
          { label: "Авто", value: (v as any).code ?? "—" },
          { label: "Країна", value: v.country ?? "—" },
          { label: "Завантаження", value: v.loading_date ?? "—", emphasis: "critical" },
          { label: "Палет", value: `${Number(v.total_pallets ?? 0)}` },
        ],
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
        link: { to: "/distribution/$shipmentId", params: { shipmentId: s.id }, search: { focus: `ship:${s.id}`, level: "red" } },
        reason: "До прибуття ≤24 год, частина палет ще не розподілена між філіями.",
        highlights: [
          { label: "Поставка", value: s.code },
          { label: "ETA", value: arrival ?? "—" },
          { label: "Не розподілено", value: `${undist} п`, emphasis: "critical" },
          { label: "Заплановано", value: `${planned} п` },
          { label: "Менеджер", value: mgrName(shipMgr(s)) },
        ],
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
        link: { to: "/branch-requests", search: { focus: `branch:${b.id}`, level: "red" } },
        reason: "Філія не подавала заявок з вказаною ціною продажу понад 14 днів.",
        highlights: [
          { label: "Філія", value: b.name, emphasis: "critical" },
          { label: "Період без заявок", value: "≥ 14 днів", emphasis: "critical" },
        ],
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
        link: { to: "/admin/managers", search: { focus: `mgr:${m.id}`, level: "red" } },
        reason: "Менеджер не створював жодної поставки понад 7 днів і не у відпустці.",
        highlights: [
          { label: "Менеджер", value: m.full_name, emphasis: "critical" },
          { label: "Період без поставок", value: "≥ 7 днів", emphasis: "critical" },
        ],
      });
    }
  }

  // ---------- YELLOW ----------

  // 1. Branch missing common position
  const totalBranches = branches.length;
  if (totalBranches > 0) {
    const threshold = Math.ceil(totalBranches * 0.8);
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
          link: { to: "/branch-requests", search: { focus: `branch:${b.id}`, level: "yellow" } },
          reason: `Товар наявний у ≥80% активних філій, але відсутній у «${b.name}».`,
          highlights: [
            { label: "Філія", value: b.name, emphasis: "warn" },
            { label: "Товар", value: product, emphasis: "warn" },
            { label: "Поширеність", value: `${set.size}/${totalBranches} філій` },
          ],
        });
      }
    }
  }

  // 2. Manager has 3+ open vehicles
  const openVehiclesByMgr = new Map<string, number>();
  for (const v of vehicles) {
    if (v.status !== "open") continue;
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
        link: { to: "/shipments", search: { focus: `mgr:${mid}`, level: "yellow" } },
        reason: "У менеджера одночасно ≥3 не закритих авто — ризик розпорошення уваги.",
        highlights: [
          { label: "Менеджер", value: mgrName(mid) },
          { label: "Відкритих авто", value: `${n}`, emphasis: "warn" },
        ],
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
        link: { to: "/distribution/$shipmentId", params: { shipmentId: s.id }, search: { focus: `ship:${s.id}`, level: "yellow" } },
        reason: "До ETA ≤48 год, тривалий transit і ≥50% товару ще не розподілено.",
        highlights: [
          { label: "Поставка", value: s.code },
          { label: "Не розподілено", value: `${Math.round(ratio * 100)}%`, emphasis: "warn" },
          { label: "Transit", value: `${Math.round(transit)} дн.` },
          { label: "ETA", value: arrival },
          { label: "Менеджер", value: mgrName(shipMgr(s)) },
        ],
      });
    }
  }

  // 4. Branch dominates position
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
        const share = Math.round((pal / total) * 100);
        out.push({
          id: `y4-${product}-${bid}`,
          level: "yellow",
          code: "BRANCH_DOMINATES",
          title: "Філія домінує по позиції",
          detail: `${branchName(bid)} тримає ${share}% «${product}»`,
          context: "Філія / Товар",
          link: { to: "/branch-requests", search: { focus: `branch:${bid}`, level: "yellow" } },
          reason: "Одна філія концентрує ≥50% усіх палет товару — дисбаланс розподілу.",
          highlights: [
            { label: "Філія", value: branchName(bid) },
            { label: "Товар", value: product },
            { label: "Частка філії", value: `${share}%`, emphasis: "warn" },
            { label: "Палет філії", value: `${pal}` },
            { label: "Усього палет", value: `${total}` },
          ],
        });
      }
    }
  }

  // ---------- BLUE ----------

  // 1. Transport price spike
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
        const pct = Math.round(((cur.perPal - prev.perPal) / prev.perPal) * 100);
        out.push({
          id: `b1-${cur.v.id}`,
          level: "blue",
          code: "TRANSPORT_SPIKE",
          title: "Скачок ціни транспорту",
          detail: `${country}: ${cur.perPal.toFixed(1)}$/п vs попереднє ${prev.perPal.toFixed(1)}$/п (+${pct}%)`,
          context: "Авто",
          link: { to: "/shipments", search: { focus: `v:${cur.v.id}`, level: "blue" } },
          reason: "Ціна транспорту за палету для цієї країни зросла ≥30% порівняно з попереднім авто.",
          highlights: [
            { label: "Країна", value: country },
            { label: "Авто", value: cur.v.code ?? "—" },
            { label: "Транспорт зараз", value: `${cur.perPal.toFixed(1)} $/п`, emphasis: "info" },
            { label: "Попереднє авто", value: `${prev.perPal.toFixed(1)} $/п` },
            { label: "Зміна", value: `+${pct}%`, emphasis: "info" },
          ],
        });
      }
    }
  }

  // 2. Purchase price spike
  const itemsFlat: Array<{ itemId: string; product: string; country: string; price: number; date: string; ship: any }> = [];
  for (const s of ships) {
    for (const it of s.shipment_items ?? []) {
      const product = (it.product_name || "").trim();
      if (!product) continue;
      const price = Number(it.unit_price_usd ?? 0);
      if (price <= 0) continue;
      const country = it.origin_country || s.country || "";
      itemsFlat.push({ itemId: it.id, product, country, price, date: it.created_at, ship: s });
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
      const pct = Math.round(((it.price - avg) / avg) * 100);
      out.push({
        id: `b2-${it.ship.id}-${it.product}`,
        level: "blue",
        code: "PURCHASE_SPIKE",
        title: "Скачок закупівельної ціни",
        detail: `${it.product} (${it.country}) · ${it.price.toFixed(2)}$ vs середнє ${avg.toFixed(2)}$ (+${pct}%)`,
        context: `${it.ship.code} · ${mgrName(shipMgr(it.ship))}`,
        link: { to: "/shipments/$id", params: { id: it.ship.id }, search: { focus: `item:${it.itemId}`, level: "blue" } },
        reason: "Закупівельна ціна позиції ≥30% вища за середню по країні за останні 14 днів.",
        highlights: [
          { label: "Товар", value: it.product },
          { label: "Країна", value: it.country || "—" },
          { label: "Ціна зараз", value: `${it.price.toFixed(2)} $/кг`, emphasis: "info" },
          { label: "Середня (14 дн.)", value: `${avg.toFixed(2)} $/кг` },
          { label: "Зміна", value: `+${pct}%`, emphasis: "info" },
          { label: "Поставка", value: it.ship.code },
          { label: "Менеджер", value: mgrName(shipMgr(it.ship)) },
        ],
      });
    }
  }

  // 3. Low branch price approved
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
      link: { to: "/branch-requests", search: { focus: `req:${accepted.id}`, level: "blue" } },
      reason: "Затверджено найнижчу заявку при наявності ≥2 відхилених з вищою ціною.",
      highlights: [
        { label: "Товар", value: product },
        { label: "Філія", value: branchName(accepted.branch_id) },
        { label: "Прийнята ціна", value: `${accepted.sale_price} ${(accepted.sale_currency || "UAH").toUpperCase()}`, emphasis: "info" },
        { label: "Відхилено вищих", value: `${higherRejected.length}`, emphasis: "info" },
        { label: "Усього заявок", value: `${reqs.length}` },
      ],
    });
  }

  // ---------- LOSS-MAKING APPROVED PRICE ----------
  const UAH_PER_USD = 43.5;
  const toUsdPerKg = (price: number, currency: string | null | undefined) => {
    const c = (currency || "UAH").toUpperCase();
    if (c === "USD") return price;
    if (c === "EUR") return price * 1.08;
    return price / UAH_PER_USD;
  };
  for (const r of brReq) {
    if (r.status !== "approved") continue;
    if (!r.shipment_item_id) continue;
    const palletsApproved = Number(r.pallets ?? 0) || Number(r.approved_qty ?? 0);
    if (palletsApproved < 1) continue;
    const salePrice = Number(r.sale_price ?? 0);
    if (salePrice <= 0) continue;
    let item: any = null;
    let ship: any = null;
    for (const s of ships) {
      const it = (s.shipment_items ?? []).find((i: any) => i.id === r.shipment_item_id);
      if (it) { item = it; ship = s; break; }
    }
    if (!item) continue;
    const indicative = Number(item.final_cost_indicative ?? 0);
    if (indicative <= 0) continue;
    const saleUsd = toUsdPerKg(salePrice, r.sale_currency);
    const diffPct = ((indicative - saleUsd) / indicative) * 100;
    if (diffPct < 10) continue;
    const level: Level = diffPct >= 20 ? "red" : "blue";
    const emph: Emphasis = level === "red" ? "critical" : "info";
    out.push({
      id: `lp-${r.id}`,
      level,
      code: level === "red" ? "APPROVED_PRICE_CRITICAL_LOSS" : "APPROVED_PRICE_LOSS",
      title: level === "red" ? "Збиткова ціна затверджена (критично)" : "Збиткова ціна затверджена",
      detail: `${item.product_name} · ${branchName(r.branch_id)} · ${palletsApproved}п · ${salePrice} ${(r.sale_currency || "UAH").toUpperCase()} (${saleUsd.toFixed(3)}$/кг) vs індикативна ${indicative.toFixed(3)}$/кг (-${Math.round(diffPct)}%)`,
      context: `Менеджер: ${mgrName(shipMgr(ship))}`,
      link: { to: "/branch-requests", search: { focus: `req:${r.id}`, level } },
      reason: `Менеджер затвердив ${palletsApproved} п. за ціною, що на ${Math.round(diffPct)}% нижча за індикативну собівартість.`,
      highlights: [
        { label: "Товар", value: item.product_name },
        { label: "Філія", value: branchName(r.branch_id) },
        { label: "Палет затверджено", value: `${palletsApproved}` },
        { label: "Ціна продажу", value: `${salePrice} ${(r.sale_currency || "UAH").toUpperCase()}`, emphasis: emph },
        { label: "У USD/кг", value: `${saleUsd.toFixed(3)} $`, emphasis: emph },
        { label: "Індикативна с/в", value: `${indicative.toFixed(3)} $/кг` },
        { label: "Різниця", value: `−${Math.round(diffPct)}%`, emphasis: emph },
        { label: "Менеджер", value: mgrName(shipMgr(ship)) },
      ],
    });
  }

  return out;
}
