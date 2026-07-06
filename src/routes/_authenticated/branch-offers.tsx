import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { EmptyState } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import {
  formatRemaining,
  type ManagerOffer,
  type ManagerOfferResponse,
} from "@/lib/manager-offers";
import {
  getBranchOfferStatus,
  toneClass,
  isRealShipmentCode,
} from "@/lib/branch-offer-status";
import { CostPair } from "@/components/CostPair";
import { CompactFilterSelect } from "@/components/CompactFilterSelect";
import { ShinyFilterSelect } from "@/components/ShinyFilterSelect";

const MALEKHIV_BRANCH_ID = "3bb65cb3-27a1-5f18-839a-340271d711fd";

import { useProductAliases } from "@/hooks/useProductAliases";
import { useCountryAliases } from "@/hooks/useCountryAliases";
import { toUaCountry, toShortUaCountry } from "@/lib/countries";
import { useRealtimeInvalidate } from "@/hooks/useRealtimeInvalidate";

const ALL = "__all";

// Short ETA formatter mirrored from branch "Вільно" / "Головна".
// Narrow no-break space (U+202F) tightens day + month inline without
// touching font-size, font-family, letter-spacing or line-height.
const fmtEtaShort = (eta: string | null | undefined): string => {
  if (!eta) return "—";
  const d = new Date(eta);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mo = d.toLocaleDateString("uk-UA", { month: "short" }).replace(/\.$/, "");
  return `${day}\u202F${mo}.`;
};

