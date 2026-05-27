import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/cards";
import { toUaCountry, toShortUaCountry } from "@/lib/countries";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CostPair } from "@/components/CostPair";
import { OfferDialog } from "@/components/OfferDialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

import { StatusIcon } from "@/components/StatusIcon";
import { STATUS_TEXT_COLOR } from "@/lib/status-icon-map";
import { PIPELINE_LABEL } from "@/lib/pipeline-status";
import { TableScroller } from "@/components/TableScroller";
import type { PipelineStatus } from "@/lib/pipeline-status";
import { MainBoardToggle, type BoardView } from "@/components/MainBoardToggle";
import { useFirstScreenGate } from "@/routes/_authenticated";


const MALEKHIV_BRANCH_ID = "3bb65cb3-27a1-5f18-839a-340271d711fd";
type SortKey = "eta" | "product" | "country" | "manager" | "shipment" | "pallets" | "status";

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


function BranchDashboard() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const branchId = profile?.branch_id;
  const [drill, setDrill] = useState<{ key: string; product: string; country: string | null } | null>(null);
  const [offerRow, setOfferRow] = useState<Row | null>(null);
  const [board, setBoard] = useState<BoardView>("active");
  const [sortBy, setSortBy] = useState<SortKey>("eta");
  const [search, setSearch] = useState<string>("");

  const isMalekhiv = branchId === MALEKHIV_BRANCH_ID;
  // Scope the transparency test to <body> so the bottom nav can pick it up too.
  useEffect(() => {
    if (!isMalekhiv) return;
    document.body.setAttribute("data-branch-test", "malekhiv");
    return () => { document.body.removeAttribute("data-branch-test"); };
  }, [isMalekhiv]);

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
    // Cleanup Pack #6: fallback responsible-manager source — manager_offers.import_manager_id
    // via distribution_items.reserved_offer_id. Useful when shipment lacks import_manager_id
    // but the товар came from a manager offer that does have one.
    const offerMgrMap = new Map<string, string>();
    for (const p of pendingOffers ?? []) {
      const mid = p.manager_offers.import_manager_id;
      if (mid && mgrMap.has(mid)) offerMgrMap.set(p.offer_id, mgrMap.get(mid) as string);
    }
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
            manager_name:
              (s?.import_manager_id && mgrMap.get(s.import_manager_id))
                ? (mgrMap.get(s.import_manager_id) as string)
                : (di.reserved_offer_id ? offerMgrMap.get(di.reserved_offer_id) ?? null : null),
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

  const filteredRows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("uk");
    const matched = q
      ? rows.filter((r) => {
          const haystack = [
            r.product,
            r.manager_name,
            r.country ? toUaCountry(r.country) : null,
            r.country,
            r.code,
            r.eta ? new Date(r.eta).toLocaleDateString("uk-UA") : null,
            r.eta,
          ]
            .filter(Boolean)
            .join(" ")
            .toLocaleLowerCase("uk");
          return haystack.includes(q);
        })
      : rows;
    const sorted = [...matched];
    const cmp = (a: Row, b: Row): number => {
      switch (sortBy) {
        case "product":
          return a.product.localeCompare(b.product, "uk");
        case "country":
          return toUaCountry(a.country ?? "").localeCompare(toUaCountry(b.country ?? ""), "uk");
        case "manager":
          return (a.manager_name ?? "").localeCompare(b.manager_name ?? "", "uk");
        case "shipment":
          return a.code.localeCompare(b.code, "uk");
        case "pallets":
          return b.pallets - a.pallets;
        case "status":
          return a.pipeline.localeCompare(b.pipeline);
        case "eta":
        default:
          return (a.eta ?? "").localeCompare(b.eta ?? "");
      }
    };
    return sorted.sort(cmp);
  }, [rows, search, sortBy]);


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

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: "eta", label: "За датою заходу" },
    { value: "status", label: "За статусом / активністю" },
    { value: "product", label: "За товаром" },
    { value: "country", label: "За країною" },
    { value: "manager", label: "За менеджером" },
    { value: "shipment", label: "За поставкою" },
    { value: "pallets", label: "За палетами" },
  ];

  const controlBaseClass =
    "h-10 w-full rounded-lg border border-input bg-card/80 px-3 text-sm font-normal leading-none text-foreground shadow-sm appearance-none";
  const controlFocusClass =
    "focus:outline-none focus:border-destructive focus:ring-1 focus:ring-destructive data-[active=true]:border-destructive data-[active=true]:ring-1 data-[active=true]:ring-destructive";

  return (
    <div
      className="space-y-3"
      data-branch-test={isMalekhiv ? "malekhiv" : undefined}
    >
      {!branchId && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">
          Вам ще не призначено філію. Зверніться до адміністратора.
        </div>
      )}

      <MainBoardToggle value={board} onChange={setBoard} />

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            aria-label="Сортувати за"
            className={cn(controlBaseClass, controlFocusClass)}
            data-active={sortBy !== "eta" ? "true" : undefined}
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>
                Сортувати: {o.label.replace(/^За /, "")}
              </option>
            ))}
          </select>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук: товар, країна, менеджер…"
            className={cn(controlBaseClass, controlFocusClass)}
            data-active={search ? "true" : undefined}
          />
        </div>
      )}

      {distsPending || (!!branchId && dists === undefined && !distsError) ? (
        <div className="flex items-center justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        </div>
      ) : !filteredRows.length ? (
        <EmptyState
          title={
            search
              ? "Немає товару за пошуком"
              : board === "unloaded"
                ? "У розвантажених поки порожньо"
                : "Поки немає підтвердженого товару"
          }
        />
      ) : (
        <div className="branch-table-wrap rounded-2xl border border-border bg-card p-2 shadow-card sm:p-3">
          <TableScroller className="-mx-1">
            <table className="w-full min-w-[820px] border-separate border-spacing-0 text-xs">
              <thead className="[&_th]:bg-table-head [&_th]:font-medium">
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="sticky left-0 z-20 bg-card px-1 py-2 font-medium text-center" style={{ width: 56, minWidth: 56 }}>Статус</th>
                  <th className="sticky left-[56px] z-20 bg-card px-2 py-2 font-medium" style={{ width: 150, minWidth: 150, maxWidth: 150 }}>Товар</th>
                  <th className="px-2 py-2 font-medium">Країна</th>
                  <th className="px-2 py-2 font-medium">Заход</th>
                  <th className="relative px-2 py-2 pb-5 text-right font-medium align-top">
                    Палет
                    <span className="absolute right-2 bottom-0.5 text-[10px] font-bold leading-none tabular-nums text-destructive normal-case">
                      {totalConfirmedPallets}п
                    </span>
                  </th>
                  <th className="px-2 py-2 text-right font-medium">Собівартість</th>
                  <th className="px-2 py-2 font-medium">Менеджер</th>
                  <th className="px-2 py-2 font-medium">Поставка</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const s = statsFor(r);
                  const etaChanged = dateNeq(r.eta, r.seen_eta);
                  const palChanged = numNeq(r.pallets, r.seen_pallets);
                  const costChanged =
                    !!r.bvp_reason &&
                    (r.bvp_reason === "final_freight_locked" || r.bvp_reason === "unit_price_increased") &&
                    (numNeq(r.seen_ind, r.bvp_ind) || numNeq(r.seen_inv, r.bvp_inv));
                  return (
                    <tr
                      key={r.key}
                      className="border-b border-border hover:bg-muted/40 active:bg-muted/60"
                    >
                      <td
                        className="sticky left-0 z-10 bg-card px-1 py-2 text-center cursor-pointer"
                        style={{ width: 56, minWidth: 56 }}
                        onClick={() => setDrill({ key: r.key, product: r.product, country: r.country })}
                      >
                        <StatusIcon status={r.pipeline} size={26} />
                      </td>
                      <td
                        className="sticky left-[56px] z-10 bg-card px-2 py-2 cursor-pointer"
                        style={{ width: 150, minWidth: 150, maxWidth: 150 }}
                        onClick={() => setDrill({ key: r.key, product: r.product, country: r.country })}
                      >
                        <div className="truncate" title={r.product}>
                          {r.product}
                        </div>
                        {r.approved_qty_note && (
                          <div className="truncate text-[10px] text-muted-foreground">{r.approved_qty_note}</div>
                        )}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-foreground/80">
                        <span className="sm:hidden">{r.country ? toShortUaCountry(r.country) : "—"}</span>
                        <span className="hidden sm:inline">{r.country ? toUaCountry(r.country) : "—"}</span>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-foreground/80">
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
                      <td className="px-2 py-2 text-right tabular-nums">
                        {s.pending > 0 ? (
                          <span>
                            {s.free}п <span className="text-muted-foreground"> / </span>
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
                      <td className="px-2 py-2 text-foreground/80 whitespace-nowrap">
                        {r.manager_name ?? "—"}
                      </td>
                      <td className="px-2 py-2 font-mono text-[11px] whitespace-nowrap">
                        {r.distribution_id.startsWith("mor-") ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          r.code || <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}

              </tbody>
            </table>
          </TableScroller>
        </div>
      )}

      {/* Detail popup — centered Dialog so it sits in the workspace area
          (well below the sticky header / personal banner) rather than being
          pinned to the very top of the viewport. */}
      <Dialog open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent className="top-[calc(env(safe-area-inset-top)+88px)] translate-y-0 sm:top-1/2 sm:-translate-y-1/2 max-h-[80vh] overflow-y-auto w-[calc(100vw-1.5rem)] sm:max-w-lg p-4 sm:p-6">
          <DialogHeader className="text-left">
            <DialogTitle className="pr-8 text-base sm:text-lg">
              {drill?.product}
              {drill?.country && (
                <span className="text-muted-foreground font-normal"> · {toUaCountry(drill.country)}</span>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Status header — icon + textual label in status colour */}
          {drillRows[0] && (
            <div className="mt-2 flex items-center gap-3">
              <StatusIcon status={drillRows[0].pipeline} size={42} />
              <div
                className="text-base font-semibold leading-tight"
                style={{ color: STATUS_TEXT_COLOR[drillRows[0].pipeline] }}
              >
                {PIPELINE_LABEL[drillRows[0].pipeline]}
              </div>
            </div>
          )}

          {/* Full specification of the row (existing fields only) */}
          {drillRows[0] && (
            <dl className="mt-4 grid grid-cols-[120px_1fr] gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Товар</dt>
              <dd className="font-medium">{drillRows[0].product}</dd>
              {drillRows[0].country && (
                <>
                  <dt className="text-muted-foreground">Країна</dt>
                  <dd>{toUaCountry(drillRows[0].country)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Відп. менеджер</dt>
              <dd className="font-medium">{drillRows[0].manager_name ?? "—"}</dd>
              <dt className="text-muted-foreground">Поставка</dt>
              <dd className="font-mono">{drillRows[0].code}</dd>
              <dt className="text-muted-foreground">Дата заходу / ETA</dt>
              <dd className="tabular-nums">{fmtEta(drillRows[0].eta)}</dd>
              <dt className="text-muted-foreground">Палет</dt>
              <dd className="tabular-nums">{drillTotalP}п</dd>
              <dt className="text-muted-foreground">Вага (нетто)</dt>
              <dd className="tabular-nums">{drillTotalW.toLocaleString("uk-UA")} кг</dd>
              <dt className="text-muted-foreground">Собівартість</dt>
              <dd className="tabular-nums">
                {drillRows[0].indicative != null ? `$${Number(drillRows[0].indicative).toFixed(2)}` : "—"}
                {" / "}
                {drillRows[0].invoice != null ? `$${Number(drillRows[0].invoice).toFixed(2)}` : "—"} /кг
              </dd>
              {drillRows[0].caliber && (<><dt className="text-muted-foreground">Калібр</dt><dd>{drillRows[0].caliber}</dd></>)}
              {drillRows[0].variety && (<><dt className="text-muted-foreground">Сорт</dt><dd>{drillRows[0].variety}</dd></>)}
              {drillRows[0].brand && (<><dt className="text-muted-foreground">Бренд</dt><dd>{drillRows[0].brand}</dd></>)}
              {drillRows[0].class && (<><dt className="text-muted-foreground">Клас</dt><dd>{drillRows[0].class}</dd></>)}
              {drillRows[0].packaging && (<><dt className="text-muted-foreground">Упаковка</dt><dd>{drillRows[0].packaging}</dd></>)}
              {drillRows[0].supplier_name && (<><dt className="text-muted-foreground">Постачальник</dt><dd>{drillRows[0].supplier_name}</dd></>)}
              {drillRows[0].temperature_mode && (<><dt className="text-muted-foreground">Темп. режим</dt><dd>{drillRows[0].temperature_mode}</dd></>)}
            </dl>
          )}

          {/* Per-ETA breakdown + transfer button (kept from previous Sheet) */}
          <div className="mt-4 space-y-3">
            {drillGrouped.map(([eta, list]) => {
              const p = list.reduce((s, r) => s + r.pallets, 0);
              const w = list.reduce((s, r) => s + r.weight, 0);
              return (
                <div key={eta || "no-date"}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <div className="text-xs font-semibold">{fmtEta(eta || null)}</div>
                    <div className="text-[11px] text-muted-foreground tabular-nums">
                      {p}п · {w.toLocaleString("uk-UA")} кг
                    </div>
                  </div>
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {list.map((r) => {
                      const s = statsFor(r);
                      return (
                        <li key={r.key} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
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
        </DialogContent>
      </Dialog>

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
