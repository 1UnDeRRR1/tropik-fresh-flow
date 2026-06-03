import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { EmptyState } from "@/components/cards";
import { toUaCountry } from "@/lib/countries";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CostPair } from "@/components/CostPair";
import { CompactFilterSelect } from "@/components/CompactFilterSelect";
import { useProductAliases } from "@/hooks/useProductAliases";
import { useCountryAliases } from "@/hooks/useCountryAliases";
import { countPositionsFromGroups, formatPositions } from "@/lib/positions";
import type { PipelineStatus } from "@/lib/pipeline-status";

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
type SortKey = "last_event" | "eta" | "product" | "country" | "manager";

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
  last_event_at: string | null;
};

const fmtEtaShort = (eta: string | null) => {
  if (!eta) return "—";
  const d = new Date(eta);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mo = d.toLocaleDateString("uk-UA", { month: "short" }).replace(/\.$/, "");
  return `${day} ${mo}.`;
};

function BranchFlatList({
  rows,
  onOpen,
}: {
  rows: Row[];
  onOpen: (r: Row) => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-card">
      <ul className="divide-y divide-border px-3">
        {rows.map((r) => {
          const country = r.country ? toUaCountry(r.country) : "";
          return (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => onOpen(r)}
                className="w-full py-2 text-left text-sm active:opacity-70"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-baseline gap-0 text-sm text-foreground">
                    <span className="shrink-0 font-bold">{r.product}</span>
                    {country ? (
                      <span className="min-w-0 truncate"> · {country}{r.variety ? ` · ${r.variety}` : ""}</span>
                    ) : r.variety ? (
                      <span className="min-w-0 truncate"> · {r.variety}</span>
                    ) : null}
                    <span className="shrink-0 font-bold">{" · "}<span className="tabular-nums text-brand">{r.pallets}п</span></span>
                  </div>
                  <CostPair indicative={r.indicative} invoice={r.invoice} suffix=" кг" size="xs" />
                </div>
                <div className="mt-0.5 text-[11px] font-normal text-muted-foreground">
                  <span className="font-mono text-sky-500">ETA {fmtEtaShort(r.eta)}</span>
                  {r.code ? <span> · <span className="font-mono">{r.code}</span></span> : null}
                  {r.manager_name ? <span> · {r.manager_name}</span> : null}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}




function BranchDashboard() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const branchId = profile?.branch_id;
  const [drill, setDrill] = useState<{ key: string; product: string; country: string | null } | null>(null);
  const [offerRow, setOfferRow] = useState<Row | null>(null);
  const [sortBy, setSortBy] = useState<SortKey>("last_event");
  const [productFilter, setProductFilter] = useState<string>("__all__");
  const [countryFilter, setCountryFilter] = useState<string>("__all__");

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
          // Branch dashboard: active board only (unloaded → /archive).
          if (unloadedShip || cancelled) return null;
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
            supplier_name: null,
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
              supplierId: undefined,
            }),
            is_real_shipment_code: isRealShipmentCode(s?.code),
            // Last operational event for the row, used as default sort.
            // BVP updated_at fires on price/freight changes; falls back to ETA.
            last_event_at: (v?.updated_at as string | undefined) ?? s?.eta ?? null,
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
      (pendingOffers ?? [])
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
                last_event_at: o.expected_eta ?? null,
              } as Row;
            });


    return [...materialized, ...pending];
  }, [dists, items, ships, managers, shipMgrs, offerCreators, baselines, bvps, pendingOffers, bridgeOffers]);


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

  const viewRows = mainRows;

  const filteredRows = useMemo(() => {
    const baseRows = viewRows;
    const matched = baseRows.filter((r) => {
      if (productFilter !== "__all__" && r.product !== productFilter) return false;
      if (countryFilter !== "__all__") {
        const c = r.country ? toUaCountry(r.country) : "";
        if (c !== countryFilter) return false;
      }
      return true;
    });
    const sorted = [...matched];
    const cmp = (a: Row, b: Row): number => {
      switch (sortBy) {
        case "product":
          return a.product.localeCompare(b.product, "uk");
        case "country":
          return toUaCountry(a.country ?? "").localeCompare(toUaCountry(b.country ?? ""), "uk");
        case "manager":
          return (a.manager_name ?? "").localeCompare(b.manager_name ?? "", "uk");
        case "eta":
          return (a.eta ?? "").localeCompare(b.eta ?? "");
        case "last_event":
        default: {
          // Most recent event first; rows without an event fall back to ETA.
          const av = a.last_event_at ?? a.eta ?? "";
          const bv = b.last_event_at ?? b.eta ?? "";
          return bv.localeCompare(av);
        }
      }
    };
    return sorted.sort(cmp);
  }, [viewRows, productFilter, countryFilter, sortBy]);


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

  // Filter option pools — product options from full view; country options narrow
  // to the currently selected product (so the two dropdowns compose naturally).
  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of viewRows) if (r.product) set.add(r.product);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk"))
      .map((v) => ({ value: v, label: v }));
  }, [viewRows]);
  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of viewRows) {
      if (productFilter !== "__all__" && r.product !== productFilter) continue;
      if (r.country) set.add(toUaCountry(r.country));
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk"))
      .map((v) => ({ value: v, label: v }));
  }, [viewRows, productFilter]);
  // If the selected country becomes invalid after product change, reset safely.
  useEffect(() => {
    if (countryFilter === "__all__") return;
    if (!countryOptions.some((o) => o.value === countryFilter)) {
      setCountryFilter("__all__");
    }
  }, [countryOptions, countryFilter]);

  // Top summary: shipments · unique products / product-country positions · pallets.
  const summary = useMemo(() => {
    const shipSet = new Set<string>();
    const productSet = new Set<string>();
    const posSet = new Set<string>();
    let pallets = 0;
    for (const r of filteredRows) {
      if (r.code && r.is_real_shipment_code) shipSet.add(r.code);
      const p = (r.product ?? "").trim().toLowerCase();
      if (p) productSet.add(p);
      const c = r.country ? toUaCountry(r.country).toLowerCase() : "";
      if (p) posSet.add(`${p}|${c}`);
      pallets += Number(r.pallets) || 0;
    }
    return {
      shipments: shipSet.size,
      products: productSet.size,
      positions: posSet.size,
      pallets,
    };
  }, [filteredRows]);

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: "last_event", label: "Остання подія" },
    { value: "eta", label: "Дата заходу" },
    { value: "product", label: "Товар" },
    { value: "country", label: "Країна" },
    { value: "manager", label: "Менеджер" },
  ];

  const productAliases = useProductAliases();
  const countryAliases = useCountryAliases();
  const drillRow = drillRows[0] ?? null;
  const drillCountry = drillRow ? (drillRow.country ? toUaCountry(drillRow.country) : "") : "";
  const drillExtras = useMemo(() => {
    if (!drillRow) return [] as Array<{ label: string; value: string }>;
    const xs: Array<{ label: string; value: string }> = [];
    if (drillRow.variety) xs.push({ label: "Сорт", value: drillRow.variety });
    if (drillRow.caliber) xs.push({ label: "Калібр", value: drillRow.caliber });
    if (drillRow.brand) xs.push({ label: "Бренд", value: drillRow.brand });
    if (drillRow.class) xs.push({ label: "Клас", value: drillRow.class });
    if (drillRow.packaging) xs.push({ label: "Упаковка", value: drillRow.packaging });
    return xs;
  }, [drillRow]);

  const positionsCount = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of filteredRows) {
      const product = (r.product ?? "").trim();
      if (!product) continue;
      const country = r.country ? toUaCountry(r.country) : "";
      const key = `${product}__${country}`;
      if (!seen.has(key)) seen.set(key, product);
    }
    const groups = Array.from(seen.entries()).map(([, product]) => ({ product }));
    return countPositionsFromGroups(groups, (g) => g.product);
  }, [filteredRows]);

  // Silence unused-state lint (kept to avoid touching data/handler logic).
  void sortBy; void setSortBy; void offerRow; void setOfferRow; void statsFor; void ackChange;

  return (
    <div
      className="space-y-4"
      data-branch-test={isMalekhiv ? "malekhiv" : undefined}
    >
      {!branchId && (
        <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm">
          Вам ще не призначено філію. Зверніться до адміністратора.
        </div>
      )}

      {rows.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Товар</label>
              <CompactFilterSelect
                value={productFilter}
                onChange={setProductFilter}
                options={productOptions}
                allLabel="Всі товари"
                allValue="__all__"
                aliases={productAliases}
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Країна походження</label>
              <CompactFilterSelect
                value={countryFilter}
                onChange={setCountryFilter}
                options={countryOptions}
                allLabel="Всі країни"
                allValue="__all__"
                aliases={countryAliases}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <div className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-muted-foreground">
              <span className="font-bold tabular-nums text-foreground">{summary.shipments}</span> пост. ·{" "}
              <span className="font-bold tabular-nums text-foreground">{formatPositions(positionsCount)}</span> поз. ·{" "}
              <span className="font-bold tabular-nums text-brand">{summary.pallets}п</span>
            </div>
          </div>
        </div>
      )}

      {distsPending || (!!branchId && dists === undefined && !distsError) ? (
        <div className="flex items-center justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        </div>
      ) : !filteredRows.length ? (
        <EmptyState
          title={productFilter !== "__all__" || countryFilter !== "__all__" ? "Немає товару за фільтром" : "Поки немає підтвердженого товару"}
        />
      ) : (
        <BranchFlatList
          rows={filteredRows}
          onOpen={(r) => setDrill({ key: r.key, product: r.product, country: r.country })}
        />
      )}

      <Dialog open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          {drillRow ? (
            <>
              <DialogHeader>
                <DialogTitle className="text-base">
                  {drillRow.product}
                  {drillCountry ? <span> · {drillCountry}</span> : null}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-secondary px-2 py-1.5">
                    <div className="text-[10px] text-muted-foreground">ETA</div>
                    <div className="text-sm font-bold tabular-nums">{drillRow.eta ?? "—"}</div>
                    <div className="mt-1 text-[11px] font-mono text-muted-foreground">{drillRow.code}</div>
                  </div>
                  <div className="rounded-lg bg-secondary px-2 py-1.5 text-right">
                    <div className="text-[10px] text-muted-foreground">Палети</div>
                    <div className="text-sm font-bold tabular-nums text-brand">{drillRow.pallets}п</div>
                    {drillRow.weight > 0 ? (
                      <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">{drillRow.weight.toFixed(0)} кг</div>
                    ) : null}
                  </div>
                </div>

                {drillExtras.length ? (
                  <ul className="space-y-1 rounded-xl border border-border px-3 py-2 text-xs">
                    {drillExtras.map((x) => (
                      <li key={x.label} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{x.label}:</span>
                        <span className="font-medium text-foreground">{x.value}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {(drillRow.indicative != null || drillRow.invoice != null) ? (
                  <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-xs">
                    <span className="text-muted-foreground">Собівартість</span>
                    <CostPair indicative={drillRow.indicative} invoice={drillRow.invoice} suffix=" кг" size="sm" />
                  </div>
                ) : null}

                {drillRow.manager_name ? (
                  <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-xs">
                    <span className="text-muted-foreground">Менеджер</span>
                    <span className="font-medium text-foreground">{drillRow.manager_name}</span>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