// Abbreviate manager name when row is tight: "Назар Лукач" → "Назар Л.".
// Mirrors the helper used in branch "Головна" / "Вільно".
const shortenManagerName = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[1].charAt(0)}.`;
};

// Local sliding segmented toggle, embedded into the same top control card
// as the two filters. One shared rounded body + one absolutely-positioned
// sliding plate. Kept local on purpose (no shared extraction in Stage 1).
function BucketToggle({
  value,
  onChange,
}: {
  value: "active" | "confirmed";
  onChange: (v: "active" | "confirmed") => void;
}) {
  return (
    <div
      className={cn(
        "relative grid h-9 grid-cols-2 rounded-full border-2 bg-muted p-1 text-sm transition-colors",
        value === "active"
          ? "border-destructive"
          : "border-emerald-600",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-background shadow-sm transition-transform duration-200 ease-out",
          value === "confirmed" && "translate-x-full",
        )}
      />
      <button
        type="button"
        onClick={() => onChange("active")}
        className={cn(
          "relative z-10 rounded-full text-center transition-colors",
          value === "active" ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        Активні
      </button>
      <button
        type="button"
        onClick={() => onChange("confirmed")}
        className={cn(
          "relative z-10 rounded-full text-center transition-colors",
          value === "confirmed" ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        Підтверджені
      </button>
    </div>
  );
}

type OfferWithEtaPrev = ManagerOffer & { prev_expected_eta?: string | null };

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("uk-UA") : "—";

export const Route = createFileRoute("/_authenticated/branch-offers")({
  validateSearch: (s: Record<string, unknown>) => ({
    openOffer: typeof s.openOffer === "string" ? s.openOffer : undefined,
  }),
  component: BranchOffersPage,
});

function BranchOffersPage() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id ?? null;
  const qc = useQueryClient();
  const search = Route.useSearch();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [fProduct, setFProduct] = useState<string>(ALL);
  const [fCountry, setFCountry] = useState<string>(ALL);
  const [bucket, setBucket] = useState<"active" | "confirmed">("active");
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const productAliases = useProductAliases();
  const countryAliases = useCountryAliases();

  const invalidateOfferWorkflowQueries = async () => {
    const keys = [
      ["branch-active-offers"],
      ["my-branch-responses"],
      ["branch-offer-shipments"],
      ["nav-branch-manager-offers"],
      ["manager-offers"],
      ["manager-offer-responses"],
      ["manager-offer-targets"],
      ["manager-offer-linked-shipments"],
      ["link-dialog-offer"],
      ["shipments-link-options"],
      ["nav-pending-manager-responses"],
      ["dash-manager"],
    ] as const;
    await Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey })));
  };

  // Deep-link from /o/<token>: auto-open the targeted offer once on mount.
  // RLS has already filtered out offers this branch cannot see, so an unknown
  // id simply has no matching row and the dialog stays closed.
  useEffect(() => {
    if (search.openOffer && selectedOfferId !== search.openOffer) {
      setSelectedOfferId(search.openOffer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.openOffer]);

  useRealtimeInvalidate(
    `branch-offers-${branchId ?? "none"}`,
    [
      "manager_offers",
      "manager_offer_responses",
      "manager_offer_targets",
      "manager_offer_allocation_parts",
      "shipments",
      "shipment_items",
    ],
    [
      ["branch-active-offers"],
      ["my-branch-responses", branchId],
      ["branch-offer-shipments"],
      ["nav-branch-manager-offers", branchId],
    ],
    !!branchId,
  );





  const { data: offers, isLoading } = useQuery({
    queryKey: ["branch-active-offers"],
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () => {
      // P1 stabilization: limit to 300 newest offers and to last 30 days,
      // so the branch screen does not process unbounded test history.
      // Active workflow (status filter) and 7-day display cutoff are unchanged below.
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("manager_offers")
        .select("*")
        .in("status", ["active", "in_work", "confirmed", "linked", "closed", "expired", "deleted"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as ManagerOffer[];
    },
  });

  const { data: myResponses } = useQuery({
    queryKey: ["my-branch-responses", branchId],
    enabled: !!branchId,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () => {
      // P1 stabilization: cap to 500 most recent responses for this branch.
      const { data, error } = await supabase
        .from("manager_offer_responses")
        .select("*")
        .eq("branch_id", branchId!)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ManagerOfferResponse[];
    },
  });

  const { data: shipments } = useQuery({
    queryKey: ["branch-offer-shipments"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("shipments_branch").select("id,code,eta,arrived_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const managerIds = useMemo(
    () => Array.from(new Set((offers ?? []).map((o) => o.created_by).filter(Boolean))),
    [offers],
  );

  const { data: managerNames } = useQuery({
    queryKey: ["offer-manager-names", managerIds],
    enabled: managerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_profile_names", { _ids: managerIds });
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string | null }[];
    },
  });

  const responseByOffer = useMemo(() => {
    const m: Record<string, ManagerOfferResponse> = {};
    for (const r of myResponses ?? []) m[r.offer_id] = r;
    return m;
  }, [myResponses]);

  // "Про ЗЕД" 48h cancellation notice.
  // A branch sees a row here when the offer was cancelled by the manager AND
  // this branch had asked for pallets but was NOT confirmed (approved is
  // null OR <= 0) AND was NOT refused (refused_at is null). Rows self-expire
  // 48h after the offer's updated_at. Confirmed (approved > 0) branches go
  // through red archive "Скасовано"; refused branches go through red archive
  // "Відмовлено" — neither appears here.
  const proZedNotices = useMemo(() => {
    const list = offers ?? [];
    const cutoffMs = Date.now() - 48 * 60 * 60 * 1000;
    return list
      .filter((o) => {
        if (o.status !== "deleted") return false;
        const updatedMs = new Date(o.updated_at).getTime();
        if (!Number.isFinite(updatedMs) || updatedMs < cutoffMs) return false;
        const myR = responseByOffer[o.id];
        if (!myR) return false;
        if (myR.refused_at) return false;
        if (myR.approved_pallets != null && Number(myR.approved_pallets) > 0) return false;
        return true;
      })
      .map((o) => {
        const myR = responseByOffer[o.id]!;
        return {
          offerId: o.id,
          productName: o.product_name,
          requestedPallets: Number(myR.requested_pallets ?? 0),
          cancelledAt: o.updated_at,
        };
      });
  }, [offers, responseByOffer]);



  const baseVisibleOffers = useMemo(() => {
    const list = offers ?? [];
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return list.filter((o) => {
      // Once this branch has been explicitly refused on this offer, the row
      // belongs to Tropik Archive — not the active workflow. Hide it from
      // both Активні and Підтверджені buckets.
      const myR = responseByOffer[o.id];
      if (myR?.refused_at) return false;
      // Deleted/cancelled offers belong to Tropik Archive — never show in active workflow,
      // even when a branch response exists (defense-in-depth against fallback below).
      if (o.status === "deleted") return false;
      // Legacy terminal zero-approved cleanup ONLY: pre-rule rows where the offer was
      // closed and this branch's response was left at approved_pallets=0 without an
      // explicit refused_at path. These belong to Archive (Build H backfill), not the
      // active workflow. Does NOT change refusal semantics for new responses.
      if (
        o.status === "closed" &&
        myR &&
        myR.approved_pallets === 0 &&
        myR.refused_at == null &&
        (myR.requested_pallets ?? 0) > 0
      ) {
        return false;
      }
      if (["active", "in_work", "confirmed", "linked"].includes(o.status)) return true;
      if (!myR) return false;
      const ts = new Date((o as ManagerOffer & { updated_at?: string }).updated_at ?? o.created_at).getTime();
      return ts >= cutoff;
    });
  }, [offers, responseByOffer]);


  const managerNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of managerNames ?? []) if (r.full_name) m[r.id] = r.full_name;
    return m;
  }, [managerNames]);

  const shipmentById = useMemo(() => {
    const m: Record<string, { code: string; eta: string | null; arrived_at: string | null }> = {};
    for (const s of shipments ?? []) m[s.id] = { code: s.code, eta: s.eta, arrived_at: (s as { arrived_at: string | null }).arrived_at };
    return m;
  }, [shipments]);

  const shipCodeOf = (o: ManagerOffer): string | null =>
    o.linked_shipment_id ? shipmentById[o.linked_shipment_id]?.code ?? null : null;

  // Bucket-base rows: branch-visible rows minus those that left the workflow
  // (real shipment code). NO product/country filter applied yet — these feed
  // both filter-option derivation and final row rendering. No sort here; the
  // per-bucket ordering below is the source of truth.
  const bucketBaseRows = useMemo(() => {
    return baseVisibleOffers.filter((o) => {
      if (!isRealShipmentCode(shipCodeOf(o))) return true;
      // Keep the row even when a real shipment code exists if this branch
      // still has remaining confirmed quantity (approved − linked > 0).
      const r = responseByOffer[o.id] ?? null;
      const approved = r && r.approved_pallets != null && Number(r.approved_pallets) > 0
        ? Number(r.approved_pallets)
        : 0;
      const linked = r
        ? Number((r as ManagerOfferResponse & { linked_pallets?: number }).linked_pallets ?? 0)
        : 0;
      return Math.max(approved - linked, 0) > 0;
    });
  }, [baseVisibleOffers, responseByOffer]);

  // Split unfiltered bucket-base into active/confirmed by status kind, and
  // apply the per-bucket default grouping rules.
  const { activeBase, confirmedBase } = useMemo(() => {
    type Bucket = "waiting" | "offer" | "confirmed";
    const tagged: Array<{ o: ManagerOffer; bucket: Bucket; ts: string }> = [];
    for (const o of bucketBaseRows) {
      const r = responseByOffer[o.id] ?? null;
      // Local remaining: if this branch still has approved-but-not-yet-linked
      // pallets, the row belongs in "Підтверджені" regardless of whether the
      // offer already has a real shipment code for the linked part.
      const approved = r && r.approved_pallets != null && Number(r.approved_pallets) > 0
        ? Number(r.approved_pallets)
        : 0;
      const linked = r
        ? Number((r as ManagerOfferResponse & { linked_pallets?: number }).linked_pallets ?? 0)
        : 0;
      const remaining = Math.max(approved - linked, 0);
      const offerTs =
        ((o as ManagerOffer & { updated_at?: string }).updated_at as string | undefined) ??
        o.created_at;
      if (remaining > 0) {
        // Підтверджені: latest manager action first (response.updated_at, fallback offer).
        const ts = (r?.updated_at as string | undefined) ?? offerTs;
        tagged.push({ o, bucket: "confirmed", ts });
        continue;
      }
      const st = getBranchOfferStatus(o, r, shipCodeOf(o));
      if (st.kind === "confirmed") {
        const ts = (r?.updated_at as string | undefined) ?? offerTs;
        tagged.push({ o, bucket: "confirmed", ts });
      } else if (r && r.requested_pallets != null && Number(r.requested_pallets) > 0
        && r.approved_pallets == null && !(r as any).refused_at) {
        // Block 1: branch sent a request, waiting on manager — sort by
        // branch action timestamp (response.updated_at), latest first.
        const ts = (r.updated_at as string | undefined) ?? r.created_at ?? offerTs;
        tagged.push({ o, bucket: "waiting", ts });
      } else {
        // Block 2: unanswered manager offers — sort by manager offer
        // updated_at (fallback created_at), latest first.
        tagged.push({ o, bucket: "offer", ts: offerTs });
      }
    }
    const a: ManagerOffer[] = [];
    const c: ManagerOffer[] = [];
    // Підтверджені: latest manager action first.
    const confirmed = tagged.filter((t) => t.bucket === "confirmed")
      .sort((x, y) => (y.ts ?? "").localeCompare(x.ts ?? ""));
    for (const t of confirmed) c.push(t.o);
    // Активні: Block 1 (waiting), then Block 2 (offer), each sorted by ts DESC.
    const waiting = tagged.filter((t) => t.bucket === "waiting")
      .sort((x, y) => (y.ts ?? "").localeCompare(x.ts ?? ""));
    const offered = tagged.filter((t) => t.bucket === "offer")
      .sort((x, y) => (y.ts ?? "").localeCompare(x.ts ?? ""));
    for (const t of waiting) a.push(t.o);
    for (const t of offered) a.push(t.o);
    return { activeBase: a, confirmedBase: c };
  }, [bucketBaseRows, responseByOffer, shipmentById]);

  // Filter options scoped to the currently selected bucket, with mutual
  // cross-axis filtering (product options narrow by selected country, and
  // vice versa) so the two dropdowns stay consistent with what is rendered.
  const currentBase = bucket === "active" ? activeBase : confirmedBase;

  const productOptions = useMemo(() => {
    const src = fCountry === ALL
      ? currentBase
      : currentBase.filter((o) => o.origin_country === fCountry);
    return Array.from(new Set(src.map((o) => o.product_name).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "uk"));
  }, [currentBase, fCountry]);

  const countryOptions = useMemo(() => {
    const src = fProduct === ALL
      ? currentBase
      : currentBase.filter((o) => o.product_name === fProduct);
    return Array.from(
      new Set(src.map((o) => o.origin_country).filter(Boolean) as string[]),
    ).sort((a, b) => a.localeCompare(b, "uk"));
  }, [currentBase, fProduct]);

  // If the previously selected filter value is no longer present in the
  // current bucket (e.g. after switching Активні ↔ Підтверджені), reset
  // it to "all" so the list never becomes silently empty.
  useEffect(() => {
    if (fProduct !== ALL && !productOptions.includes(fProduct)) {
      setFProduct(ALL);
    }
  }, [productOptions, fProduct]);
  useEffect(() => {
    if (fCountry !== ALL && !countryOptions.includes(fCountry)) {
      setFCountry(ALL);
    }
  }, [countryOptions, fCountry]);

  // Final rendered rows per bucket, with product/country filters applied.
  const { activeRows, confirmedRows } = useMemo(() => {
    const apply = (list: ManagerOffer[]) =>
      list.filter((o) => {
        if (fProduct !== ALL && o.product_name !== fProduct) return false;
        if (fCountry !== ALL && o.origin_country !== fCountry) return false;
        return true;
      });
    return { activeRows: apply(activeBase), confirmedRows: apply(confirmedBase) };
  }, [activeBase, confirmedBase, fProduct, fCountry]);




  const submit = useMutation({
    mutationFn: async ({ offerId, pallets }: { offerId: string; pallets: number }) => {
      if (!branchId) throw new Error("Філія не вказана у профілі");
      if (!Number.isFinite(pallets) || pallets <= 0) {
        throw new Error("Кількість палет має бути більше 0");
      }
      const existing = responseByOffer[offerId];
      if (existing) {
        if ((existing as any).refused_at != null) {
          throw new Error("Менеджер відмовив у цьому запиті — редагування недоступне");
        }
        if (existing.approved_pallets != null) {
          throw new Error("Запит вже підтверджено менеджером — редагування недоступне");
        }
        const changed = Number(existing.requested_pallets) !== pallets;
        const { error } = await supabase
          .from("manager_offer_responses")
          .update(
            changed
              ? { requested_pallets: pallets, approved_pallets: null }
              : { requested_pallets: pallets },
          )
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("manager_offer_responses")
          .insert({ offer_id: offerId, branch_id: branchId, requested_pallets: pallets });
        if (error) throw error;
      }
    },
    onSuccess: async (_, vars) => {
      toast.success("Запит надіслано", { id: `req-${vars.offerId}`, duration: 1500 });
      await invalidateOfferWorkflowQueries();
      // Block 2: auto-close the detail dialog after a successful request,
      // returning the user to the compact "Пропозиції" table.
      setSelectedOfferId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelRequest = useMutation({
    mutationFn: async (responseId: string) => {
      const { error } = await supabase
        .from("manager_offer_responses")
        .delete()
        .eq("id", responseId);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Запит скасовано", { duration: 1500 });
      await invalidateOfferWorkflowQueries();
      setSelectedOfferId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });


  if (!branchId) {
    return (
      <div>
        <PageHeader title="Пропозиції ЗЕД" />
        <EmptyState title="Філія не вказана" hint="Зверніться до адміністратора" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Пропозиції ЗЕД"
      />
      {proZedNotices.length > 0 && (
        <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">
            Про ЗЕД
          </div>
          <ul className="space-y-1 text-sm">
            {proZedNotices.map((n) => (
              <li key={n.offerId} className="text-foreground">
                <span className="text-destructive">Пропозиція скасована</span>
                {" — "}
                <span className="font-medium">{n.productName}</span>
                {" ("}
                <span className="tabular-nums">{n.requestedPallets}п</span>
                {")"}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mb-3 rounded-xl border border-border bg-card p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
              Товар
            </label>
            {branchId === MALEKHIV_BRANCH_ID ? (
              <ShinyFilterSelect
                value={fProduct}
                onChange={setFProduct}
                options={productOptions.map((p) => ({ value: p, label: p }))}
                allLabel="Всі товари"
                allValue={ALL}
              />
            ) : (
              <CompactFilterSelect
                value={fProduct}
                onChange={setFProduct}
                options={productOptions.map((p) => ({ value: p, label: p }))}
                allLabel="Усі товари"
                allValue={ALL}
                aliases={productAliases}
              />
            )}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
              Країна походження
            </label>
            {branchId === MALEKHIV_BRANCH_ID ? (
              <ShinyFilterSelect
                value={fCountry}
                onChange={setFCountry}
                options={countryOptions.map((c) => ({ value: c, label: c }))}
                allLabel="Всі країни"
                allValue={ALL}
              />
            ) : (
              <CompactFilterSelect
                value={fCountry}
                onChange={setFCountry}
                options={countryOptions.map((c) => ({ value: c, label: c }))}
                allLabel="Усі країни"
                allValue={ALL}
                aliases={countryAliases}
              />
            )}
          </div>
        </div>
        <BucketToggle value={bucket} onChange={setBucket} />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Завантаження…</p>}

      {(() => {
        const rows = bucket === "active" ? activeRows : confirmedRows;
        if (!isLoading && rows.length === 0) {
          return (
            <EmptyState
              title={
                bucket === "active"
                  ? "Немає активних пропозицій"
                  : "Немає підтверджених пропозицій"
              }
            />
          );
        }
        if (rows.length === 0) return null;





        return (
          <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <ul className="divide-y divide-border" data-malekhiv-card={branchId === MALEKHIV_BRANCH_ID ? "" : undefined}>
              {rows.map((o) => {
                const r = responseByOffer[o.id];
                const ship = o.linked_shipment_id ? shipmentById[o.linked_shipment_id] : null;
                const etaIso = ship?.arrived_at ?? ship?.eta ?? o.expected_eta ?? null;
                const mgrRaw = managerNameById[o.created_by] ?? "";

                // Left-line width budget mirrored from "Вільно".
                const countryFull = o.origin_country ? toUaCountry(o.origin_country) : "";
                const countryShortRaw = o.origin_country ? toShortUaCountry(o.origin_country) : "";
                const variety = o.variety ?? "";
                const fullLeftLen = (o.product_name?.length ?? 0) + countryFull.length + variety.length;
                const useShortCountry =
                  fullLeftLen > 28 && !!countryShortRaw && countryShortRaw !== countryFull;
                const country = useShortCountry ? `${countryShortRaw}.` : countryFull;
                const tailParts: string[] = [];
                if (country) tailParts.push(country);
                if (variety) tailParts.push(variety);
                const tail = tailParts.length ? ` · ${tailParts.join(" · ")}` : "";

                // Meta line width budget for manager shortening.
                const etaStr = fmtEtaShort(etaIso);
                const metaApproxLen = 4 + etaStr.length + (mgrRaw ? 3 + mgrRaw.length : 0);
                const mgr = mgrRaw && metaApproxLen > 34 ? shortenManagerName(mgrRaw) : mgrRaw;

                // Pallet area — Stage 1 rules.
                const apprQty = r?.approved_pallets != null ? Number(r.approved_pallets) : null;
                const reqQty = r?.requested_pallets != null ? Number(r.requested_pallets) : 0;
                const offered = o.offered_pallets != null ? Number(o.offered_pallets) : null;

                let palletNode: React.ReactNode = null;
                if (bucket === "confirmed") {
                  // Show REMAINING confirmed pallets (approved − linked),
                  // not original approved. Example: approved 8, linked 6 → 2п.
                  const linkedQ = r
                    ? Number((r as ManagerOfferResponse & { linked_pallets?: number }).linked_pallets ?? 0)
                    : 0;
                  const remainingQ = apprQty != null && apprQty > 0
                    ? Math.max(apprQty - linkedQ, 0)
                    : 0;
                  const shown = remainingQ > 0 ? remainingQ : (apprQty != null && apprQty > 0 ? apprQty : 0);
                  if (shown > 0) {
                    palletNode = (
                      <span className="m-pal text-sm font-bold tabular-nums text-foreground">
                        {shown}п
                      </span>
                    );
                  }
                } else {
                  // Active bucket
                  const showApproved = apprQty != null && apprQty > 0; // rare safety case
                  const showRequested = !showApproved && reqQty > 0;
                  if (showApproved) {
                    palletNode = (
                      <span className="m-pal text-sm font-bold tabular-nums text-foreground">
                        {apprQty}п
                      </span>
                    );
                  } else if (offered != null && showRequested) {
                    palletNode = (
                      <span className="m-pal text-sm font-bold tabular-nums">
                        <span className="text-foreground">{offered}п</span>
                        <span className="ml-1 text-warning">·{reqQty}п</span>
                      </span>
                    );
                  } else if (showRequested) {
                    palletNode = (
                      <span className="m-pal text-sm font-bold tabular-nums text-warning">
                        {reqQty}п
                      </span>
                    );
                  } else if (offered != null) {
                    palletNode = (
                      <span className="m-pal text-sm font-bold tabular-nums text-foreground">
                        {offered}п
                      </span>
                    );
                  }
                }

                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedOfferId(o.id)}
                      className="m-row w-full py-2 text-left text-sm active:opacity-70"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="m-main min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm text-foreground">
                          <span className="font-bold">{o.product_name}</span>
                          {tail ? <span>{tail}</span> : null}
                        </div>
                        {palletNode ? <span className="shrink-0">{palletNode}</span> : null}
                      </div>
                      <div className="m-meta mt-0.5 flex items-baseline justify-between gap-2 text-[11px] font-normal text-muted-foreground">
                        <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                          <span className="font-mono font-semibold text-sky-600 dark:text-sky-300">
                            {"ETA\u202F"}{etaStr}
                          </span>
                          {mgr ? (
                            <span className="text-foreground/80"> · {mgr}</span>
                          ) : null}
                        </div>
                        <span className="shrink-0">
                          <CostPair
                            indicative={o.indicative_cost_usd}
                            invoice={o.invoice_cost_usd}
                            size="xs"
                          />
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })()}


      {/*
        Detail dialog — reuses the EXISTING big offer card in full
        (no information removed: caliber, variety, brand, packaging,
        specification, comments, pallets, price, ETA, actions).
        Row click opens it; on successful "Запитати" the submit
        mutation closes it automatically.
      */}
      <Dialog
        open={!!selectedOfferId}
        onOpenChange={(open) => { if (!open) setSelectedOfferId(null); }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto w-[calc(100vw-1.5rem)] sm:max-w-lg p-0"
          onOpenAutoFocus={(e) => {
            // Read-first: do NOT auto-focus the pallet input on mobile,
            // otherwise iOS pops the keyboard the moment the row is tapped.
            e.preventDefault();
          }}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Деталі пропозиції</DialogTitle>
          </DialogHeader>
          {(() => {
            const o = bucketBaseRows.find((x) => x.id === selectedOfferId);
            if (!o) return null;
            const r = responseByOffer[o.id];
            const draft = drafts[o.id] ?? (r ? String(r.requested_pallets) : "");
            const ship = o.linked_shipment_id ? shipmentById[o.linked_shipment_id] : null;

            const indDelta =
              o.prev_indicative_cost_usd != null
                ? Number(o.indicative_cost_usd ?? 0) - Number(o.prev_indicative_cost_usd)
                : 0;
            const invDelta =
              o.prev_invoice_cost_usd != null
                ? Number(o.invoice_cost_usd ?? 0) - Number(o.prev_invoice_cost_usd)
                : 0;

            const reqQty = r ? Number(r.requested_pallets) : 0;
            const apprQty = r?.approved_pallets != null ? Number(r.approved_pallets) : null;
            const cancelledSupply = o.status === "deleted";
            const linkedQty = r ? Number((r as ManagerOfferResponse & { linked_pallets?: number }).linked_pallets ?? 0) : 0;
            const pendingQty = apprQty != null ? Math.max(apprQty - linkedQty, 0) : 0;
            const isSplit = o.status === "linked" && linkedQty > 0 && pendingQty > 0;

            const etaDate = ship?.arrived_at
              ? { label: "Дата прибуття", value: new Date(ship.arrived_at).toLocaleDateString("uk-UA") }
              : ship?.eta
              ? { label: "Очікувана дата", value: new Date(ship.eta).toLocaleDateString("uk-UA") }
              : o.expected_eta
              ? { label: "Очікувана дата", value: new Date(o.expected_eta).toLocaleDateString("uk-UA"), plan: true }
              : null;

            const details = [o.variety, o.caliber, o.packaging, o.specification]
              .filter(Boolean)
              .join(" • ");

            return (
              <div
                className={cn(
                  "p-4",
                  cancelledSupply ? "bg-destructive/5" : undefined,
                )}
              >
                {/* Header: product (country) + status (single source of truth) */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-bold">{o.product_name}</span>
                  {o.origin_country && (
                    <span className="text-sm text-muted-foreground">({o.origin_country})</span>
                  )}
                  {isSplit ? (
                    <>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase bg-primary/15 text-primary">
                        Замовлено · {linkedQty}
                      </span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase bg-warning/15 text-warning">
                        Очікує номер · {pendingQty}*
                      </span>
                    </>
                  ) : (() => {
                    const st = getBranchOfferStatus(o, r ?? null, ship?.code ?? null);
                    return (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                          toneClass(st.tone),
                        )}
                      >
                        {st.label}
                      </span>
                    );
                  })()}
                  {ship && isRealShipmentCode(ship.code) && (
                    <span className="text-sm text-success">
                      Поставка <b>{ship.code}</b>
                    </span>
                  )}
                </div>


                {isSplit && (
                  <div className="mt-1 text-xs text-warning">
                    * {pendingQty}п чекають на номер поставки
                  </div>
                )}

                {/* Details line */}
                {details && (
                  <div className="mt-1 text-sm text-muted-foreground">{details}</div>
                )}

                {/* Costs */}
                <div className="mt-2 space-y-0.5">
                  <CostLine
                    label="Собівартість індикативна"
                    tone="success"
                    curr={Number(o.indicative_cost_usd ?? 0)}
                    prev={o.prev_indicative_cost_usd}
                    delta={indDelta}
                    linked={o.status === "linked"}
                  />
                  <CostLine
                    label="Собівартість інвойсна"
                    tone="destructive"
                    curr={Number(o.invoice_cost_usd ?? 0)}
                    prev={o.prev_invoice_cost_usd}
                    delta={invDelta}
                    linked={o.status === "linked"}
                  />
                </div>

                {/* Responsible manager */}
                {managerNameById[o.created_by] && (
                  <div className="mt-1 text-sm text-muted-foreground">
                    Відповідальний менеджер:{" "}
                    <b className="text-foreground">{managerNameById[o.created_by]}</b>
                  </div>
                )}

                {/* Expected date */}
                {etaDate && (
                  <div className="mt-1 text-sm text-info">
                    {etaDate.label}:{" "}
                    <b className="text-info tabular-nums">{etaDate.value}</b>
                    {etaDate.plan && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">(план)</span>
                    )}
                  </div>
                )}

                {/* ETA change notice */}
                {o.status === "linked" && (o as OfferWithEtaPrev).prev_expected_eta &&
                  (o as OfferWithEtaPrev).prev_expected_eta !== o.expected_eta && (
                  <div className="mt-1 rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
                    <b>Дата заходу змінена:</b> було{" "}
                    <span className="line-through tabular-nums">
                      {fmtDate((o as OfferWithEtaPrev).prev_expected_eta)}
                    </span>{" "}
                    → стало <b className="tabular-nums">{fmtDate(o.expected_eta)}</b>
                  </div>
                )}

                {/* Available quantity */}
                {o.offered_pallets != null && (
                  <div className="mt-1 text-sm text-muted-foreground">
                    Доступна кількість: <b className="text-foreground tabular-nums">{o.offered_pallets}</b> палет
                  </div>
                )}

                {o.expires_at && (
                  <div className="mt-1 text-sm text-muted-foreground">
                    Залишок: <b className="text-foreground">{formatRemaining(o.expires_at)}</b>
                  </div>
                )}

                {/* Desired quantity input + actions */}
                {/* Correction 1 — branch lock after manager answer or once
                    offer leaves "active": hide input + "Оновити"/"Запитати"
                    so branch cannot correct, refuse, or reset a manager-set
                    response. Read-only summary below stays visible. */}
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  {(() => {
                    const responseLocked = !!r && (r.approved_pallets != null || (r as any).refused_at != null);
                    const offerInactive = o.status !== "active";
                    if (responseLocked || offerInactive) return null;
                    return (
                      <>
                        <label className="text-sm">
                          <span className="mb-1 block text-muted-foreground">Бажана кількість, палет</span>
                          <Input
                            type="number"
                            min={0}
                            className="h-9 w-32 font-bold tabular-nums"
                            value={draft}
                            onChange={(e) => setDrafts((p) => ({ ...p, [o.id]: e.target.value }))}
                          />
                        </label>
                        <Button
                          size="sm"
                          onClick={() => {
                            // Client-side guard: refuse to submit if locked.
                            if (!!r && (r.approved_pallets != null || (r as any).refused_at != null)) return;
                            if (o.status !== "active") return;
                            const n = Number(draft);
                            if (!Number.isFinite(n) || n <= 0) {
                              toast.error("Введіть кількість більше 0");
                              return;
                            }
                            submit.mutate({ offerId: o.id, pallets: n });
                          }}
                        >
                          {r ? "Оновити" : "Запитати"}
                        </Button>
                      </>
                    );
                  })()}


                  {r && o.status === "active" && r.approved_pallets == null && (r as any).refused_at == null && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={cancelRequest.isPending}
                      onClick={() => cancelRequest.mutate(r.id)}
                    >
                      Скасувати запит
                    </Button>
                  )}


                  {r && (
                    <div className="ml-auto text-right text-sm">
                      <div className="text-muted-foreground">
                        Запит: <b className="text-foreground tabular-nums">{reqQty}</b>
                      </div>
                      {apprQty != null && (
                        <>
                          <div className="text-muted-foreground">
                            Підтверджено:{" "}
                            <b className="text-foreground tabular-nums">
                              {apprQty === reqQty
                                ? `${apprQty}`
                                : apprQty < reqQty
                                ? `${apprQty} з ${reqQty}`
                                : `${apprQty}`}
                            </b>
                          </div>
                          {apprQty > 0 && apprQty < reqQty && (
                            <div className="text-[11px] text-muted-foreground">
                              {reqQty - apprQty} не підтверджено
                            </div>
                          )}
                          {apprQty > reqQty && (
                            <div className="text-[11px] text-warning">
                              Перевірте: підтверджено більше, ніж запит
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

    </div>
  );
}

function CostLine({
  label,
  tone,
  curr,
  prev,
  delta,
  linked,
}: {
  label: string;
  tone: "success" | "destructive";
  curr: number;
  prev: number | null;
  delta: number;
  linked?: boolean;
}) {
  // Suppress "from same to same" noise: only show the change when the
  // post-rounding (2-decimal) delta is actually non-zero.
  const roundedDelta = Math.round(delta * 100) / 100;
  const changed = prev != null && roundedDelta !== 0;
  const toneCls = tone === "success" ? "text-success" : "text-destructive";
  return (
    <div className={cn("text-sm", toneCls)}>
      <span>{label}: </span>
      <b className="font-bold tabular-nums">${curr.toFixed(2)}</b>
      {changed && !linked && (
        <>
          <span className="ml-1 text-xs font-normal text-muted-foreground line-through">
            ${Number(prev).toFixed(2)}
          </span>
          <span
            className={cn(
              "ml-1 text-xs font-bold",
              roundedDelta < 0 ? "text-success" : "text-destructive",
            )}
          >
            ({roundedDelta > 0 ? "+" : ""}
            {roundedDelta.toFixed(2)})
          </span>
        </>
      )}
      {changed && linked && (
        <div
          className={cn(
            "mt-0.5 rounded-md px-2 py-1 text-xs font-normal",
            roundedDelta > 0
              ? "bg-destructive/10 text-destructive"
              : "bg-success/10 text-success",
          )}
        >
          <b>Собівартість змінено:</b> було{" "}
          <span className="line-through tabular-nums">${Number(prev).toFixed(2)}</span>{" "}
          → стало <b className="tabular-nums">${curr.toFixed(2)}</b>{" "}
          <b className="tabular-nums">
            ({roundedDelta > 0 ? "+" : ""}
            {roundedDelta.toFixed(2)})
          </b>
        </div>
      )}
    </div>
  );
}
