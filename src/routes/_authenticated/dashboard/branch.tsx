import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { toUaCountry } from "@/lib/countries";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CostPair } from "@/components/CostPair";
import { OfferDialog } from "@/components/OfferDialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { PipelineStatusBadge } from "@/components/PipelineStatusBadge";
import { TableScroller } from "@/components/TableScroller";
import type { PipelineStatus } from "@/lib/pipeline-status";
import { MainBoardToggle, type BoardView } from "@/components/MainBoardToggle";
import { SearchableSelect } from "@/components/SearchableSelect";
import { useFirstScreenGate } from "@/routes/_authenticated";

export const Route = createFileRoute("/_authenticated/dashboard/branch")({
  component: BranchDashboard,
});

type Row = {
  key: string;
  shipment_item_id: string;
  distribution_id: string;
  code: string;
  eta: string | null;
  pipeline: PipelineStatus;
  dist_status: string;
  approved_qty_note: string | null;
  product: string;
  country: string | null;
  caliber: string | null;
  variety: string | null;
  brand: string | null;
  class: string | null;
  packaging: string | null;
  supplier_name: string | null;
  temperature_mode: string | null;
  manager_name: string | null;
  pallets: number;
  weight: number;
  indicative: number | null;
  invoice: number | null;
  bvp_ind: number | null;
  bvp_inv: number | null;
  bvp_reason: string | null;
  baseline_eta: string | null;
  baseline_pallets: number | null;
  baseline_ind: number | null;
  baseline_inv: number | null;
  seen_eta: string | null;
  seen_pallets: number | null;
  seen_ind: number | null;
  seen_inv: number | null;
};

const fmtEta = (eta: string | null) =>
  eta ? new Date(eta).toLocaleDateString("uk-UA", { day: "2-digit", month: "long" }) : "—";

const numNeq = (a: number | null | undefined, b: number | null | undefined) =>
  Number(a ?? 0).toFixed(2) !== Number(b ?? 0).toFixed(2);
const dateNeq = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "") !== (b ?? "");

