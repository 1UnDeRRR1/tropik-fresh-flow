import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { LoadingPlanDetailDialog, type PlanDetailItem } from "@/components/LoadingPlanDetailDialog";
import { Plus, AlertTriangle, CheckCircle2, ChevronRight, MailQuestion, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

import { StatCard, SectionCard, EmptyState } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CostPair } from "@/components/CostPair";
import { useAuth } from "@/lib/auth";
import { useStableQueryData } from "@/lib/query-stability";
import { toUaCountry } from "@/lib/countries";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useBranchPendingResponses } from "@/components/BranchPendingResponsesSheet";
import { useRealtimeInvalidate } from "@/hooks/useRealtimeInvalidate";
import { toast } from "sonner";

interface ActiveOverviewRow {
  shipment_id: string;
  shipment_code: string | null;
  status: string;
  eta: string | null;
  manager_id: string | null;
  manager_name: string | null;
  product_name: string;
  caliber: string | null;
  country: string | null;
  pallet_count: number;
  pallet_weight: number;
  final_cost_indicative: number | null;
  final_cost_invoice: number | null;
  shipment_item_id: string | null;
}


export const Route = createFileRoute("/_authenticated/dashboard/manager")({
  component: ManagerDashboard,
});

interface ShipRow {
  id: string;
  code: string;
  eta: string | null;
  status: string;
  country: string | null;
  created_by: string | null;
  shipment_items: { id: string; product_name: string; caliber: string | null; pallet_count: number | null }[];
  distributions: { distribution_items: { pallets: number | null }[] | null }[];
}

interface PlanRow {
  id: string;
  product_name: string;
  caliber: string | null;
  country: string | null;
  planned_pallets: number;
  count_existing: boolean;
  created_at: string;
}

