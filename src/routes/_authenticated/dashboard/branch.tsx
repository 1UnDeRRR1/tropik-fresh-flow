import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState, useMemo, useEffect } from "react";
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
import {
  resolveOfferRow,
  resolveMaterializedRow,
  logAnchorCoverage,
  summarizeAnchors,
  type RowAnchor,
  type OfferLike,
} from "@/lib/branch-row-anchor";

// Block 1: real shipment code gate. A row belongs to "Головна" only when the
// underlying shipment has a non-empty, non-placeholder `shipments.code`.
// Otherwise it is shown in "Пропозиції". No text/identity matching — this is
// a presence check on a single field, not a resolver.
function isRealShipmentCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const t = code.trim();
  if (!t) return false;
  if (t === "—" || t === "-") return false;
  return true;
}


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
  // Block 0.5/1: anchor + classification (read-only, derived).
  anchor: RowAnchor;
  is_real_shipment_code: boolean;
};

const fmtEta = (eta: string | null) => {
  if (!eta) return "—";
  const d = new Date(eta);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}`;
};

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

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground text-right">{value}</span>
    </div>
  );
}




function BranchDashboard() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const branchId = profile?.branch_id;
  const [drill, setDrill] = useState<{ key: string; product: string; country: string | null } | null>(null);
  const [offerRow, setOfferRow] = useState<Row | null>(null);
  const [board, setBoard] = useState<BoardView>("active");
  const [view, setView] = useState<"main" | "offers">("main");
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
          manager_offers!inner(id,position_id,product_name,origin_country,caliber,variety,expected_eta,indicative_cost_usd,invoice_cost_usd,linked_shipment_id,status,import_manager_id,pallet_weight,created_by)`)
        .eq("branch_id", branchId!);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; offer_id: string; approved_pallets: number | null; requested_pallets: number;
        manager_offers: {
          id: string; position_id: string | null; product_name: string; origin_country: string | null;
          caliber: string | null; variety: string | null; expected_eta: string | null;
          indicative_cost_usd: number | null; invoice_cost_usd: number | null;
          linked_shipment_id: string | null; status: string;
          import_manager_id: string | null; pallet_weight: number | null;
          created_by: string | null;
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
        .from("shipment_items_branch")
        .select("id,product_name,caliber,origin_country,variety,brand,class,linked_offer_id")
        .in("id", itemIds);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; product_name: string; caliber: string | null;
        origin_country: string | null; variety: string | null;
        brand: string | null; class: string | null;
        linked_offer_id: string | null;
      }>;
    },
  });

  // Block 0.5/1 bridge: for materialized rows whose shipment_items.linked_offer_id
  // points at a manager_offer NOT in pendingOffers (closed/linked/expired offers),
  // fetch only id + position_id to resolve the row anchor. No text matching.
  const bridgeOfferIds = useMemo(() => {
    const fromItems = new Set(
      (items ?? []).map((i) => i.linked_offer_id).filter(Boolean) as string[],
    );
    return Array.from(fromItems);
  }, [items]);

  const { data: bridgeOffers } = useQuery({
    queryKey: ["branch-bridge-offers", bridgeOfferIds.join(",")],
    enabled: bridgeOfferIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("manager_offers")
        .select("id,position_id")
        .in("id", bridgeOfferIds);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; position_id: string | null }>;
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
        .from("shipments_branch")
        .select("id,code,eta,country,unloaded_at,cancelled_at,archived_at,status,pipeline_status,temperature_mode,import_manager_id,import_manager_name")
        .in("id", shipmentIds);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; code: string; eta: string | null; country: string | null;
        unloaded_at: string | null; cancelled_at: string | null; archived_at: string | null;
        status: string; pipeline_status: PipelineStatus; temperature_mode: string | null;
        import_manager_id: string | null; import_manager_name: string | null;
      }>;
    },
  });

  // Branch path does not fetch suppliers (purchase-side data is hidden from branch).
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

  const { data: managers } = useQuery({
    queryKey: ["branch-managers", managerIds.join(",")],
    enabled: managerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("import_managers").select("id,full_name").in("id", managerIds);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; full_name: string }>;
    },
  });

  // Branch-safe shipment manager names via shipments_branch view (RLS-friendly for branch users).
  const { data: shipMgrs } = useQuery({
    queryKey: ["branch-ship-managers", shipmentIds.join(",")],
    enabled: shipmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipments_branch")
        .select("id,import_manager_id,import_manager_name")
        .in("id", shipmentIds);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; import_manager_id: string | null; import_manager_name: string | null }>;
    },
  });

  // Stage 2B: branch-safe fallback for pending/offer-row manager name.
  // Branch users cannot SELECT import_managers (RLS). Resolve manager_offers.created_by
  // via existing SECURITY DEFINER RPC get_profile_names. In current Tropik flow the
  // offer creator IS the responsible manager — used for display fallback only.
  const offerCreatorIds = useMemo(
    () =>
      Array.from(
        new Set(
          (pendingOffers ?? [])
            .map((p) => p.manager_offers.created_by)
            .filter(Boolean) as string[],
        ),
      ),
    [pendingOffers],
  );
  const { data: offerCreators } = useQuery({
    queryKey: ["branch-offer-creators", offerCreatorIds.join(",")],
    enabled: offerCreatorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_profile_names", {
        _ids: offerCreatorIds,
      });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; full_name: string | null }>;
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
    // Suppliers are not fetched on the branch path; supplier_name is intentionally null.
    const mgrMap = new Map((managers ?? []).map((m) => [m.id, m.full_name]));
    // Branch-safe map: shipment id → manager full name from shipments_branch.
    const shipMgrNameMap = new Map(
      (shipMgrs ?? [])
        .filter((s) => !!s.import_manager_name)
        .map((s) => [s.id, s.import_manager_name as string]),
    );
    // Stage 2B: created_by → full_name from get_profile_names RPC (branch-safe).
    const offerCreatorNameMap = new Map(
      (offerCreators ?? [])
        .filter((u) => !!u.full_name)
        .map((u) => [u.id, u.full_name as string]),
    );
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

    // Block 0.5/1: offer-id → OfferLike map for materialized row anchor resolution.
    // Built from BOTH pendingOffers (active responses) and bridgeOffers (closed/linked
    // offers fetched only by id+position_id). No text matching.
    const offerById = new Map<string, OfferLike>();
    for (const p of pendingOffers ?? []) {
      offerById.set(p.manager_offers.id, {
        id: p.manager_offers.id,
        position_id: (p.manager_offers as { position_id?: string | null }).position_id ?? null,
      });
    }
    for (const o of bridgeOffers ?? []) {
      // bridge offers win when both exist — same FK row, same value.
      offerById.set(o.id, { id: o.id, position_id: o.position_id ?? null });
    }

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
              (s?.id && shipMgrNameMap.get(s.id))
                ?? (s?.import_manager_id && mgrMap.get(s.import_manager_id))
                ?? (di.reserved_offer_id ? offerMgrMap.get(di.reserved_offer_id) ?? null : null),
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
            anchor: resolveMaterializedRow({
              item: { id: it.id, linked_offer_id: (it as { linked_offer_id?: string | null }).linked_offer_id ?? null },
              offerById,
              distributionItemId: d.id,
              shipmentId: d.shipment_id,
              supplierId: s?.supplier_id ?? undefined,
            }),
            is_real_shipment_code: isRealShipmentCode(s?.code),
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
                manager_name:
                  (o.import_manager_id && mgrMap.get(o.import_manager_id))
                  ?? (o.created_by && offerCreatorNameMap.get(o.created_by))
                  ?? null,
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
                anchor: resolveOfferRow({ offer: { id: o.id, position_id: o.position_id ?? null }, responseId: p.id }),
                is_real_shipment_code: false, // pending/offer rows never have a real shipments.code
              } as Row;
            });


    return [...materialized, ...pending];
  }, [dists, items, ships, suppliers, managers, shipMgrs, offerCreators, baselines, bvps, board, pendingOffers, bridgeOffers]);


  const ackChange = async (distributionId: string, shipmentItemId: string) => {
    await (supabase as any).rpc("branch_ack_changes", {
      p_distribution_id: distributionId,
      p_shipment_item_id: shipmentItemId,
    });
    qc.invalidateQueries({ queryKey: ["branch-baselines", branchId] });
    qc.invalidateQueries({ queryKey: ["branch-visible-prices", branchId] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  // Block 1: partition by real shipment code. "Головна" = is_real_shipment_code,
  // "Пропозиції" = the rest (pending offers + materialized rows without code).
  const mainRows = useMemo(() => rows.filter((r) => r.is_real_shipment_code), [rows]);
  const offerRows = useMemo(() => rows.filter((r) => !r.is_real_shipment_code), [rows]);

  // Dev-only coverage log: position_id resolution stats for both partitions.
  useEffect(() => {
    if (rows.length === 0) return;
    logAnchorCoverage("branch:all", rows.map((r) => r.anchor));
    logAnchorCoverage("branch:main", mainRows.map((r) => r.anchor));
    logAnchorCoverage("branch:offers", offerRows.map((r) => r.anchor));
    if (typeof window !== "undefined" && import.meta.env?.DEV) {
      // eslint-disable-next-line no-console
      console.info("[branch-row-anchor] split: main=", mainRows.length, "offers=", offerRows.length, "total=", rows.length);
    }
  }, [rows, mainRows, offerRows]);

  const viewRows = view === "main" ? mainRows : offerRows;

  const filteredRows = useMemo(() => {
    const baseRows = viewRows;
    const q = search.trim().toLocaleLowerCase("uk");
    const matched = q
      ? baseRows.filter((r) => {
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
      : baseRows;
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
  }, [viewRows, search, sortBy]);


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
    "h-10 w-full rounded-lg border border-input bg-card/80 px-3 text-sm font-normal leading-none text-foreground shadow-sm appearance-none placeholder:text-sm placeholder:font-normal placeholder:text-muted-foreground";
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

      <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="Розділ">
        {([
          { id: "main", label: "Головна", count: mainRows.length },
          { id: "offers", label: "Пропозиції", count: offerRows.length },
        ] as const).map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={view === t.id}
            onClick={() => setView(t.id)}
            className={cn(
              "h-10 rounded-lg border px-3 text-sm font-medium leading-none transition-colors",
              view === t.id
                ? "border-destructive bg-destructive/10 text-destructive"
                : "border-input bg-card/80 text-foreground hover:bg-muted/50",
            )}
          >
            {t.label} <span className="ml-1 text-xs tabular-nums opacity-70">{t.count}</span>
          </button>
        ))}
      </div>

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
            <table className="w-full min-w-[760px] border-separate border-spacing-0 text-xs">
              <thead className="[&_th]:bg-table-head [&_th]:font-medium">
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground [&>th:first-child]:normal-case [&>th:first-child]:tracking-normal [&>th:first-child]:text-[11px]">
                  <th className="sticky left-0 z-20 bg-card pl-1 pr-0.5 py-2 font-medium text-left normal-case tracking-normal whitespace-nowrap" style={{ width: 52, minWidth: 52, maxWidth: 52 }}>Статус</th>
                  <th className="sticky left-[52px] z-20 bg-card px-2 py-2 font-medium" style={{ width: 128, minWidth: 128, maxWidth: 128 }}>Товар</th>
                  <th className="px-2 py-2 font-medium">Країна</th>
                  <th className="px-2 py-2 font-medium">Заход</th>
                  <th className="relative px-2 py-2 pb-5 text-right font-medium align-top">
                    Палет
                    <span className="absolute right-2 bottom-0.5 text-[10px] font-bold leading-none tabular-nums text-destructive normal-case">
                      {totalConfirmedPallets}п
                    </span>
                  </th>
                  <th className="px-2 py-2 font-medium">Сорт</th>
                  <th className="px-2 py-2 font-medium">Калібр</th>
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
                        className="sticky left-0 z-10 bg-card pl-1 pr-0.5 py-2 text-left cursor-pointer"
                        style={{ width: 52, minWidth: 52, maxWidth: 52 }}
                        onClick={() => setDrill({ key: r.key, product: r.product, country: r.country })}
                      >
                        <StatusIcon status={r.pipeline} size={24} />
                      </td>
                      <td
                        className="sticky left-[52px] z-10 bg-card px-2 py-2 cursor-pointer"
                        style={{ width: 128, minWidth: 128, maxWidth: 128 }}
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
                      <td className="px-2 py-2 whitespace-nowrap text-foreground/80 tabular-nums">
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
                      <td className="px-2 py-2 whitespace-nowrap text-foreground/80">
                        {r.variety ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap text-foreground/80">
                        {r.caliber ?? <span className="text-muted-foreground">—</span>}
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

      {/* Product detail card — clean mobile detail view, not a label/value dump.
          Top: status icon + label (centered). Bottom: pallet counter + "Запропонувати"
          as a balanced counterweight. Middle: product as primary, then ordered
          spec list matching the table column order. */}
      <Dialog open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent className="top-[calc(env(safe-area-inset-top)+88px)] translate-y-0 sm:top-1/2 sm:-translate-y-1/2 max-h-[85vh] overflow-y-auto w-[calc(100vw-1.5rem)] sm:max-w-md p-5 sm:p-6">
          <DialogHeader className="sr-only">
            <DialogTitle>{drill?.product}</DialogTitle>
          </DialogHeader>

          {drillRows[0] && (() => {
            const r = drillRows[0];
            const s = statsFor(r);
            // Counter state per spec:
            //   pending > 0 → red "free/pending" (offer awaiting answer)
            //   else accepted > 0 → green "free/accepted" (confirmed to other branch)
            //   else → plain black total pallets
            const counterMode =
              s.pending > 0 ? "pending" : s.accepted > 0 ? "accepted" : "idle";
            const etaDate = r.eta ? new Date(r.eta) : null;
            const etaDay = etaDate
              ? etaDate.toLocaleDateString("uk-UA", { day: "2-digit" })
              : "—";
            const etaMonth = etaDate
              ? etaDate.toLocaleDateString("uk-UA", { month: "short" }).replace(".", "")
              : "";
            return (
              <>
                {/* Top centerpiece: status icon + label */}
                <div className="flex flex-col items-center gap-2 pt-1">
                  <div className="flex items-center gap-3">
                    <StatusIcon status={r.pipeline} size={40} />
                    <div
                      className="text-xl font-semibold leading-none"
                      style={{ color: STATUS_TEXT_COLOR[r.pipeline] }}
                    >
                      {PIPELINE_LABEL[r.pipeline]}
                    </div>
                  </div>
                </div>

                {/* Primary subject: product (big) + country */}
                <div className="mt-5 text-center">
                  <div className="text-2xl font-bold leading-tight tracking-tight text-foreground">
                    {r.product}
                  </div>
                  {r.country && (
                    <div className="mt-1 text-sm text-muted-foreground">
                      {toUaCountry(r.country)}
                    </div>
                  )}
                </div>

                {/* Ordered spec — same business order as the table */}
                <div className="mt-5 rounded-2xl border border-border bg-card/70 divide-y divide-border/70">
                  <DetailRow label="Палет" value={`${r.pallets}п`} />
                  <DetailRow label="Сорт" value={r.variety ?? "—"} />
                  <DetailRow label="Калібр" value={r.caliber ?? "—"} />
                  <DetailRow
                    label="Собівартість"
                    value={
                      r.indicative != null || r.invoice != null ? (
                        <CostPair indicative={r.indicative} invoice={r.invoice} suffix=" кг" size="sm" />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )
                    }
                  />
                  <DetailRow
                    label="Поставка"
                    value={
                      r.distribution_id.startsWith("mor-") ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="font-mono text-xs font-semibold">{r.code}</span>
                      )
                    }
                  />
                  {/* ETA as a small visual "tear-off" calendar */}
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Дата приходу
                    </span>
                    <div className="inline-flex h-12 w-12 flex-col items-center justify-center overflow-hidden rounded-lg border border-border bg-background shadow-sm">
                      <div className="w-full bg-destructive py-[2px] text-center text-[8px] font-bold uppercase tracking-wider text-destructive-foreground">
                        {etaMonth || "—"}
                      </div>
                      <div className="flex-1 w-full flex items-center justify-center text-base font-bold leading-none tabular-nums text-foreground">
                        {etaDay}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Bottom counterweight: counter + Запропонувати */}
                <div className="mt-6 flex items-center justify-between gap-4">
                  <div className="flex flex-col items-start">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Палет
                    </span>
                    <span className="text-2xl font-bold leading-none tabular-nums">
                      {counterMode === "pending" ? (
                        <>
                          <span className="text-foreground">{s.free}</span>
                          <span className="text-muted-foreground font-normal">/</span>
                          <span className="text-destructive">{s.pending}</span>
                        </>
                      ) : counterMode === "accepted" ? (
                        <>
                          <span className="text-foreground">{s.free}</span>
                          <span className="text-muted-foreground font-normal">/</span>
                          <span className="text-success">{s.accepted}</span>
                        </>
                      ) : (
                        <span className="text-foreground">{r.pallets}</span>
                      )}
                    </span>
                  </div>
                  <Button
                    size="lg"
                    className="h-12 flex-1 max-w-[60%] text-sm font-semibold"
                    disabled={s.free <= 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOfferRow({ ...r, pallets: s.free });
                    }}
                  >
                    Запропонувати
                  </Button>
                </div>
              </>
            );
          })()}
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
