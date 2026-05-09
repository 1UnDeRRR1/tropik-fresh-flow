import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { LoadingPlanDetailDialog, type PlanDetailItem } from "@/components/LoadingPlanDetailDialog";
import { Plus, AlertTriangle, CheckCircle2, Package, MailQuestion } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

import { StatCard, SectionCard, EmptyState } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { countLoadedPallets } from "@/lib/loading-plan";

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
  const qc = useQueryClient();
  const [selectedPlan, setSelectedPlan] = useState<PlanDetailItem | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel("loading-plan-manager")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "loading_plan" },
        () => qc.invalidateQueries({ queryKey: ["dash-manager", user.id] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipment_items" },
        () => qc.invalidateQueries({ queryKey: ["dash-manager", user.id] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, user?.id]);

  const { data } = useQuery({
    enabled: !!user?.id,
    queryKey: ["dash-manager", user?.id],
    queryFn: async () => {
      const isoToday = new Date().toISOString().slice(0, 10);
      const iso24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

      const [shipsRes, requestsRes, planRes, allLoadedRes] = await Promise.all([
        supabase
          .from("shipments")
          .select("id,code,eta,status,country,created_by,shipment_items(id,product_name,caliber,pallet_count),distributions(distribution_items(pallets))")
          .eq("created_by", user!.id)
          .order("created_at", { ascending: false })
          .limit(200),
        supabase.from("branch_requests").select("id").eq("status", "pending"),
        supabase
          .from("loading_plan")
          .select("id,product_name,caliber,country,planned_pallets,count_existing,created_at")
          .eq("is_active", true)
          .order("created_at", { ascending: false }),
        supabase.from("shipment_items").select("product_name,origin_country,pallet_count,created_at,shipments(country,created_at)"),
      ]);

      const ships = (shipsRes.data ?? []) as ShipRow[];
      const plan = (planRes.data ?? []) as PlanRow[];
      const allLoaded = (allLoadedRes.data ?? []) as Array<{
        product_name: string;
        origin_country: string | null;
        pallet_count: number | null;
        created_at: string | null;
        shipments: { country: string | null; created_at: string | null } | null;
      }>;

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
        const done = countLoadedPallets(p, allLoaded);
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
        requests: requestsRes.data?.length ?? 0,
        plan: planWithRemaining,
      };
    },
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

        <StatCard
          label="Не розподілено"
          value={`${data?.notDist.ships ?? 0}(${data?.notDist.pallets ?? 0}п)`}
          hint="Очікують розподілу"
          icon={<Package className="h-4 w-4" />}
          tone="warning"
          to="/distribution"
          hash="not"
        />

        <StatCard
          label="Заявки філій"
          value={data?.requests ?? 0}
          hint="Запити від філій"
          icon={<MailQuestion className="h-4 w-4" />}
          tone="primary"
          to="/branch-requests"
        />
      </div>

      <SectionCard title="План завантажень">
        {!data?.plan?.length ? (
          <EmptyState title="План порожній" hint="Адміністратор ще не додав позиції плану" />
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

      <LoadingPlanDetailDialog
        plan={selectedPlan}
        open={!!selectedPlan}
        onOpenChange={(o) => !o && setSelectedPlan(null)}
      />
    </div>
  );
}