function ManagerDashboard() {
  const { user } = useAuth();
  
  const navigate = useNavigate();
  const [selectedPlan, setSelectedPlan] = useState<PlanDetailItem | null>(null);
  const pendingQuery = useBranchPendingResponses();
  const pending = pendingQuery.data;

  // Single debounced realtime subscription for the manager dashboard.
  // Replaces three previous raw channels (loading-plan-manager,
  // active-overview, dash-manager-offers-requests) that all invalidated the
  // broad ["dash-manager"] prefix without debounce — that caused refetch
  // storms (multiple repeated spinners) during bursts of writes.
  // Now: one channel, 300ms debounce (via useRealtimeInvalidate), narrow
  // query keys only.
  useRealtimeInvalidate(
    `dash-manager-${user?.id ?? "none"}`,
    [
      "loading_plan",
      "shipment_items",
      "shipments",
      "manager_offers",
      "manager_offer_responses",
      "manager_offer_allocation_parts",
      "branch_requests",
      "distributions",
      "distribution_items",
    ],
    [
      ["dash-manager", user?.id],
      ["dash-manager", "active-overview"],
      ["dash-manager", "branch-pending-responses", user?.id],
    ],
    !!user?.id,
  );

  const activeQuery = useQuery({
    queryKey: ["dash-manager", "active-overview"],
    queryFn: async () => {
      const { data } = await supabase.rpc("active_shipments_overview");
      return (data ?? []) as ActiveOverviewRow[];
    },
    refetchInterval: 60_000,
  });


  const summaryQuery = useQuery({
    enabled: !!user?.id,
    queryKey: ["dash-manager", user?.id],
    queryFn: async () => {
      const isoToday = new Date().toISOString().slice(0, 10);
      const iso24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const [shipsRes, requestsRes, planRes, loadedTotalsRes] = await Promise.all([
        supabase
          .from("shipments")
          .select("id,code,eta,status,country,created_by,import_manager_id,shipment_items(id,product_name,caliber,pallet_count),distributions(distribution_items(pallets))")
          .eq("created_by", user!.id)
          .order("created_at", { ascending: false })
          .limit(200),
        // Pending branch_requests scoped to THIS manager's shipments
        // (responsible manager = shipments.import_manager_id, fallback created_by for legacy).
        supabase
          .from("branch_requests")
          .select("id,shipment_id,shipments!inner(import_manager_id,created_by)")
          .eq("status", "pending"),
        supabase
          .from("loading_plan")
          .select("id,product_name,caliber,country,planned_pallets,count_existing,created_at")
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
        supabase.rpc("loading_plan_loaded_totals"),
      ]);

      const ships = (shipsRes.data ?? []) as ShipRow[];
      const plan = (planRes.data ?? []) as PlanRow[];
      const loadedTotals = new Map<string, number>(
        ((loadedTotalsRes.data ?? []) as Array<{ plan_id: string; loaded: number }>).map((r) => [
          r.plan_id,
          Number(r.loaded ?? 0),
        ]),
      );

      const stats = ships.map((s) => {
        const planned = (s.shipment_items ?? []).reduce((a, i) => a + Number(i.pallet_count ?? 0), 0);
        const distributed = (s.distributions ?? []).reduce(
          (a, d) => a + (d.distribution_items ?? []).reduce((aa, di) => aa + Number(di.pallets ?? 0), 0),
          0,
        );
        return { s, planned, distributed, undistributed: Math.max(0, planned - distributed) };
      });

      const urgent = stats.filter(
        (x) => x.s.eta && x.s.eta >= isoToday && x.s.eta <= iso24h && x.undistributed > 0 && !["cancelled"].includes(x.s.status),
      );
      const distributed = stats.filter((x) => x.distributed > 0);
      const notDist = stats.filter(
        (x) => x.undistributed > 0 && (!x.s.eta || x.s.eta > iso24h) && !["cancelled"].includes(x.s.status),
      );

      const planWithRemaining = plan.map((p) => {
        const done = loadedTotals.get(p.id) ?? 0;
        return { ...p, loaded: done, remaining: Number(p.planned_pallets) - done };
      });

      const toItem = (x: typeof stats[number]) => ({
        id: x.s.id,
        code: x.s.code,
        eta: x.s.eta,
        country: x.s.country,
        planned: x.planned,
        distributed: x.distributed,
        remaining: x.undistributed,
      });

      return {
        urgent: { ships: urgent.length, pallets: urgent.reduce((a, x) => a + x.undistributed, 0), list: urgent.map(toItem) },
        distributed: { ships: distributed.length, pallets: distributed.reduce((a, x) => a + x.distributed, 0), list: distributed.map(toItem) },
        notDist: { ships: notDist.length, pallets: notDist.reduce((a, x) => a + x.undistributed, 0), list: notDist.map(toItem) },
        requests: ((requestsRes.data ?? []) as Array<{ shipments?: { import_manager_id?: string | null; created_by?: string | null } | null }>)
          .filter((r) => {
            const sh = r.shipments;
            if (!sh) return false;
            const responsible = sh.import_manager_id ?? sh.created_by ?? null;
            return responsible === user!.id;
          }).length,
        plan: planWithRemaining,
      };
    },
  });
  const { data: active } = useStableQueryData({
    data: activeQuery.data,
    isSuccess: activeQuery.isSuccess,
    isFetching: activeQuery.isFetching,
    isError: activeQuery.isError,
    module: "manager-active-overview",
    countRows: (rows) => rows.length,
  });
  const { data } = useStableQueryData({
    data: summaryQuery.data,
    isSuccess: summaryQuery.isSuccess,
    isFetching: summaryQuery.isFetching,
    isError: summaryQuery.isError,
    module: "manager-dashboard-summary",
    countRows: (value) => (value.plan?.length ?? 0) + (value.urgent?.list?.length ?? 0) + (value.notDist?.list?.length ?? 0) + (value.distributed?.list?.length ?? 0),
  });

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <Link to="/shipments/new">
          <Button size="sm" className="bg-brand text-brand-foreground hover:bg-brand/90">
            <Plus className="mr-1 h-4 w-4" /> Нова поставка
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4 [&>a]:block [&>a>div]:h-full [&>div]:h-full">
        <StatCard
          label="24Г не розподілено"
          value={`${data?.urgent.ships ?? 0}(${data?.urgent.pallets ?? 0}п)`}
          hint={(data?.urgent.ships ?? 0) > 0 ? "Терміново розподілити" : "Все під контролем"}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone="danger"
          pulse={(data?.urgent.ships ?? 0) > 0}
          to="/distribution"
          hash="urgent"
        />

        <Link to="/distribution" hash="done" className="block h-full">
          <div className="h-full rounded-2xl border border-transparent bg-emerald-500 p-4 text-white shadow-card transition active:scale-[0.98]">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide opacity-90">Розподілено</span>
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="mt-2 text-2xl font-black tracking-tight">
              {`${data?.distributed.ships ?? 0}(${data?.distributed.pallets ?? 0}п)`}
            </div>
            <div className="mt-1 text-xs opacity-80">Розподілені палети</div>
          </div>
        </Link>

        <button
          type="button"
          onClick={() => navigate({ to: "/manager-offers", search: { mode: "branchRequests" } as never })}
          className="block h-full text-left"
        >
          <div className="h-full rounded-2xl border border-transparent bg-primary p-4 text-primary-foreground shadow-card transition-transform duration-150 active:scale-[0.9]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold uppercase tracking-wide opacity-90">Заявки філій</span>
              <MailQuestion className="h-4 w-4" />
            </div>
            {(pending?.pallets ?? 0) > 0 ? (
              <>
                <div className="mt-2 text-xs opacity-90">
                  {pending!.branches} філій · {pending!.positions} позицій
                </div>
                <div className="text-2xl font-black tracking-tight">{pending!.pallets}п</div>
                <div className="mt-1 text-xs opacity-80">Очікують підтвердження</div>
              </>
            ) : (
              <>
                <div className="mt-2 text-2xl font-black tracking-tight">0</div>
                <div className="mt-1 text-xs opacity-80">Очікують підтвердження</div>
              </>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={() => toast("Потреби філій ще не додані")}
          className="block h-full text-left"
        >
          <div className="h-full rounded-2xl border border-dashed border-border bg-muted/40 p-4 shadow-card transition-transform duration-150 active:scale-[0.9]">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold uppercase tracking-wide text-foreground">Потреби філій</span>
              <Sparkles className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-2 text-2xl font-black tracking-tight text-foreground">0</div>
            <div className="mt-1 text-xs text-muted-foreground">Скоро</div>
          </div>
        </button>
      </div>

      <Tabs defaultValue="plan" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="plan">План завантаження</TabsTrigger>
          <TabsTrigger value="active">Активні поставки</TabsTrigger>
        </TabsList>

        <TabsContent value="plan">
          <SectionCard title="План завантажень">
            {!data?.plan?.length ? (
              summaryQuery.isFetching || !summaryQuery.isSuccess ? (
                <p className="text-sm text-muted-foreground">Оновлення даних…</p>
              ) : (
              <EmptyState title="План порожній" hint="Адміністратор ще не додав позиції плану" />
              )
            ) : (
              <ul className="divide-y divide-border">
                {data.plan.map((p) => {
                  const done = p.remaining <= 0;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setSelectedPlan({
                            id: p.id,
                            product_name: p.product_name,
                            country: p.country,
                            caliber: p.caliber,
                            planned_pallets: Number(p.planned_pallets),
                            count_existing: p.count_existing,
                            created_at: p.created_at,
                          })
                        }
                        className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition active:scale-[0.99]"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">
                            {p.product_name}
                            {p.caliber ? ` ${p.caliber}` : ""}
                            {p.country ? ` · ${p.country}` : ""}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            план {Number(p.planned_pallets)}п · завантажено {p.loaded}п
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                            done ? "bg-emerald-500/15 text-emerald-600" : "bg-brand/15 text-brand"
                          }`}
                        >
                          {done ? "0п" : `${p.remaining}п`}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </TabsContent>

        <TabsContent value="active">
          <SectionCard title="Активні поставки">
            <p className="-mt-1 mb-2 text-[11px] text-muted-foreground">
              Товар · країна · палети. Зникає в день заходу поставки.
            </p>
             {(!active?.length && (activeQuery.isFetching || !activeQuery.isSuccess)) ? <p className="text-sm text-muted-foreground">Оновлення даних…</p> : <ActiveOverviewList rows={active ?? []} />}
          </SectionCard>
        </TabsContent>
      </Tabs>

      <LoadingPlanDetailDialog
        plan={selectedPlan}
        open={!!selectedPlan}
        onOpenChange={(o) => !o && setSelectedPlan(null)}
      />

    </div>
  );
}

type ProductGroup = {
  key: string;
  product: string;
  country: string;
  pallets: number;
  shipmentCount: number;
  rows: ActiveOverviewRow[];
};

function ActiveOverviewList({ rows }: { rows: ActiveOverviewRow[] }) {
  const [openGroup, setOpenGroup] = useState<ProductGroup | null>(null);
  const [fManager, setFManager] = useState<string>("__all__");
  const [fProduct, setFProduct] = useState<string>("__all__");
  const [fCountry, setFCountry] = useState<string>("__all__");

  const managerOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.manager_name && set.add(r.manager_name));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk")).map((v) => ({ value: v, label: v }));
  }, [rows]);
  const productOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.product_name && set.add(r.product_name));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk")).map((v) => ({ value: v, label: v }));
  }, [rows]);
  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.country && set.add(r.country));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk")).map((v) => ({ value: v, label: toUaCountry(v) }));
  }, [rows]);

  const filteredRows = useMemo(
    () =>
      rows.filter((r) => {
        if (fManager !== "__all__" && r.manager_name !== fManager) return false;
        if (fProduct !== "__all__" && r.product_name !== fProduct) return false;
        if (fCountry !== "__all__" && r.country !== fCountry) return false;
        return true;
      }),
    [rows, fManager, fProduct, fCountry],
  );
  const filtersActive = fManager !== "__all__" || fProduct !== "__all__" || fCountry !== "__all__";
  const resetFilters = () => {
    setFManager("__all__");
    setFProduct("__all__");
    setFCountry("__all__");
  };

  if (!rows.length) {
    return <EmptyState title="Немає активних поставок" hint="Усі поставки вже прибули або відсутні в роботі" />;
  }

  const groups = new Map<string, ProductGroup>();
  const shipSets = new Map<string, Set<string>>();
  for (const r of filteredRows) {
    const product = (r.product_name || "").trim();
    const country = toUaCountry(r.country);
    const key = `${product}__${country}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, product, country, pallets: 0, shipmentCount: 0, rows: [] };
      groups.set(key, g);
    }
    g.pallets += Number(r.pallet_count) || 0;
    g.rows.push(r);
    const s = shipSets.get(key) ?? new Set<string>();
    s.add(r.shipment_id);
    shipSets.set(key, s);
  }
  for (const [k, g] of groups) g.shipmentCount = shipSets.get(k)?.size ?? 0;

  const list = Array.from(groups.values()).sort(
    (a, b) => a.product.localeCompare(b.product, "uk") || a.country.localeCompare(b.country, "uk"),
  );

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button
          type="button"
          variant={filtersActive ? "outline" : "default"}
          size="sm"
          className="h-9 text-xs"
          onClick={resetFilters}
        >
          Усі поставки
        </Button>
        <SearchableSelect
          value={fManager}
          onChange={setFManager}
          options={managerOptions}
          placeholder="Менеджер"
          allLabel="Усі менеджери"
        />
        <SearchableSelect
          value={fProduct}
          onChange={setFProduct}
          options={productOptions}
          placeholder="Товар"
          allLabel="Усі товари"
        />
        <SearchableSelect
          value={fCountry}
          onChange={setFCountry}
          options={countryOptions}
          placeholder="Країна"
          allLabel="Усі країни"
        />
      </div>
      {!list.length ? (
        <EmptyState title="Немає товару за обраними фільтрами" />
      ) : (
      <ul className="divide-y divide-border">
        {list.map((g) => (
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
                <div className="text-[11px] text-muted-foreground">{g.shipmentCount} пост.</div>
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
              {openGroup.rows
                .slice()
                .sort((a, b) => (a.eta ?? "9999").localeCompare(b.eta ?? "9999"))
                .map((r) => (
                  <li key={r.shipment_item_id ?? `${r.shipment_id}-${r.product_name}`} className="py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate text-info">
                          ETA {r.eta ?? "—"}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {r.shipment_code ?? "—"}
                          {r.caliber ? <span> · {r.caliber}</span> : null}
                          {" · "}{r.manager_name ?? "—"}
                        </div>
                        <div className="mt-1">
                          <CostPair
                            indicative={r.final_cost_indicative}
                            invoice={r.final_cost_invoice}
                            suffix="/кг"
                          />
                        </div>
                      </div>
                      <div className="shrink-0 rounded-full bg-brand/15 px-2.5 py-0.5 text-xs font-bold text-brand">
                        {Number(r.pallet_count) || 0}п
                      </div>
                    </div>
                  </li>
                ))}
            </ul>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