function ChangeBadge({
  field,
  oldVal,
  newVal,
  onAck,
}: {
  field: "ETA" | "Палети" | "Собівартість";
  oldVal: string;
  newVal: string;
  onAck: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) onAck();
      }}
    >
      <PopoverTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-yellow-100 px-1.5 py-0.5 text-[9px] font-semibold text-yellow-900 dark:bg-yellow-500/20 dark:text-yellow-200"
          aria-label="Зміни"
        >
          <AlertTriangle className="h-2.5 w-2.5" />
          зміни
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3 text-xs" align="end" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 font-semibold">{field}</div>
        <div className="text-muted-foreground">
          Було: <span className="font-medium text-foreground">{oldVal}</span>
        </div>
        <div className="text-muted-foreground">
          Стало: <span className="font-medium text-foreground">{newVal}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function DescriptionPopover({ row, children }: { row: Row; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button onClick={(e) => e.stopPropagation()} className="text-left">
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 text-xs" align="start" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 font-semibold text-sm">{row.product}</div>
        <dl className="grid grid-cols-[80px_1fr] gap-y-1 text-[11px]">
          {row.brand && (<><dt className="text-muted-foreground">Бренд</dt><dd>{row.brand}</dd></>)}
          {row.class && (<><dt className="text-muted-foreground">Клас</dt><dd>{row.class}</dd></>)}
          {row.variety && (<><dt className="text-muted-foreground">Сорт</dt><dd>{row.variety}</dd></>)}
          {row.caliber && (<><dt className="text-muted-foreground">Калібр</dt><dd>{row.caliber}</dd></>)}
          {row.packaging && (<><dt className="text-muted-foreground">Упаковка</dt><dd>{row.packaging}</dd></>)}
          {row.supplier_name && (<><dt className="text-muted-foreground">Постачальник</dt><dd>{row.supplier_name}</dd></>)}
          {row.temperature_mode && (<><dt className="text-muted-foreground">Темп. режим</dt><dd>{row.temperature_mode}</dd></>)}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

function BranchDashboard() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const branchId = profile?.branch_id;
  const [drill, setDrill] = useState<{ key: string; product: string; country: string | null } | null>(null);
  const [offerRow, setOfferRow] = useState<Row | null>(null);
  const [board, setBoard] = useState<BoardView>("active");
  const [fManager, setFManager] = useState<string>("__all__");
  const [fProduct, setFProduct] = useState<string>("__all__");
  const [fCountry, setFCountry] = useState<string>("__all__");

  const { data: dists, isPending: distsPending, isError: distsError } = useQuery({
    queryKey: ["branch-incoming-dists", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributions")
        .select(`id,status,shipment_id,distribution_items(pallets,qty,shipment_item_id,reserved_offer_id)`)
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; status: string; shipment_id: string;
        distribution_items: Array<{ pallets: number | null; qty: number | null; shipment_item_id: string | null; reserved_offer_id: string | null }> | null;
      }>;
    },
  });

  // Hold the splash overlay until this dashboard's first data query resolves,
  // so the user never sees the half-loaded shell or a false empty-state.
  useFirstScreenGate(
    "branch-dashboard",
    !!branchId && (distsPending || (dists === undefined && !distsError)),
  );

  // All manager-offer responses for this branch (any decision state).
  // approved_pallets IS NULL → "Чекаю підтвердження";
  // approved_pallets = 0    → "Відмовлено" (only explicit manager rejection);
  // approved_pallets > 0    → "В опрацюванні" (until linked to shipment).
  const { data: pendingOffers } = useQuery({
    queryKey: ["branch-all-mor", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("manager_offer_responses")
        .select(`id,offer_id,approved_pallets,requested_pallets,
          manager_offers!inner(id,product_name,origin_country,caliber,variety,expected_eta,indicative_cost_usd,invoice_cost_usd,linked_shipment_id,status,import_manager_id,pallet_weight)`)
        .eq("branch_id", branchId!);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; offer_id: string; approved_pallets: number | null; requested_pallets: number;
        manager_offers: {
          id: string; product_name: string; origin_country: string | null;
          caliber: string | null; variety: string | null; expected_eta: string | null;
          indicative_cost_usd: number | null; invoice_cost_usd: number | null;
          linked_shipment_id: string | null; status: string;
          import_manager_id: string | null; pallet_weight: number | null;
        };
      }>;
    },
  });

  const itemIds = useMemo(
    () => Array.from(new Set((dists ?? []).flatMap((d) => (d.distribution_items ?? []).map((di) => di.shipment_item_id).filter(Boolean) as string[]))),
    [dists],
  );
  const shipmentIds = useMemo(
    () => Array.from(new Set((dists ?? []).map((d) => d.shipment_id).filter(Boolean))),
    [dists],
  );

  const { data: items } = useQuery({
    queryKey: ["branch-incoming-items-v3", itemIds.join(",")],
    enabled: itemIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipment_items")
        .select("id,product_name,caliber,origin_country,variety,brand,class")
        .in("id", itemIds);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; product_name: string; caliber: string | null;
        origin_country: string | null; variety: string | null;
        brand: string | null; class: string | null;
      }>;
    },
  });

  // Patch 8B: branch-visible price source of truth.
  // Source priority for indicative/invoice = BVP -> baseline -> null.
  // Never fall back to shipment_items.final_cost_*.
  const { data: bvps } = useQuery({
    queryKey: ["branch-visible-prices", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("branch_visible_prices")
        .select("distribution_id,shipment_item_id,cost_indicative_usd,cost_invoice_usd,reason,updated_at")
        .eq("branch_id", branchId!);
      if (error) throw error;
      return (data ?? []) as Array<{
        distribution_id: string; shipment_item_id: string;
        cost_indicative_usd: number | null; cost_invoice_usd: number | null;
        reason: string; updated_at: string;
      }>;
    },
  });

  const { data: ships } = useQuery({
    queryKey: ["branch-incoming-ships-v3", shipmentIds.join(",")],
    enabled: shipmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipments")
        .select("id,code,eta,country,unloaded_at,cancelled_at,archived_at,status,pipeline_status,temperature_mode,supplier_id,import_manager_id")
        .in("id", shipmentIds);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; code: string; eta: string | null; country: string | null;
        unloaded_at: string | null; cancelled_at: string | null; archived_at: string | null;
        status: string; pipeline_status: PipelineStatus; temperature_mode: string | null;
        supplier_id: string | null; import_manager_id: string | null;
      }>;
    },
  });

  const supplierIds = useMemo(
    () => Array.from(new Set((ships ?? []).map((s) => s.supplier_id).filter(Boolean) as string[])),
    [ships],
  );
  const managerIds = useMemo(
    () =>
      Array.from(
        new Set([
          ...((ships ?? []).map((s) => s.import_manager_id).filter(Boolean) as string[]),
          ...((pendingOffers ?? []).map((p) => p.manager_offers.import_manager_id).filter(Boolean) as string[]),
        ]),
      ),
    [ships, pendingOffers],
  );

  const { data: suppliers } = useQuery({
    queryKey: ["branch-suppliers", supplierIds.join(",")],
    enabled: supplierIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id,name").in("id", supplierIds);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; name: string }>;
    },
  });

  const { data: managers } = useQuery({
    queryKey: ["branch-managers", managerIds.join(",")],
    enabled: managerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("import_managers").select("id,full_name").in("id", managerIds);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; full_name: string }>;
    },
  });

  const { data: baselines } = useQuery({
    queryKey: ["branch-baselines", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("branch_distribution_baselines")
        .select("distribution_id,shipment_item_id,baseline_eta,baseline_pallets,baseline_cost_ind,baseline_cost_inv,seen_eta,seen_pallets,seen_cost_ind,seen_cost_inv")
        .eq("branch_id", branchId!);
      if (error) throw error;
      return (data ?? []) as Array<{
        distribution_id: string; shipment_item_id: string;
        baseline_eta: string | null; baseline_pallets: number | null;
        baseline_cost_ind: number | null; baseline_cost_inv: number | null;
        seen_eta: string | null; seen_pallets: number | null;
        seen_cost_ind: number | null; seen_cost_inv: number | null;
      }>;
    },
  });

  const { data: outOffers } = useQuery({
    queryKey: ["branch-outgoing-offers", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("branch_transfer_offers")
        .select("shipment_item_id,distribution_id,status,offered_pallets,accepted_pallets")
        .eq("from_branch_id", branchId!);
      if (error) throw error;
      return (data ?? []) as Array<{
        shipment_item_id: string; distribution_id: string; status: string;
        offered_pallets: number; accepted_pallets: number;
      }>;
    },
  });

  const offerStats = useMemo(() => {
    const m = new Map<string, { pending: number; accepted: number }>();
    (outOffers ?? []).forEach((o) => {
      const k = `${o.distribution_id}-${o.shipment_item_id}`;
      const cur = m.get(k) ?? { pending: 0, accepted: 0 };
      if (o.status === "pending") cur.pending += Number(o.offered_pallets || 0);
      if (o.status === "accepted" || o.status === "partially_accepted")
        cur.accepted += Number(o.accepted_pallets || 0);
      m.set(k, cur);
    });
    return m;
  }, [outOffers]);

  const statsFor = (r: { distribution_id: string; shipment_item_id: string; pallets: number }) => {
    const s = offerStats.get(`${r.distribution_id}-${r.shipment_item_id}`) ?? { pending: 0, accepted: 0 };
    const free = Math.max(0, r.pallets - s.pending - s.accepted);
    return { pending: s.pending, accepted: s.accepted, free };
  };

  const rows: Row[] = useMemo(() => {
    if (!dists) return [];
    const iMap = new Map((items ?? []).map((i) => [i.id, i]));
    const sMap = new Map((ships ?? []).map((s) => [s.id, s]));
    const supMap = new Map((suppliers ?? []).map((s) => [s.id, s.name]));
    const mgrMap = new Map((managers ?? []).map((m) => [m.id, m.full_name]));
    const bMap = new Map((baselines ?? []).map((b) => [`${b.distribution_id}-${b.shipment_item_id}`, b]));
    const vMap = new Map((bvps ?? []).map((v) => [`${v.distribution_id}-${v.shipment_item_id}`, v]));

    const materialized: Row[] = dists.flatMap((d) =>
      (d.distribution_items ?? [])
        .map((di) => {
          if (!di.shipment_item_id) return null;
          const it = iMap.get(di.shipment_item_id);
          if (!it) return null;
          const s = sMap.get(d.shipment_id);
          const unloadedShip = s?.pipeline_status === "unloaded" || !!s?.unloaded_at;
          const cancelled = s?.status === "cancelled" || !!s?.cancelled_at;
          const archived = !!s?.archived_at;
          if (archived) return null;
          if (board === "unloaded") {
            if (!unloadedShip || cancelled) return null;
          } else {
            if (unloadedShip || cancelled) return null;
          }
          if (Number(di.pallets ?? 0) <= 0) return null;
          const b = bMap.get(`${d.id}-${it.id}`);
          const v = vMap.get(`${d.id}-${it.id}`);
          // Branch-visible price: BVP -> baseline -> null. Never shipment_items.final_cost_*.
          const displayInd = v?.cost_indicative_usd ?? b?.baseline_cost_ind ?? null;
          const displayInv = v?.cost_invoice_usd ?? b?.baseline_cost_inv ?? null;
          return {
            key: `${d.id}-${it.id}`,
            shipment_item_id: it.id,
            distribution_id: d.id,
            code: s?.code ?? "—",
            eta: s?.eta ?? null,
            pipeline: (s?.pipeline_status ?? "ordered") as PipelineStatus,
            dist_status: d.status,
            approved_qty_note: null,
            product: it.product_name,
            country: it.origin_country ?? s?.country ?? null,
            caliber: it.caliber,
            variety: it.variety,
            brand: it.brand,
            class: it.class,
            packaging: null,
            supplier_name: s?.supplier_id ? supMap.get(s.supplier_id) ?? null : null,
            temperature_mode: s?.temperature_mode ?? null,
            manager_name: s?.import_manager_id ? mgrMap.get(s.import_manager_id) ?? null : null,
            pallets: Number(di.pallets ?? 0),
            weight: Number(di.qty ?? 0),
            indicative: displayInd,
            invoice: displayInv,
            bvp_ind: v?.cost_indicative_usd ?? null,
            bvp_inv: v?.cost_invoice_usd ?? null,
            bvp_reason: v?.reason ?? null,
            baseline_eta: b?.baseline_eta ?? null,
            baseline_pallets: b?.baseline_pallets ?? null,
            baseline_ind: b?.baseline_cost_ind ?? null,
            baseline_inv: b?.baseline_cost_inv ?? null,
            seen_eta: b?.seen_eta ?? null,
            seen_pallets: b?.seen_pallets ?? null,
            seen_ind: b?.seen_cost_ind ?? null,
            seen_inv: b?.seen_cost_inv ?? null,
          } as Row;
        })
        .filter(Boolean) as Row[],
    );

    // Pending rows: manager-offer responses without a real shipment_item yet.
    // We only treat an offer as "materialised" when distribution_items has BOTH
    // reserved_offer_id AND shipment_item_id — i.e. it became part of a real shipment.
    // Hidden in the "unloaded" board (no shipment to unload yet).
    const materialisedOfferIds = new Set(
      dists.flatMap((d) =>
        (d.distribution_items ?? [])
          .filter((di) => di.shipment_item_id)
          .map((di) => di.reserved_offer_id)
          .filter(Boolean) as string[],
      ),
    );
    const pending: Row[] =
      board === "unloaded"
        ? []
        : (pendingOffers ?? [])
            .filter((p) => !materialisedOfferIds.has(p.offer_id))
            // Cleanup Pack #8: "Підтверджений товар" — лише підтверджені/частково
            // підтверджені/замовлені. Заявки, що ще чекають на підтвердження
            // менеджером, залишаються тільки у "Пропозиції ЗЕД".
            .filter((p) => {
              const o = p.manager_offers;
              const approved = p.approved_pallets;
              if (o.status === "deleted") return true; // показуємо як "Скасовано"
              if (o.linked_shipment_id) return true;   // "Замовлено"
              if (approved === null) return false;     // ще чекає підтвердження
              return true;                              // підтверджено / частково / відмова
            })
            .map((p) => {
              const o = p.manager_offers;
              const approved = p.approved_pallets;
              const requested = Number(p.requested_pallets || 0);
              let pipeline: PipelineStatus;
              let codeLabel: string;
              let note: string | null = null;
              if (o.status === "deleted") {
                pipeline = "cancelled";
                codeLabel = "Скасовано";
              } else if (o.linked_shipment_id) {
                pipeline = "ordered";
                codeLabel = "Замовлено";
                if (approved != null && Number(approved) < requested)
                  note = `${approved} з ${requested}п`;
              } else if (Number(approved) <= 0) {
                pipeline = "rejected";
                codeLabel = "Відмовлено";
              } else if (o.status === "closed") {
                pipeline = "confirmed";
                codeLabel = "Підтверджено";
                if (Number(approved) < requested) note = `${approved} з ${requested}п`;
              } else {
                pipeline = "confirmed";
                codeLabel = Number(approved) < requested ? "Підтверджено частково" : "Підтверджено";
                if (Number(approved) < requested) note = `${approved} з ${requested}п`;
              }
              const pallets = Number(approved ?? requested ?? 0);
              const weight = pallets * Number(o.pallet_weight ?? 0);
              return {
                key: `mor-${p.id}`,
                shipment_item_id: `mor-${p.id}`,
                distribution_id: `mor-${p.id}`,
                code: codeLabel,
                eta: o.expected_eta,
                pipeline,
                dist_status: "pending",
                approved_qty_note: note,
                product: o.product_name,
                country: o.origin_country,
                caliber: o.caliber,
                variety: o.variety,
                brand: null,
                class: null,
                packaging: null,
                supplier_name: null,
                temperature_mode: null,
                manager_name: o.import_manager_id ? mgrMap.get(o.import_manager_id) ?? null : null,
                pallets,
                weight,
                indicative: o.indicative_cost_usd,
                invoice: o.invoice_cost_usd,
                bvp_ind: null,
                bvp_inv: null,
                bvp_reason: null,
                baseline_eta: o.expected_eta,
                baseline_pallets: pallets,
                baseline_ind: o.indicative_cost_usd,
                baseline_inv: o.invoice_cost_usd,
                seen_eta: o.expected_eta,
                seen_pallets: pallets,
                seen_ind: o.indicative_cost_usd,
                seen_inv: o.invoice_cost_usd,
              } as Row;
            });


    return [...materialized, ...pending];
  }, [dists, items, ships, suppliers, managers, baselines, bvps, board, pendingOffers]);


  const ackChange = async (distributionId: string, shipmentItemId: string) => {
    await (supabase as any).rpc("branch_ack_changes", {
      p_distribution_id: distributionId,
      p_shipment_item_id: shipmentItemId,
    });
    qc.invalidateQueries({ queryKey: ["branch-baselines", branchId] });
    qc.invalidateQueries({ queryKey: ["branch-visible-prices", branchId] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const managerOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.manager_name && set.add(r.manager_name));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk")).map((v) => ({ value: v, label: v }));
  }, [rows]);
  const productOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.product && set.add(r.product));
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
        if (fProduct !== "__all__" && r.product !== fProduct) return false;
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

  const drillRows = useMemo(() => {
    if (!drill) return [];
    return rows.filter((r) => r.key === drill.key);
  }, [drill, rows]);
  const drillGrouped = useMemo(() => {
    const m = new Map<string, Row[]>();
    drillRows.forEach((r) => {
      const k = r.eta ?? "";
      const arr = m.get(k) ?? [];
      arr.push(r);
      m.set(k, arr);
    });
    return Array.from(m.entries()).sort(([a], [b]) => (a < b ? -1 : 1));
  }, [drillRows]);
  const drillTotalP = drillRows.reduce((s, r) => s + r.pallets, 0);
  const drillTotalW = drillRows.reduce((s, r) => s + r.weight, 0);
  const totalConfirmedPallets = useMemo(
    () => filteredRows.reduce((s, r) => s + (Number(r.pallets) || 0), 0),
    [filteredRows],
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Філія" subtitle="Підтверджений товар" />

      {!branchId && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">
          Вам ще не призначено філію. Зверніться до адміністратора.
        </div>
      )}

      <div className="space-y-2">
        <MainBoardToggle value={board} onChange={setBoard} />
        <div className="flex items-center justify-between gap-3 text-xs">
          <div className="font-semibold text-foreground">
            {board === "active" ? "Активний товар у роботі" : "Розвантажений товар"}
          </div>
          <div className="text-muted-foreground">
            {filteredRows.length} {filteredRows.length === 1 ? "рядок" : filteredRows.length < 5 ? "рядки" : "рядків"}
            {filtersActive && rows.length !== filteredRows.length && (
              <span className="ml-1 opacity-70">з {rows.length}</span>
            )}
          </div>
        </div>
        {rows.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
        )}
      </div>

      {distsPending || (!!branchId && dists === undefined && !distsError) ? (
        <SectionCard title="Підтверджений товар">
          <div className="flex items-center justify-center py-10">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
          </div>
        </SectionCard>
      ) : !filteredRows.length ? (
        <EmptyState title={
          filtersActive
            ? "Немає товару за обраними фільтрами"
            : board === "unloaded" ? "У розвантажених поки порожньо" : "Поки немає підтвердженого товару"
        } />
      ) : (
        <SectionCard title="Підтверджений товар">
          <TableScroller className="-mx-2">
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-xs">
              <thead className="[&_th]:bg-table-head [&_th]:font-bold">
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="sticky left-0 z-10 bg-card px-2 py-2 font-medium shadow-[1px_0_0_0_hsl(var(--border))]">Статус</th>
                  <th className="px-2 py-2 font-medium">ETA</th>
                  <th className="px-2 py-2 font-medium">Поставка</th>
                  <th className="px-2 py-2 font-medium">Товар</th>
                  <th className="px-2 py-2 font-medium">Країна походження</th>
                  <th className="relative px-2 py-2 pb-5 text-right font-medium align-top">
                    Палет
                    <span className="absolute right-2 bottom-0.5 text-[10px] font-bold leading-none tabular-nums text-destructive normal-case">
                      {totalConfirmedPallets}п
                    </span>
                  </th>
                  <th className="px-2 py-2 text-right font-medium">Собівартість</th>
                  <th className="px-2 py-2 font-medium">Відп. менеджер</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const s = statsFor(r);
                  const etaChanged = dateNeq(r.eta, r.seen_eta);
                  const palChanged = numNeq(r.pallets, r.seen_pallets);
                  // Patch 8B: pill driven by BVP vs baseline.seen_cost_*, not by notifications.
                  const costChanged =
                    !!r.bvp_reason &&
                    (r.bvp_reason === "final_freight_locked" || r.bvp_reason === "unit_price_increased") &&
                    (numNeq(r.seen_ind, r.bvp_ind) || numNeq(r.seen_inv, r.bvp_inv));
                  return (
                    <tr
                      key={r.key}
                      onClick={() => setDrill({ key: r.key, product: r.product, country: r.country })}
                      className="cursor-pointer border-b border-border hover:bg-muted/40 active:bg-muted/60"
                    >
                      <td className="sticky left-0 z-10 bg-card px-2 py-2 shadow-[1px_0_0_0_hsl(var(--border))]">
                        <PipelineStatusBadge status={r.pipeline} variant="animated" size="sm" />
                        {r.approved_qty_note && (
                          <div className="mt-0.5 text-[10px] text-muted-foreground">{r.approved_qty_note}</div>
                        )}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">
                        {fmtEta(r.eta)}
                        {etaChanged && (
                          <ChangeBadge
                            field="ETA"
                            oldVal={fmtEta(r.seen_eta)}
                            newVal={fmtEta(r.eta)}
                            onAck={() => ackChange(r.distribution_id, r.shipment_item_id)}
                          />
                        )}
                      </td>
                      <td className="px-2 py-2 font-mono text-[11px] font-semibold">
                        <DescriptionPopover row={r}>
                          <span className="underline-offset-2 hover:underline">{r.code}</span>
                        </DescriptionPopover>
                      </td>
                      <td className="px-2 py-2 font-medium">
                        <DescriptionPopover row={r}>
                          <span className="underline-offset-2 hover:underline">{r.product}</span>
                        </DescriptionPopover>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-muted-foreground">
                        {r.country ? toUaCountry(r.country) : "—"}
                      </td>
                      <td className="px-2 py-2 text-right font-bold tabular-nums">
                        {s.pending > 0 ? (
                          <span>
                            {s.free}п <span className="text-muted-foreground font-normal">/</span>{" "}
                            <span className="text-blue-600">{s.pending}п</span>
                          </span>
                        ) : (
                          <span>{r.pallets}п</span>
                        )}
                        {palChanged && (
                          <ChangeBadge
                            field="Палети"
                            oldVal={`${Number(r.seen_pallets ?? 0)}п`}
                            newVal={`${r.pallets}п`}
                            onAck={() => ackChange(r.distribution_id, r.shipment_item_id)}
                          />
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <CostPair indicative={r.indicative} invoice={r.invoice} suffix=" кг" size="xs" />
                        {costChanged && (
                          <ChangeBadge
                            field="Собівартість"
                            oldVal={`$${Number(r.seen_ind ?? 0).toFixed(2)} / $${Number(r.seen_inv ?? 0).toFixed(2)}`}
                            newVal={`$${Number(r.bvp_ind ?? 0).toFixed(2)} / $${Number(r.bvp_inv ?? 0).toFixed(2)}`}
                            onAck={() => ackChange(r.distribution_id, r.shipment_item_id)}
                          />
                        )}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">
                        {r.manager_name ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroller>
        </SectionCard>
      )}

      <Sheet open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <SheetContent side="top" className="mt-[env(safe-area-inset-top)] max-h-[85vh] overflow-y-auto rounded-b-2xl">
          <SheetHeader className="text-left">
            <SheetTitle className="pr-8">
              <span>
                {drill?.product}
                {drill?.country && (<span className="text-muted-foreground"> · {toUaCountry(drill.country)}</span>)}
              </span>
            </SheetTitle>
          </SheetHeader>

          <div className="mt-3 rounded-xl border border-border bg-background/40 p-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Всього призначено філії</div>
            <div className="text-xl font-bold tabular-nums">
              {drillTotalP}п · {drillTotalW.toLocaleString("uk-UA")} кг
            </div>
          </div>

          <div className="mt-4 space-y-4">
            {drillGrouped.map(([eta, list]) => {
              const p = list.reduce((s, r) => s + r.pallets, 0);
              const w = list.reduce((s, r) => s + r.weight, 0);
              return (
                <div key={eta || "no-date"}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <div className="text-sm font-semibold">{fmtEta(eta || null)}</div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {p}п · {w.toLocaleString("uk-UA")} кг
                    </div>
                  </div>
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {list.map((r) => {
                      const s = statsFor(r);
                      return (
                        <li key={r.key} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="font-mono text-[11px] font-semibold">{r.code}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {r.caliber ? `Калібр ${r.caliber}` : ""}
                            </div>
                          </div>
                          <div className="text-right tabular-nums">
                            <div className="font-bold">
                              {s.pending > 0 ? (
                                <>
                                  {s.free}п <span className="text-muted-foreground font-normal">/</span>{" "}
                                  <span className="text-blue-600">{s.pending}п</span>
                                </>
                              ) : (
                                <>{s.free}п</>
                              )}
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              всього {r.pallets}п · {r.weight.toLocaleString("uk-UA")} кг
                            </div>
                          </div>
                          <Button
                            size="sm"
                            className="h-8 px-2 text-xs"
                            disabled={s.free <= 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              setOfferRow({ ...r, pallets: s.free });
                            }}
                          >
                            Запропонувати
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      <OfferDialog
        open={!!offerRow}
        onClose={() => setOfferRow(null)}
        item={
          offerRow
            ? {
                shipment_item_id: offerRow.shipment_item_id,
                distribution_id: offerRow.distribution_id,
                product_name: offerRow.product,
                caliber: offerRow.caliber ?? "—",
                available_pallets: offerRow.pallets,
                shipment_code: offerRow.code,
              }
            : null
        }
      />
    </div>
  );
}
