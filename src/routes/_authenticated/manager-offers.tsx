import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Link2, Trash2, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { EmptyState } from "@/components/cards";
import { TableScroller } from "@/components/TableScroller";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  STATUS_LABEL,
  STATUS_CLASS,
  formatRemaining,
  type ManagerOffer,
  type ManagerOfferResponse,
  type ManagerOfferStatus,
  type ManagerOfferTarget,
} from "@/lib/manager-offers";
import { Checkbox } from "@/components/ui/checkbox";
import { useCountryOptions } from "@/hooks/useCountryOptions";
import { useCountryAliases } from "@/hooks/useCountryAliases";
import { computeOfferCost, fetchCustomsRef, isEuCountry, type CustomsRefRow } from "@/lib/offer-cost";
import { getLatestEurUsdRate } from "@/lib/currency";
import { resolveCountry } from "@/lib/country-search";
import { useVarietiesFor } from "@/hooks/useProductVarieties";
import { VarietyAutocomplete } from "@/components/VarietyAutocomplete";
import { resolveProductOption } from "@/lib/product-aliases";
import { useProductAliases } from "@/hooks/useProductAliases";
import { AutocompleteCell } from "@/components/AutocompleteCell";
import { CustomsStatusChip } from "@/components/CustomsStatusChip";
import { CustomsManualOverrideField } from "@/components/CustomsManualOverrideField";
import { CUSTOMS_STRINGS, getCustomsStatusFromRef, type CustomsStatus } from "@/lib/customs-status";
import { attachOfferToPosition, rollbackBirthPosition } from "@/lib/position-attach";

// Basic Ukrainian -> Latin transliteration so typing "Хі" matches "HELLENIC".
const UA_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie",
  ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "",
  ю: "iu", я: "ia", "'": "",
};
function uaToLat(s: string) {
  return s.toLowerCase().split("").map((ch) => UA_LAT[ch] ?? ch).join("");
}
// Basic Latin -> Ukrainian (rough) so typing English ("av") matches UA ("Авокадо").
const LAT_UA: Record<string, string> = {
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х",
  i: "і", j: "й", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п",
  q: "к", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс",
  y: "и", z: "з",
};
function latToUa(s: string) {
  return s.toLowerCase().split("").map((ch) => LAT_UA[ch] ?? ch).join("");
}
function matchesQuery(option: string, query: string) {
  if (!query) return false;
  const o = option.toLowerCase();
  const q = query.toLowerCase();
  if (o.startsWith(q)) return true;
  if (o.startsWith(uaToLat(q))) return true;
  if (o.startsWith(latToUa(q))) return true;
  if (uaToLat(o).startsWith(uaToLat(q))) return true;
  return false;
}

function resolveOption(
  value: string,
  options: string[],
  aliases?: Record<string, string>,
): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (!aliases) {
    const productResolved = resolveProductOption(value, options);
    if (productResolved) return productResolved;
  }
  const direct = options.find((o) => o.toLowerCase() === v);
  if (direct) return direct;
  if (aliases && aliases[v]) {
    const target = aliases[v].toLowerCase();
    const aliased = options.find((o) => o.toLowerCase() === target);
    if (aliased) return aliased;
    return aliases[v];
  }
  // Unique transliterated/prefix fallback
  const subs = options.filter((o) => matchesQuery(o, v));
  if (subs.length === 1) return subs[0];
  return null;
}

function VarietyField({ value, productName, onChange }: { value: string; productName: string; onChange: (v: string) => void }) {
  const varieties = useVarietiesFor(productName);
  return <VarietyAutocomplete value={value} onChange={onChange} varieties={varieties} placeholder="Почніть вводити сорт" />;
}

function ValidatedAutocomplete({
  value,
  onChange,
  options,
  aliases,
  placeholder,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  aliases?: Record<string, string>;
  placeholder?: string;
  required?: boolean;
}) {
  // Unified with shipments товарні позиції via AutocompleteCell — same
  // word-start matching, alias ranking, transliteration, and resolve-on-blur.
  // Visual wrapper preserves the full-size Input + "Значення відсутнє в базі"
  // error text used by the Нова пропозиція dialog.
  const trimmed = value.trim();
  const normalizedOptions = useMemo(
    () => Array.from(new Set(options.map((o) => o.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "uk")),
    [options],
  );
  const canonical = useMemo(
    () => resolveOption(trimmed, normalizedOptions, aliases),
    [trimmed, normalizedOptions, aliases],
  );
  const isInvalid = trimmed.length > 0 && !canonical;
  const showRequired = required && trimmed.length === 0;

  return (
    <div className="space-y-1">
      <AutocompleteCell
        value={value}
        onChange={onChange}
        options={normalizedOptions}
        aliases={aliases}
        placeholder={placeholder}
        required={!!required}
        expandedMinWidth={240}
        className={cn(
          "h-10 border border-input bg-background px-3 text-sm",
          (isInvalid || showRequired) &&
            "border-destructive bg-destructive/10 focus:border-destructive",
        )}
      />
      {isInvalid && (
        <div className="text-xs text-destructive">Значення відсутнє в базі</div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/manager-offers")({
  component: ManagerOffersPage,
});

type OfferWithResponses = ManagerOffer & {
  responses: (ManagerOfferResponse & { branch_name?: string })[];
  targetBranchIds: string[];
};

const EMPTY_TARGET_IDS: string[] = [];

function toBranchSelection(branchIds: string[]) {
  const next: Record<string, boolean> = {};
  for (const branchId of branchIds) next[branchId] = true;
  return next;
}

function ManagerOffersPage() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole(["admin", "super_admin"]);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ManagerOffer | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<string>("active");
  
  const [linkOffer, setLinkOffer] = useState<OfferWithResponses | null>(null);
  const [publishOffer, setPublishOffer] = useState<ManagerOffer | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  function focusOffer(offerId: string, offerStatus: ManagerOfferStatus) {
    // Switch to the tab that contains this offer
    if (["active", "in_work", "confirmed", "closed"].includes(offerStatus)) setTab("active");
    else if (offerStatus === "draft") setTab("drafts");
    else if (offerStatus === "linked") setTab("linked");
    else if (offerStatus === "expired") setTab("archive");
    
    setHighlightedId(offerId);
    setDetailOfferId(offerId);
    setTimeout(() => setHighlightedId((cur) => (cur === offerId ? null : cur)), 2600);
  }

  const { data: branches } = useQuery({
    queryKey: ["branches-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("branches").select("id,name").order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: offers, isLoading } = useQuery({
    queryKey: ["manager-offers", user?.id, isAdmin],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase
        .from("manager_offers")
        .select("*")
        .neq("status", "deleted")
        .order("created_at", { ascending: false });
      if (!isAdmin) {
        // Position-anchor visibility: include rows the user created OR rows
        // attached to a position where the user is the responsible manager.
        // Legacy rows (position_id IS NULL) keep working via created_by.
        const { data: ownedPositions } = await supabase
          .from("operational_positions")
          .select("position_id")
          .eq("owner_user_id", user!.id);
        const positionIds = (ownedPositions ?? [])
          .map((p) => (p as { position_id: string }).position_id)
          .filter(Boolean);
        if (positionIds.length > 0) {
          q = q.or(
            `created_by.eq.${user!.id},position_id.in.(${positionIds.join(",")})`,
          );
        } else {
          q = q.eq("created_by", user!.id);
        }
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ManagerOffer[];
    },
  });

  const offerIds = useMemo(() => (offers ?? []).map((o) => o.id), [offers]);

  const { data: responses } = useQuery({
    queryKey: ["manager-offer-responses", offerIds],
    enabled: offerIds.length > 0,
    // Auto-refresh: keep counters live (Запр./Очік./Підтв.) without manual reload.
    refetchInterval: 25_000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_offer_responses")
        .select("*")
        .in("offer_id", offerIds);
      if (error) throw error;
      return (data ?? []) as ManagerOfferResponse[];
    },
  });

  const { data: targets } = useQuery({
    queryKey: ["manager-offer-targets", offerIds],
    enabled: offerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_offer_targets")
        .select("*")
        .in("offer_id", offerIds);
      if (error) throw error;
      return (data ?? []) as ManagerOfferTarget[];
    },
  });

  const linkedShipmentIds = useMemo(
    () =>
      Array.from(
        new Set(
          (offers ?? [])
            .map((o) => o.linked_shipment_id)
            .filter((v): v is string => !!v),
        ),
      ),
    [offers],
  );

  const { data: linkedShipments } = useQuery({
    queryKey: ["manager-offer-linked-shipments", linkedShipmentIds],
    enabled: linkedShipmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id,code,eta,arrived_at")
        .in("id", linkedShipmentIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const shipmentEtaById = useMemo(() => {
    const m: Record<string, { code: string; eta: string | null; arrived_at: string | null }> = {};
    for (const s of linkedShipments ?? []) {
      m[s.id] = { code: s.code, eta: s.eta, arrived_at: (s as { arrived_at: string | null }).arrived_at };
    }
    return m;
  }, [linkedShipments]);

  const creatorIds = useMemo(
    () => Array.from(new Set((offers ?? []).map((o) => o.created_by).filter(Boolean))),
    [offers],
  );

  const { data: creators } = useQuery({
    queryKey: ["manager-offer-creators", creatorIds],
    enabled: creatorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name")
        .in("id", creatorIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const creatorById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of creators ?? []) m[c.id] = c.full_name ?? "—";
    return m;
  }, [creators]);

  // Responsible-manager resolution: read directly from
  // manager_offers.import_manager_id and resolve the name via
  // import_managers.full_name. created_by is only shown as "Створив".
  const managerIdsForOffers = useMemo(
    () => Array.from(new Set((offers ?? []).map((o) => o.import_manager_id).filter((v): v is string => !!v))),
    [offers],
  );

  const { data: offerManagers } = useQuery({
    queryKey: ["manager-offer-import-managers", managerIdsForOffers],
    enabled: managerIdsForOffers.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("import_managers")
        .select("id,full_name")
        .in("id", managerIdsForOffers);
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string | null }[];
    },
  });

  const managerNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of offerManagers ?? []) m[r.id] = r.full_name ?? "—";
    return m;
  }, [offerManagers]);

  // Returns { label, pending, actor } for the "Відповідальний" column.
  // Source of truth: manager_offers.import_manager_id (business manager).
  // "Створив" only shown when creator differs from responsible manager.
  function getResponsible(o: ManagerOffer): {
    label: string;
    pending: boolean;
    actor: string | null;
    isLegacy: boolean;
  } {
    const managerId = o.import_manager_id;
    if (!managerId) {
      // Legacy row predating responsible-manager enforcement.
      return {
        label: creatorById[o.created_by] ?? "—",
        pending: false,
        actor: null,
        isLegacy: true,
      };
    }
    const managerName = managerNameById[managerId] ?? "—";
    const creatorName = creatorById[o.created_by] ?? null;
    const actor = creatorName && creatorName !== managerName ? creatorName : null;
    return {
      label: managerName,
      pending: false,
      actor,
      isLegacy: false,
    };
  }

  const branchById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const b of branches ?? []) m[b.id] = b.name;
    return m;
  }, [branches]);

  const merged: OfferWithResponses[] = useMemo(() => {
    return (offers ?? []).map((o) => ({
      ...o,
      responses: (responses ?? [])
        .filter((r) => r.offer_id === o.id)
        .map((r) => ({ ...r, branch_name: branchById[r.branch_id] })),
      targetBranchIds: (targets ?? [])
        .filter((t) => t.offer_id === o.id)
        .map((t) => t.branch_id),
    }));
  }, [offers, responses, targets, branchById]);

  const getPendingLinked = (offer: OfferWithResponses) => {
    const inScope = (branchId: string) =>
      offer.target_mode === "all" || offer.targetBranchIds.includes(branchId);
    const activeResponses = offer.responses.filter((r) => inScope(r.branch_id));
    const totalApproved = activeResponses.reduce(
      (sum, r) => sum + Number(r.approved_pallets ?? r.requested_pallets ?? 0),
      0,
    );
    const totalLinked = activeResponses.reduce(
      (sum, r) => sum + Number((r as ManagerOfferResponse & { linked_pallets?: number }).linked_pallets ?? 0),
      0,
    );
    return Math.max(totalApproved - totalLinked, 0);
  };

  const filtered = useMemo(() => {
    if (tab === "all") return merged;
    if (tab === "drafts") return merged.filter((o) => o.status === "draft");
    if (tab === "active")
      return merged.filter((o) =>
        ["active", "in_work", "confirmed", "closed"].includes(o.status)
        || (o.status === "linked" && getPendingLinked(o) > 0),
      );
    if (tab === "linked") return merged.filter((o) => o.status === "linked" && getPendingLinked(o) === 0);
    if (tab === "archive")
      return merged.filter((o) => o.status === "expired");
    return merged;
  }, [merged, tab]);

  // Responses from branches while the offer is still open (not closed/linked/expired).
  // Yellow = new / changed and manager hasn't (re)confirmed (approved_pallets is null
  // or no longer matches the latest requested amount). White = manager already responded.
  const pendingItems = useMemo(() => {
    const items: {
      offerId: string;
      offerStatus: ManagerOfferStatus;
      productName: string;
      originCountry: string | null;
      branchName: string;
      requested: number;
      createdAt: string;
      isPending: boolean;
    }[] = [];
    const openStatuses: ManagerOfferStatus[] = ["draft", "active", "in_work", "confirmed"];
    for (const o of merged) {
      if (!openStatuses.includes(o.status)) continue;
      const inScope = (branchId: string) =>
        o.target_mode === "all" || o.targetBranchIds.includes(branchId);
      for (const r of o.responses) {
        if (!inScope(r.branch_id)) continue;
        const requested = Number(r.requested_pallets ?? 0);
        const approved = r.approved_pallets;
        // Yellow only while manager has not yet responded. Any approved value
        // (including 0 / partial) counts as "responded" → white. The row goes
        // yellow again only if the branch later edits requested_pallets, which
        // resets approved_pallets back to null (see branch-offers submit).
        const isPending = approved == null;
        if (!isPending) continue;
        items.push({
          offerId: o.id,
          offerStatus: o.status,
          productName: o.product_name,
          originCountry: o.origin_country ?? null,
          branchName: r.branch_name ?? "Філія",
          requested,
          createdAt: (r as { created_at?: string }).created_at ?? "",
          isPending,
        });
      }
    }
    return items.sort((a, b) => {
      if (a.isPending !== b.isPending) return a.isPending ? -1 : 1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
  }, [merged]);

  const pendingCount = useMemo(
    () => pendingItems.filter((p) => p.isPending).length,
    [pendingItems],
  );

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ManagerOfferStatus }) => {
      const { error } = await supabase.from("manager_offers").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manager-offers"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateApproved = useMutation({
    mutationFn: async ({ id, approved }: { id: string; approved: number | null }) => {
      const { error } = await supabase
        .from("manager_offer_responses")
        .update({ approved_pallets: approved })
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, approved }) => {
      // Optimistic update so the UI (input value + status pill) updates instantly
      await qc.cancelQueries({ queryKey: ["manager-offer-responses"] });
      const prev = qc.getQueriesData<ManagerOfferResponse[]>({ queryKey: ["manager-offer-responses"] });
      for (const [key, data] of prev) {
        if (!data) continue;
        qc.setQueryData<ManagerOfferResponse[]>(key, data.map((r) =>
          r.id === id ? { ...r, approved_pallets: approved } : r,
        ));
      }
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) for (const [key, data] of ctx.prev) qc.setQueryData(key, data);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["manager-offer-responses"] }),
  });

  const approveAllPending = useMutation({
    mutationFn: async () => {
      const pending: { id: string; requested: number }[] = [];
      for (const o of merged) {
        const inScope = (branchId: string) =>
          o.target_mode === "all" || o.targetBranchIds.includes(branchId);
        for (const r of o.responses) {
          if (r.approved_pallets == null && inScope(r.branch_id)) {
            pending.push({ id: r.id, requested: Number(r.requested_pallets ?? 0) });
          }
        }
      }
      if (!pending.length) return { ok: 0, failed: 0 };
      const results = await Promise.all(
        pending.map((p) =>
          supabase
            .from("manager_offer_responses")
            .update({ approved_pallets: p.requested })
            .eq("id", p.id),
        ),
      );
      const failed = results.filter((r) => r.error).length;
      return { ok: pending.length - failed, failed };
    },
    onSuccess: ({ ok, failed }) => {
      if (ok > 0) toast.success(`Підтверджено відгуків: ${ok}`);
      if (failed > 0) toast.error(`Не вдалося підтвердити: ${failed}`);
      qc.invalidateQueries({ queryKey: ["manager-offer-responses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [showAllPending, setShowAllPending] = useState(false);

  const [detailOfferId, setDetailOfferId] = useState<string | null>(null);
  const detailOffer = useMemo(
    () => merged.find((o) => o.id === detailOfferId) ?? null,
    [merged, detailOfferId],
  );

  // Legacy text-matching path: only authoritative for rows without a
  // position_id. New position-anchored rows must NOT use product_name +
  // origin_country + caliber as identity — they will use position_id-based
  // attach in a follow-up step.
  const detailOfferPositionId = (detailOffer as (ManagerOffer & { position_id?: string | null }) | null)?.position_id ?? null;
  const detailLegacyLinkEnabled = !!detailOffer && !!user && !detailOfferPositionId;
  const { data: detailLinkableCount } = useQuery({
    queryKey: [
      "detail-offer-linkable",
      detailOffer?.id,
      detailOffer?.product_name,
      detailOffer?.origin_country,
      detailOffer?.caliber,
      user?.id,
    ],
    enabled: detailLegacyLinkEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id,created_by,shipment_items(id,product_name,origin_country,caliber,pallet_count)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
      const target = norm(detailOffer!.product_name);
      const targetCountry = norm(detailOffer!.origin_country);
      const targetCaliber = norm(detailOffer!.caliber);
      const mine = (data ?? []).filter(
        (s: { created_by?: string | null }) => s.created_by === user!.id,
      );
      type SI = { id: string; product_name: string; origin_country: string | null; caliber: string | null; pallet_count: number | null };
      const candidateItemIds: string[] = [];
      for (const s of mine as { shipment_items: SI[] | null }[]) {
        for (const i of s.shipment_items ?? []) {
          if (norm(i.product_name) !== target) continue;
          if (targetCountry && norm(i.origin_country) !== targetCountry) continue;
          if (targetCaliber && norm(i.caliber) !== targetCaliber) continue;
          candidateItemIds.push(i.id);
        }
      }
      if (!candidateItemIds.length) return 0;
      // Filter to items that still have undistributed pallets.
      const { data: dis, error: e2 } = await supabase
        .from("distribution_items")
        .select("shipment_item_id,pallets,reserved_pallets")
        .in("shipment_item_id", candidateItemIds);
      if (e2) throw e2;
      const used = new Map<string, number>();
      for (const d of (dis ?? []) as { shipment_item_id: string; pallets: number | null; reserved_pallets: number | null }[]) {
        const v = Math.max(Number(d.pallets ?? 0), Number(d.reserved_pallets ?? 0));
        used.set(d.shipment_item_id, (used.get(d.shipment_item_id) ?? 0) + v);
      }
      // Need original pallet_count → re-walk mine to map id→pallet_count
      const palletCountById = new Map<string, number>();
      for (const s of mine as { shipment_items: SI[] | null }[]) {
        for (const i of s.shipment_items ?? []) {
          palletCountById.set(i.id, Number(i.pallet_count ?? 0));
        }
      }
      let count = 0;
      for (const id of candidateItemIds) {
        const total = palletCountById.get(id) ?? 0;
        const u = used.get(id) ?? 0;
        // Undistributed if no allocations yet, or total pallets > distributed.
        if (total <= 0 || u < total) count++;
      }
      return count;
    },
  });
  const hasLinkable = (detailLinkableCount ?? 0) > 0;

  return (
    <div>
      <PageHeader
        title="Запропонувати"
        subtitle="Пропозиції товарів для філій до створення поставки"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> Створити
          </Button>
        }
      />

      {/* Cleanup Pack #2: верхній блок "Нові відгуки від філій" прибрано —
          заявки тепер обробляються через таблицю (колонка "Очік." підсвічує
          необроблені, клік по рядку відкриває detail з підтвердженням). */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active">Активні</TabsTrigger>
          <TabsTrigger value="drafts">Чернетки</TabsTrigger>
          <TabsTrigger value="linked">Прив'язані</TabsTrigger>
          <TabsTrigger value="archive">Архів</TabsTrigger>
          <TabsTrigger value="all">Усі</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4 space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">Завантаження…</p>}
          {!isLoading && filtered.length === 0 && (
            <EmptyState title="Немає пропозицій" hint="Натисніть «Створити», щоб додати першу" />
          )}
          {filtered.length > 0 && (
            <TableScroller className="rounded-2xl border border-border bg-card shadow-sm">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-[11px] uppercase text-muted-foreground [&_th]:bg-table-head [&_th]:backdrop-blur [&_th]:font-bold">
                  <tr>
                    <th className="px-2 py-2 text-left">Товар</th>
                    <th className="px-1 py-2 text-center w-10">Ст.</th>
                    <th className="px-2 py-2 text-right w-14">Запр.</th>
                    <th className="px-2 py-2 text-right w-14">Очік.</th>
                    <th className="px-2 py-2 text-right w-14">Підтв.</th>
                    <th className="px-2 py-2 text-right w-20">Собів.</th>
                    {isAdmin && <th className="px-2 py-2 text-left">Менеджер</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o) => {
                    const inScope = (branchId: string) =>
                      o.target_mode === "all" || o.targetBranchIds.includes(branchId);
                    const activeResponses = o.responses.filter((r) => inScope(r.branch_id));
                    // Запр. — what manager offered to branches (null/0 → "—")
                    const offered = o.offered_pallets;
                    // Очік. — sum of branch requests not yet processed by manager
                    const totalPending = activeResponses.reduce(
                      (s, r) =>
                        s + (r.approved_pallets == null ? Number(r.requested_pallets ?? 0) : 0),
                      0,
                    );
                    // Підтв. — sum of manager-confirmed pallets
                    const totalApproved = activeResponses.reduce(
                      (s, r) => s + Number(r.approved_pallets ?? 0),
                      0,
                    );
                    const totalLinked = activeResponses.reduce(
                      (s, r) => s + Number((r as ManagerOfferResponse & { linked_pallets?: number }).linked_pallets ?? 0),
                      0,
                    );
                    const pendingLinked = o.status === "linked"
                      ? Math.max(totalApproved - totalLinked, 0)
                      : 0;
                    const hasPending = totalPending > 0;

                    // Compact status: green Активно / yellow В роботі.
                    // "Замовлено" is NOT used here — it belongs to the shipments table.
                    let stColor = "bg-success";
                    let stTitle = "Активно";
                    if (
                      o.status === "in_work" ||
                      o.status === "confirmed" ||
                      o.status === "closed" ||
                      (o.status === "linked" && pendingLinked > 0)
                    ) {
                      stColor = "bg-warning";
                      stTitle = "В роботі";
                    } else if (o.status === "draft") {
                      stColor = "bg-muted-foreground";
                      stTitle = "Чернетка";
                    } else if (o.status === "expired") {
                      stColor = "bg-destructive";
                      stTitle = "Прострочено";
                    }

                    return (
                      <tr
                        key={o.id}
                        id={`offer-${o.id}`}
                        onClick={() => setDetailOfferId(o.id)}
                        className={cn(
                          "cursor-pointer border-t border-border transition hover:bg-accent/40",
                          hasPending && "bg-amber-50/60 dark:bg-amber-500/5",
                          highlightedId === o.id && "ring-2 ring-amber-400",
                        )}
                      >
                        <td className="px-2 py-2 font-semibold">
                          <div className="truncate">{o.product_name}</div>
                          {(o.origin_country || o.caliber) && (
                            <div className="truncate text-[11px] font-normal text-muted-foreground">
                              {o.origin_country ?? ""}
                              {o.origin_country && o.caliber ? " · " : ""}
                              {o.caliber ?? ""}
                            </div>
                          )}
                        </td>
                        <td className="px-1 py-2 text-center">
                          <span
                            title={stTitle}
                            className={cn(
                              "inline-block h-2.5 w-2.5 rounded-full",
                              stColor,
                            )}
                          />
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {offered != null && Number(offered) > 0 ? Number(offered) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {totalPending > 0 ? (
                            <span className="font-semibold text-warning">{totalPending}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {totalApproved > 0 ? (
                            <span className="font-semibold text-success">{totalApproved}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-[12px]">
                          <span className="text-success">${Number(o.indicative_cost_usd ?? 0).toFixed(2)}</span>
                          <span className="text-muted-foreground"> · </span>
                          <span className="text-destructive">${Number(o.invoice_cost_usd ?? 0).toFixed(2)}</span>
                        </td>
                        {isAdmin && (
                          <td className="px-2 py-2 text-muted-foreground">
                            {(() => {
                              const r = getResponsible(o);
                              return (
                                <span className={r.pending ? "italic text-warning" : undefined}>
                                  {r.label}
                                </span>
                              );
                            })()}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroller>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!detailOffer} onOpenChange={(v) => !v && setDetailOfferId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {detailOffer && (() => {
            const o = detailOffer;
            const inScope = (branchId: string) =>
              o.target_mode === "all" || o.targetBranchIds.includes(branchId);
            const activeResponses = o.responses.filter((r) => inScope(r.branch_id));
            const excludedResponses = o.responses.filter((r) => !inScope(r.branch_id));
            const totalRequested = activeResponses.reduce(
              (s, r) => s + Number(r.requested_pallets || 0),
              0,
            );
            const totalApproved = activeResponses.reduce(
              (s, r) => s + Number(r.approved_pallets ?? r.requested_pallets ?? 0),
              0,
            );
            const totalLinked = activeResponses.reduce(
              (s, r) => s + Number((r as ManagerOfferResponse & { linked_pallets?: number }).linked_pallets ?? 0),
              0,
            );
            const pendingLinked = o.status === "linked"
              ? Math.max(totalApproved - totalLinked, 0)
              : 0;
            // STAGE 3A gate: strict loadable math for "Створити поставку /
            // Підтягнути / Прив'язати" actions. Uses confirmed approved_pallets
            // ONLY — no `?? requested_pallets` fallback — so unconfirmed branch
            // requests do not enable the load path (which would dead-end at
            // "Немає вільних палет за цією пропозицією" in shipment prefill).
            const confirmedStrict = activeResponses.reduce(
              (s, r) => s + Number(r.approved_pallets ?? 0),
              0,
            );
            const linkedStrict = activeResponses.reduce(
              (s, r) =>
                s +
                Number(
                  (r as ManagerOfferResponse & { linked_pallets?: number })
                    .linked_pallets ?? 0,
                ),
              0,
            );
            const loadableNow = Math.max(confirmedStrict - linkedStrict, 0);
            const pendingOchik = activeResponses.reduce(
              (s, r) =>
                s +
                (r.approved_pallets == null
                  ? Number(r.requested_pallets ?? 0)
                  : 0),
              0,
            );
            const canLoad = loadableNow > 0;
            const allLinkedExhausted =
              !canLoad && confirmedStrict > 0 && linkedStrict >= confirmedStrict;
            const blockReason: string | null = canLoad
              ? null
              : pendingOchik > 0
                ? `Спочатку підтвердіть кількість палет для філій (Очік. ${pendingOchik}).`
                : allLinkedExhausted
                  ? "Усі підтверджені палети вже прив'язані до поставки."
                  : null;
            const over = o.offered_pallets != null && totalApproved > o.offered_pallets;
            const canEditTargeting = !["closed", "expired", "linked"].includes(o.status);
            const ship = o.linked_shipment_id ? shipmentEtaById[o.linked_shipment_id] : null;
            const realEta = ship?.arrived_at ?? ship?.eta ?? null;
            const showEta = realEta ?? o.expected_eta;
            const isReal = !!realEta;
            const details = [o.packaging, o.specification, o.variety].filter(Boolean).join(" • ");
            return (
              <div>
                <DialogHeader>
                  <DialogTitle className="flex flex-wrap items-center gap-2">
                    {o.product_name}
                    {o.origin_country && (
                      <span className="text-sm text-muted-foreground">{o.origin_country}</span>
                    )}
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                        STATUS_CLASS[o.status],
                      )}
                    >
                      {STATUS_LABEL[o.status]}
                    </span>
                  </DialogTitle>
                </DialogHeader>

                <div className="mt-3 space-y-2 text-sm">
                  {o.caliber && (
                    <div>
                      <span className="text-muted-foreground">Калібр: </span>
                      <b>{o.caliber}</b>
                    </div>
                  )}
                  {details && (
                    <div className="text-muted-foreground">
                      {details}
                    </div>
                  )}
                  <div>
                    <span className="text-success">Інд: <b>${Number(o.indicative_cost_usd ?? 0).toFixed(2)}</b></span>
                    <span className="text-muted-foreground"> · </span>
                    <span className="text-destructive">Інв: <b>${Number(o.invoice_cost_usd ?? 0).toFixed(2)}</b></span>
                    {o.expires_at && (
                      <span className="ml-2 text-muted-foreground">
                        Залишок: {formatRemaining(o.expires_at)}
                      </span>
                    )}
                  </div>
                  {showEta && (
                    <div>
                      <span className="text-muted-foreground">{isReal ? "ETA поставки:" : "Очікувана дата:"}</span>{" "}
                      <b className={isReal ? "text-success" : ""}>
                        {new Date(showEta).toLocaleDateString("uk-UA")}
                      </b>
                      {!isReal && (
                        <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">(план)</span>
                      )}
                    </div>
                  )}
                  {o.linked_shipment_id && ship && (
                    <div>
                      <span className="text-muted-foreground">Поставка: </span>
                      <Link
                        to="/shipments"
                        className="font-semibold text-primary underline-offset-2 hover:underline"
                        onClick={() => setDetailOfferId(null)}
                      >
                        {ship.code}
                      </Link>
                    </div>
                  )}
                  {(() => {
                    const r = getResponsible(o);
                    return (
                      <>
                        <div>
                          <span className="text-muted-foreground">
                            {r.isLegacy ? "Менеджер: " : "Відповідальний: "}
                          </span>
                          <b className={r.pending ? "italic text-warning" : undefined}>
                            {r.label}
                          </b>
                        </div>
                        {!r.isLegacy && r.actor && (
                          <div className="text-xs text-muted-foreground">
                            Створив: <b>{r.actor}</b>
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">Цільові філії:</span>
                    {o.target_mode === "all" ? (
                      <b>Всі філії</b>
                    ) : (
                      <b>
                        Вибірково:{" "}
                        {o.targetBranchIds.length === 0
                          ? "—"
                          : o.targetBranchIds.map((id) => branchById[id] ?? id).join(", ")}
                      </b>
                    )}
                    {canEditTargeting && o.status !== "draft" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={() => setPublishOffer(o)}
                      >
                        <Pencil className="mr-1 h-3 w-3" /> Змінити
                      </Button>
                    )}
                  </div>
                  <div className={cn("text-sm font-semibold", over && "text-destructive")}>
                    {o.offered_pallets != null
                      ? `${o.offered_pallets} / ${totalApproved} палет`
                      : `${totalApproved} палет`}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      запит: {totalRequested}
                    </span>
                    {pendingLinked > 0 && (
                      <span className="ml-2 text-xs font-normal text-warning">
                        · у поставці: {totalLinked} · чекають номер поставки: {pendingLinked}
                      </span>
                    )}
                  </div>
                  {pendingLinked > 0 && (
                    <div className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                      <div className="mb-1 space-y-1">
                        <div>
                          До завантаження <b>{totalApproved}п</b>.
                          {ship ? <> У поставку <b>{ship.code}</b> помістилось <b>{totalLinked}п</b>.</> : <> Уже помістилось <b>{totalLinked}п</b>.</>}
                        </div>
                        <div>
                          Решта <b>{pendingLinked}п</b> залишається підтвердженою та чекатиме наступну поставку.
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {canLoad ? (
                          <Link
                            to="/shipments/new"
                            search={{ fromOffer: o.id } as never}
                            onClick={() => setDetailOfferId(null)}
                          >
                            <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
                              <Plus className="mr-1 h-3 w-3" /> Створити поставку для решти
                            </Button>
                          </Link>
                        ) : blockReason ? (
                          <div className="text-xs text-warning">{blockReason}</div>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-warning hover:bg-warning/10 hover:text-warning"
                          onClick={() => setDetailOfferId(null)}
                        >
                          Створю пізніше
                        </Button>
                      </div>
                    </div>
                  )}
                  {o.notes && (
                    <div className="rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">
                      {o.notes}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {o.status === "draft" && (
                    <Button size="sm" onClick={() => setPublishOffer(o)}>
                      Запропонувати
                    </Button>
                  )}
                  {o.status === "active" && (
                    <Button size="sm" onClick={() => setStatus.mutate({ id: o.id, status: "in_work" })}>
                      Взяти в роботу
                    </Button>
                  )}
                  {o.status === "closed" && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className={cn(
                          hasLinkable
                            ? "border-success/40 bg-success/15 text-success hover:bg-success/25 hover:text-success"
                            : "border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive",
                        )}
                        onClick={() => {
                          if (hasLinkable) {
                            setLinkOffer(o);
                          } else {
                            toast.message("Немає підходящої поставки", {
                              description: "Створіть нову поставку — товар не знайдено в наявних незаповнених поставках.",
                            });
                          }
                        }}
                        title={
                          hasLinkable
                            ? "Є відповідна поставка з нерозподіленим товаром"
                            : "Немає поставки з таким товаром, країною та калібром"
                        }
                      >
                        <Link2 className="mr-1 h-3.5 w-3.5" /> Підтягнути
                      </Button>
                      <Link
                        to="/shipments/new"
                        search={{ fromOffer: o.id } as never}
                        onClick={() => setDetailOfferId(null)}
                      >
                        <Button size="sm">
                          <Plus className="mr-1 h-3.5 w-3.5" /> Створити нову поставку
                        </Button>
                      </Link>
                    </>
                  )}
                  {(o.status === "confirmed" || o.status === "in_work") && (
                    hasLinkable ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-success/40 bg-success/15 text-success hover:bg-success/25 hover:text-success"
                        onClick={() => setLinkOffer(o)}
                      >
                        <Link2 className="mr-1 h-3.5 w-3.5" /> Прив'язати до поставки
                      </Button>
                    ) : (
                      <Link
                        to="/shipments/new"
                        search={{ fromOffer: o.id } as never}
                        onClick={() => setDetailOfferId(null)}
                      >
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-destructive/40 bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive"
                          title="Немає підходящої поставки — створіть нову"
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" /> Створити поставку
                        </Button>
                      </Link>
                    )
                  )}
                  {!["closed", "expired", "linked"].includes(o.status) && (
                    <Button size="sm" variant="outline" onClick={() => setEditing(o)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Редагувати
                    </Button>
                  )}
                  {!["closed", "expired", "linked"].includes(o.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setStatus.mutate({ id: o.id, status: "closed" })}
                    >
                      Закрити
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setStatus.mutate({ id: o.id, status: "deleted" });
                      setDetailOfferId(null);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="mt-4">
                  <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                    Відгуки ({activeResponses.length}
                    {excludedResponses.length > 0 && ` +${excludedResponses.length}`})
                  </div>
                  {o.responses.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Поки немає відгуків</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase text-muted-foreground">
                            <th className="py-1">Філія</th>
                            <th className="py-1">Запит</th>
                            <th className="py-1">Підтверджено</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...activeResponses, ...excludedResponses].map((r) => {
                            const excluded = !inScope(r.branch_id);
                            const cancelledSupply = o.status === "deleted";
                            const rejected = !cancelledSupply && r.approved_pallets === 0;
                            const linkedP = Number((r as ManagerOfferResponse & { linked_pallets?: number }).linked_pallets ?? 0);
                            const apprP = r.approved_pallets ?? Number(r.requested_pallets ?? 0);
                            const pendingP = o.status === "linked" ? Math.max(apprP - linkedP, 0) : 0;
                            return (
                              <tr
                                key={r.id}
                                className={cn(
                                  "border-t border-border",
                                  (excluded || rejected) && "opacity-60",
                                )}
                              >
                                <td className="py-1">
                                  {r.branch_name ?? r.branch_id}
                                  {excluded && (
                                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                                      виключено з таргетингу
                                    </span>
                                  )}
                                  {cancelledSupply && !excluded && (
                                    <span className="ml-2 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-destructive">
                                      Скасовано
                                    </span>
                                  )}
                                  {rejected && !excluded && (
                                    <span className="ml-2 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-destructive">
                                      Відмовлено
                                    </span>
                                  )}
                                </td>
                                <td className="py-1">{Number(r.requested_pallets)}</td>
                                <td className="py-1">
                                  <div className="flex items-center gap-1">
                                    <Input
                                      key={`${r.id}-${r.approved_pallets ?? "null"}`}
                                      className="h-8 w-20"
                                      type="number"
                                      min={0}
                                      disabled={excluded || rejected}
                                      defaultValue={r.approved_pallets ?? r.requested_pallets}
                                      onBlur={(e) => {
                                        const v = e.target.value === "" ? null : Number(e.target.value);
                                        if (v !== r.approved_pallets) {
                                          updateApproved.mutate({ id: r.id, approved: v });
                                        }
                                      }}
                                    />
                                    {pendingP > 0 && (
                                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                        у поставці: {linkedP}
                                      </span>
                                    )}
                                    {pendingP > 0 && (
                                      <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                                        чекає: {pendingP}
                                      </span>
                                    )}
                                    {!rejected && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 px-2 text-[11px] text-destructive hover:text-destructive"
                                        disabled={excluded || updateApproved.isPending}
                                        onClick={() => updateApproved.mutate({ id: r.id, approved: 0 })}
                                      >
                                        Відмовити
                                      </Button>
                                    )}
                                  </div>
                                </td>

                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>


      <OfferEditor
        open={creating || !!editing}
        offer={editing}
        branches={branches ?? []}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["manager-offers"] });
          qc.invalidateQueries({ queryKey: ["manager-offer-targets"] });
        }}
      />

      <LinkShipmentDialog
        offer={linkOffer}
        onClose={() => setLinkOffer(null)}
        onLinked={() => {
          setLinkOffer(null);
          qc.invalidateQueries({ queryKey: ["manager-offers"] });
        }}
      />

      <PublishOfferDialog
        offer={publishOffer}
        branches={branches ?? []}
        onClose={() => setPublishOffer(null)}
        onPublished={() => {
          setPublishOffer(null);
          qc.invalidateQueries({ queryKey: ["manager-offers"] });
          qc.invalidateQueries({ queryKey: ["manager-offer-targets"] });
          qc.invalidateQueries({ queryKey: ["manager-offer-targets-edit"] });
        }}
      />
    </div>
  );
}

type FormState = {
  product_name: string;
  origin_country: string;
  caliber: string;
  packaging: string;
  specification: string;
  variety: string;
  price_per_kg: string;
  price_currency: "EUR" | "USD";
  freight_amount: string;
  freight_currency: "EUR" | "USD";
  pallet_weight: string;
  offered_pallets: string;
  expires_in_hours: string;
  expected_eta: string;
  notes: string;
};

const emptyForm = (): FormState => ({
  product_name: "",
  origin_country: "",
  caliber: "",
  packaging: "",
  specification: "",
  variety: "",
  price_per_kg: "",
  price_currency: "EUR",
  freight_amount: "",
  freight_currency: "EUR",
  pallet_weight: "",
  offered_pallets: "",
  expires_in_hours: "",
  expected_eta: "",
  notes: "",
});

function offerToForm(offer: ManagerOffer): FormState {
  const o = offer as ManagerOffer & {
    price_per_kg?: number | null;
    price_currency?: "EUR" | "USD" | null;
    freight_amount?: number | null;
    freight_currency?: "EUR" | "USD" | null;
    pallet_weight?: number | null;
  };
  return {
    product_name: o.product_name ?? "",
    origin_country: o.origin_country ?? "",
    caliber: o.caliber ?? "",
    packaging: o.packaging ?? "",
    specification: o.specification ?? "",
    variety: o.variety ?? "",
    price_per_kg: o.price_per_kg != null ? String(o.price_per_kg) : "",
    price_currency: (o.price_currency ?? "EUR") as "EUR" | "USD",
    freight_amount: o.freight_amount != null ? String(o.freight_amount) : "",
    freight_currency: (o.freight_currency ?? "EUR") as "EUR" | "USD",
    pallet_weight: o.pallet_weight != null ? String(o.pallet_weight) : "",
    offered_pallets: o.offered_pallets != null ? String(o.offered_pallets) : "",
    expires_in_hours: "",
    expected_eta: o.expected_eta ?? "",
    notes: o.notes ?? "",
  };
}

type ItemEntry = {
  id: number;
  form: FormState;
  payload: Record<string, unknown> | null;
  customsStatus: CustomsStatus | null;
  /** For new offers (no existing offer.id): duty captured locally, applied via RPC at publish. */
  pendingDuty: number | null;
  /** For existing offers: server-confirmed duty (manager_offers.customs_override_duty_usd). */
  confirmedDuty: number | null;
};
let _itemSeq = 1;
const nextItemId = () => _itemSeq++;


function OfferEditor({
  open,
  offer,
  branches,
  onClose,
  onSaved,
}: {
  open: boolean;
  offer: ManagerOffer | null;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user, hasRole } = useAuth();
  const dbCountries = useCountryOptions();
  const countryAliases = useCountryAliases();
  const COUNTRY_OPTIONS = useMemo(() => dbCountries, [dbCountries]);
  const isAdmin = hasRole(["admin", "super_admin"]);

  const [items, setItems] = useState<ItemEntry[]>([]);
  const [selectiveOpen, setSelectiveOpen] = useState(false);
  const [selectedBranches, setSelectedBranches] = useState<Record<string, boolean>>({});
  const [selectedResponsibleManagerId, setSelectedResponsibleManagerId] = useState("");

  const { data: productOptions = [] } = useQuery({
    queryKey: ["product-dictionary-names"],
    queryFn: async () => {
      const [dictResult, varietiesResult] = await Promise.all([
        supabase.from("product_dictionary").select("product_name_ua").order("product_name_ua"),
        supabase.from("product_varieties").select("product_name_ua").range(0, 1999),
      ]);
      if (dictResult.error) throw dictResult.error;
      if (varietiesResult.error) throw varietiesResult.error;
      return Array.from(
        new Set([
          ...(dictResult.data ?? []).map((p) => p.product_name_ua as string),
          ...(varietiesResult.data ?? []).map((row) => row.product_name_ua as string),
        ].map((name) => name.trim()).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b, "uk"));
    },
  });

  const { data: currentManagerId, isLoading: currentManagerIdLoading } = useQuery({
    queryKey: ["current-import-manager-id", user?.id],
    enabled: !!user && !isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("current_import_manager_id");
      if (error) throw error;
      return (data as string | null) ?? null;
    },
  });

  const { data: activeManagers = [], isLoading: activeManagersLoading } = useQuery({
    queryKey: ["active-import-managers", "import-manager-role"],
    enabled: open && isAdmin,
    queryFn: async () => {
      // Selector must show ONLY active import_managers that are linked to a
      // real user with the 'import_manager' role. Exclude inactive rows,
      // rows without user_id, and rows whose user is admin/super_admin only.
      const { data: rows, error } = await supabase
        .from("import_managers")
        .select("id,full_name,is_active,user_id")
        .eq("is_active", true)
        .not("user_id", "is", null)
        .order("full_name");
      if (error) throw error;
      const candidates = (rows ?? []) as {
        id: string;
        full_name: string | null;
        is_active: boolean;
        user_id: string | null;
      }[];
      const userIds = candidates
        .map((r) => r.user_id)
        .filter((v): v is string => !!v);
      if (userIds.length === 0) return [];
      const { data: roleRows, error: roleError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "import_manager")
        .in("user_id", userIds);
      if (roleError) throw roleError;
      const valid = new Set((roleRows ?? []).map((r) => r.user_id as string));
      return candidates
        .filter((r) => r.user_id && valid.has(r.user_id))
        .map(({ id, full_name, is_active }) => ({ id, full_name, is_active }));
    },
  });

  const { data: fxRow } = useQuery({
    queryKey: ["latest-eur-usd-rate"],
    queryFn: () => getLatestEurUsdRate(),
    enabled: open,
    staleTime: 60_000,
  });

  const { data: existingTargets = EMPTY_TARGET_IDS } = useQuery({
    queryKey: ["manager-offer-editor-targets", offer?.id],
    enabled: !!offer && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_offer_targets")
        .select("branch_id")
        .eq("offer_id", offer!.id);
      if (error) throw error;
      return (data ?? []).map((item) => item.branch_id as string);
    },
  });

  const makeEntry = (form: FormState, confirmedDuty: number | null = null): ItemEntry => ({
    id: nextItemId(),
    form,
    payload: null,
    customsStatus: null,
    pendingDuty: null,
    confirmedDuty,
  });

  useEffect(() => {
    if (open) {
      const o = offer as (ManagerOffer & { customs_override_duty_usd?: number | null }) | null;
      const confirmed =
        o && o.customs_override_duty_usd != null ? Number(o.customs_override_duty_usd) : null;
      setItems([makeEntry(offer ? offerToForm(offer) : emptyForm(), confirmed)]);
      setSelectiveOpen(false);
      setSelectedResponsibleManagerId(offer?.import_manager_id ?? "");
    } else {
      setItems([]);
      setSelectedResponsibleManagerId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, offer?.id]);

  useEffect(() => {
    if (!open) {
      setSelectedBranches({});
      return;
    }
    if (offer?.target_mode === "selected") {
      setSelectedBranches(toBranchSelection(existingTargets));
    } else {
      setSelectedBranches({});
    }
  }, [open, offer?.id, offer?.target_mode, existingTargets]);

  const updateForm = (id: number, form: FormState) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, form } : it)));
  const updatePayload = (id: number, payload: Record<string, unknown> | null) =>
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const same = JSON.stringify(it.payload) === JSON.stringify(payload);
        return same ? it : { ...it, payload };
      }),
    );
  const updateCustoms = (
    id: number,
    patch: { customsStatus?: CustomsStatus | null; pendingDuty?: number | null; confirmedDuty?: number | null },
  ) =>
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const next = { ...it, ...patch };
        if (
          next.customsStatus === it.customsStatus &&
          next.pendingDuty === it.pendingDuty &&
          next.confirmedDuty === it.confirmedDuty
        ) {
          return it;
        }
        return next;
      }),
    );
  const removeItem = (id: number) =>
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.id !== id)));
  const addNew = () => setItems((prev) => [...prev, makeEntry(emptyForm())]);
  const addSimilar = () =>
    setItems((prev) => {
      const last = prev[prev.length - 1];
      const clone: FormState = last
        ? { ...last.form, offered_pallets: "", expires_in_hours: "" }
        : emptyForm();
      return [...prev, makeEntry(clone)];
    });


  const allValid = items.length > 0 && items.every((it) => it.payload !== null);

  // RED gate: each RED item must have a confirmed duty (existing) or a
  // pending duty captured locally (new). Used to disable publish buttons.
  const redBlocked = items.some(
    (it) =>
      it.customsStatus === "red" &&
      (offer
        ? it.confirmedDuty == null || !(it.confirmedDuty > 0)
        : it.pendingDuty == null || !(it.pendingDuty > 0)),
  );
  const canPublish = allValid && !redBlocked;

  const qc = useQueryClient();

  const publish = useMutation({
    mutationFn: async ({
      mode,
      branchIds,
    }: {
      mode: "all" | "selected";
      branchIds: string[];
    }) => {
      if (!user) throw new Error("Користувача не знайдено");
      if (!allValid) throw new Error("Заповніть усі товари");
      if (redBlocked) {
        throw new Error(
          offer
            ? CUSTOMS_STRINGS.publishBlockedActiveRed
            : CUSTOMS_STRINGS.publishBlockedDraftRed,
        );
      }
      if (mode === "selected" && branchIds.length === 0) {
        throw new Error("Виберіть хоча б одну філію");
      }

      if (offer) {
        // Existing offer: identity edit is locked for active offers (see
        // OfferItemEditor), so the persisted RED override (if any) remains
        // valid for the current product/country pair.
        const payload = items[0].payload!;
        const { error: offerError } = await supabase
          .from("manager_offers")
          .update({ ...(payload as any), status: "active", target_mode: mode } as any)
          .eq("id", offer.id);
        if (offerError) throw offerError;

        const { error: deleteError } = await supabase
          .from("manager_offer_targets")
          .delete()
          .eq("offer_id", offer.id);
        if (deleteError) throw deleteError;

        if (mode === "selected") {
          const { error: targetError } = await supabase
            .from("manager_offer_targets")
            .insert(branchIds.map((branch_id) => ({ offer_id: offer.id, branch_id })));
          if (targetError) throw targetError;
        }
        return items.length;
      }

      const createdIds: string[] = [];
      const createdPositionIds: string[] = [];
      if (!isAdmin && currentManagerIdLoading) {
        throw new Error("Зачекайте, визначається імпорт-менеджер");
      }
      if (isAdmin && activeManagersLoading) {
        throw new Error("Зачекайте, завантажуються менеджери");
      }
      const selectedManagerId = selectedResponsibleManagerId || null;
      const importManagerId = isAdmin ? selectedManagerId : currentManagerId;
      const responsibleManagerId = isAdmin ? selectedManagerId : currentManagerId;
      if (!isAdmin && !currentManagerId) {
        throw new Error("Не вдалось визначити імпорт-менеджера для пропозиції");
      }
      if (isAdmin && !selectedManagerId) {
        throw new Error("Оберіть відповідального менеджера перед публікацією");
      }
      if (!responsibleManagerId) {
        throw new Error("Пропозиція не може бути створена без відповідального менеджера");
      }
      try {
        for (const it of items) {
          const payload = it.payload!;
          const isRed = it.customsStatus === "red";
          // Path A: RED items always insert as draft first, then RPC, then publish.
          const initialStatus = isRed || mode === "selected" ? "draft" : "active";
          const { data: created, error: createError } = await supabase
            .from("manager_offers")
            .insert({
              ...(payload as any),
              created_by: user.id,
              import_manager_id: importManagerId,
              status: initialStatus,
              target_mode: mode,
            } as any)
            .select("id")
            .single();
          if (createError) throw createError;
          createdIds.push(created.id);

          const offerPayload = payload as {
            product_name: string;
            origin_country: string;
            caliber?: string | null;
            packaging?: string | null;
          };
          const attachResult = await attachOfferToPosition({
            offerId: created.id,
            productName: offerPayload.product_name,
            originCountry: offerPayload.origin_country,
            caliber: offerPayload.caliber ?? null,
            packaging: offerPayload.packaging ?? null,
            responsibleManagerId,
          });
          if (!attachResult.attached) {
            throw new Error(
              `Не вдалося створити позицію для пропозиції (${attachResult.stage}: ${attachResult.reason})`,
            );
          }
          createdPositionIds.push(attachResult.positionId);

          if (isRed) {
            const { error: rpcErr } = await supabase.rpc(
              "confirm_manager_offer_customs_override",
              { p_offer_id: created.id, p_duty: it.pendingDuty! },
            );
            if (rpcErr) throw rpcErr;
          }

          if (mode === "selected") {
            const { error: targetError } = await supabase
              .from("manager_offer_targets")
              .insert(branchIds.map((branch_id) => ({ offer_id: created.id, branch_id })));
            if (targetError) throw targetError;
          }

          // Activate now if RED (we deferred to draft) or selected mode.
          if (isRed || mode === "selected") {
            const { error: activateError } = await supabase
              .from("manager_offers")
              .update({ status: "active", target_mode: mode })
              .eq("id", created.id);
            if (activateError) throw activateError;
          }
        }
      } catch (error) {
        // Strict birth-flow cleanup: remove offer-side rows FIRST (targets,
        // then offers — which also clears manager_offers.position_id refs),
        // THEN ask the backend to safely drop any orphan positions created
        // in this submit. The rollback RPC is a no-op if other links exist.
        if (createdIds.length) {
          await supabase
            .from("manager_offer_targets")
            .delete()
            .in("offer_id", createdIds);
          await supabase.from("manager_offers").delete().in("id", createdIds);
        }
        for (const pid of createdPositionIds) {
          await rollbackBirthPosition(pid);
        }
        throw error;
      }
      return items.length;
    },
    onSuccess: (count, variables) => {
      toast.success(
        variables.mode === "all"
          ? `Пропозицій відправлено всім філіям: ${count}`
          : `Пропозицій відправлено вибраним філіям: ${count}`,
      );
      qc.invalidateQueries({ queryKey: ["manager-offers"] });
      qc.invalidateQueries({ queryKey: ["shipments-link-options"] });
      onSaved();
      setSelectiveOpen(false);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });


  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{offer ? "Редагувати пропозицію" : "Нова пропозиція"}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {!offer && isAdmin && (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
              <label className="block text-sm">
                <span className="mb-1 block text-muted-foreground">Відповідальний менеджер</span>
                <select
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                  value={selectedResponsibleManagerId}
                  onChange={(e) => setSelectedResponsibleManagerId(e.target.value)}
                >
                  <option value="">Не призначати зараз</option>
                  {activeManagers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.full_name ?? "—"}
                    </option>
                  ))}
                </select>
              </label>
              <div className="text-xs text-muted-foreground">
                {selectedResponsibleManagerId
                  ? "Нова пропозиція буде створена для вибраного відповідального менеджера."
                  : "Нова пропозиція буде створена з відповідальним у статусі очікує призначення."}
              </div>
            </div>
          )}

          {items.map((it, idx) => (
            <OfferItemEditor
              key={it.id}
              index={idx}
              total={items.length}
              form={it.form}
              productOptions={productOptions}
              countryOptions={COUNTRY_OPTIONS}
              countryAliases={countryAliases}
              fxRow={fxRow ?? null}
              existingExpiresAt={idx === 0 ? offer?.expires_at ?? null : null}
              existingOffer={idx === 0 ? offer : null}
              confirmedDuty={it.confirmedDuty}
              pendingDuty={it.pendingDuty}
              onFormChange={(f) => updateForm(it.id, f)}
              onPayloadChange={(p) => updatePayload(it.id, p)}
              onCustomsChange={(patch) => updateCustoms(it.id, patch)}
              onRemove={!offer && items.length > 1 ? () => removeItem(it.id) : undefined}
            />
          ))}

          {!offer && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" className="flex-1" onClick={addNew}>
                <Plus className="mr-1 h-4 w-4" /> Новий товар
              </Button>
              <Button variant="secondary" className="flex-1" onClick={addSimilar}>
                <Plus className="mr-1 h-4 w-4" /> Новий товар аналогічний
              </Button>
            </div>
          )}

          {redBlocked && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              {offer
                ? CUSTOMS_STRINGS.publishBlockedActiveRed
                : CUSTOMS_STRINGS.publishBlockedDraftRed}
            </div>
          )}

          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button
              onClick={() => publish.mutate({ mode: "all", branchIds: [] })}
              disabled={publish.isPending || !canPublish}
            >
              Відправити всім{!offer && items.length > 1 ? ` (${items.length})` : ""}
            </Button>
            <Button
              variant="outline"
              onClick={() => setSelectiveOpen(true)}
              disabled={publish.isPending || !canPublish}
            >
              Відправити вибірково
            </Button>
            <Button variant="outline" onClick={onClose}>
              Скасувати
            </Button>
          </div>

        </div>
      </SheetContent>

      <Dialog open={selectiveOpen} onOpenChange={setSelectiveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Виберіть філії для пропозиції</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-border p-3">
              {branches.map((branch) => (
                <label key={branch.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={!!selectedBranches[branch.id]}
                    onCheckedChange={(checked) =>
                      setSelectedBranches((prev) => ({
                        ...prev,
                        [branch.id]: !!checked,
                      }))
                    }
                  />
                  <span>{branch.name}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSelectiveOpen(false)}>
                Скасувати
              </Button>
              <Button
                onClick={() =>
                  publish.mutate({
                    mode: "selected",
                    branchIds: Object.entries(selectedBranches)
                      .filter(([, checked]) => checked)
                      .map(([branchId]) => branchId),
                  })
                }
                disabled={publish.isPending}
              >
                Відправити вибірково
                {!offer && items.length > 1 ? ` (${items.length})` : ""}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

function OfferItemEditor({
  index,
  total,
  form,
  productOptions,
  countryOptions,
  countryAliases,
  fxRow,
  existingExpiresAt,
  existingOffer,
  confirmedDuty,
  pendingDuty,
  onFormChange,
  onPayloadChange,
  onCustomsChange,
  onRemove,
}: {
  index: number;
  total: number;
  form: FormState;
  productOptions: string[];
  countryOptions: string[];
  countryAliases: Record<string, string>;
  fxRow: { rate: number; date: string } | null;
  existingExpiresAt: string | null;
  existingOffer: ManagerOffer | null;
  confirmedDuty: number | null;
  pendingDuty: number | null;
  onFormChange: (f: FormState) => void;
  onPayloadChange: (p: Record<string, unknown> | null) => void;
  onCustomsChange: (patch: {
    customsStatus?: CustomsStatus | null;
    pendingDuty?: number | null;
    confirmedDuty?: number | null;
  }) => void;
  onRemove?: () => void;
}) {
  const qc = useQueryClient();
  // Active-offer branch-activity safe rule: when editing an active offer we
  // cannot confidently rule out branch activity from screen data alone, so
  // lock product_name / origin_country edits per Patch 6B v4.
  const identityLocked = !!existingOffer && existingOffer.status === "active";

  const update = (patch: Partial<FormState>) => onFormChange({ ...form, ...patch });
  const productAliases = useProductAliases();


  const productCanonical = resolveOption(form.product_name, productOptions);
  const productValid = !!productCanonical;
  const countryCanonical = resolveCountry(form.origin_country, countryOptions, countryAliases);
  const countryValid = !!countryCanonical;

  const priceNum = Number(form.price_per_kg);
  const freightNum = Number(form.freight_amount);
  const palletWeightNum = Number(form.pallet_weight);
  const priceValid = form.price_per_kg !== "" && Number.isFinite(priceNum) && priceNum > 0;
  const freightValid = form.freight_amount !== "" && Number.isFinite(freightNum) && freightNum > 0;
  const palletValid =
    form.pallet_weight !== "" && Number.isFinite(palletWeightNum) && palletWeightNum > 0;

  const fxRate = fxRow?.rate ?? null;

  const { data: customsRef } = useQuery<CustomsRefRow | null>({
    queryKey: ["offer-customs-ref", productCanonical, countryCanonical],
    enabled: !!productCanonical && !!countryCanonical,
    queryFn: () => fetchCustomsRef(productCanonical!, countryCanonical!),
  });

  const calc = useMemo(() => {
    if (!priceValid || !freightValid || !palletValid || !countryCanonical) return null;
    return computeOfferCost({
      pricePerKg: priceNum,
      priceCurrency: form.price_currency,
      freight: freightNum,
      freightCurrency: form.freight_currency,
      palletWeight: palletWeightNum,
      fxRate,
      country: countryCanonical,
      ref: customsRef ?? null,
    });
  }, [
    priceValid,
    freightValid,
    palletValid,
    countryCanonical,
    priceNum,
    form.price_currency,
    freightNum,
    form.freight_currency,
    palletWeightNum,
    fxRate,
    customsRef,
  ]);

  const payload = useMemo(() => {
    if (
      !productCanonical ||
      !countryCanonical ||
      !priceValid ||
      !freightValid ||
      !palletValid ||
      !calc
    )
      return null;
    return {
      product_name: productCanonical,
      origin_country: countryCanonical,
      caliber: form.caliber.trim() || null,
      packaging: form.packaging.trim() || null,
      specification: form.specification.trim() || null,
      variety: form.variety.trim() || null,
      price_per_kg: priceNum,
      price_currency: form.price_currency,
      freight_amount: freightNum,
      freight_currency: form.freight_currency,
      pallet_weight: palletWeightNum,
      fx_rate_snapshot: fxRate,
      fx_rate_date: fxRow?.date ?? null,
      indicative_cost_usd: Number(calc.indicativeCost.toFixed(4)),
      invoice_cost_usd: Number(calc.invoiceCost.toFixed(4)),
      offered_pallets: form.offered_pallets === "" ? null : Number(form.offered_pallets),
      expires_at:
        form.expires_in_hours === ""
          ? existingExpiresAt
          : new Date(Date.now() + Number(form.expires_in_hours) * 3600_000).toISOString(),
      expected_eta: form.expected_eta || null,
      notes: form.notes.trim() || null,
    } as Record<string, unknown>;
  }, [
    productCanonical,
    countryCanonical,
    priceValid,
    freightValid,
    palletValid,
    calc,
    form.caliber,
    form.packaging,
    form.specification,
    form.variety,
    priceNum,
    form.price_currency,
    freightNum,
    form.freight_currency,
    palletWeightNum,
    fxRate,
    fxRow?.date,
    form.offered_pallets,
    form.expires_in_hours,
    existingExpiresAt,
    form.expected_eta,
    form.notes,
  ]);

  const payloadKey = payload ? JSON.stringify(payload) : null;
  useEffect(() => {
    onPayloadChange(payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey]);

  // Derive customs status and bubble it up so the parent can gate publish.
  const currentStatus: CustomsStatus | null =
    productCanonical && countryCanonical ? getCustomsStatusFromRef(customsRef) : null;
  useEffect(() => {
    onCustomsChange({ customsStatus: currentStatus });
    // Drop pending duty when leaving RED (parent keeps confirmedDuty in sync
    // via its own offer prop / RPC invalidation).
    if (currentStatus !== "red") {
      onCustomsChange({ pendingDuty: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStatus]);

  // RPC for existing offers: persist manual duty server-side.
  const confirmExisting = useMutation({
    mutationFn: async (duty: number) => {
      const { data, error } = await supabase.rpc(
        "confirm_manager_offer_customs_override",
        { p_offer_id: existingOffer!.id, p_duty: duty },
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const row = data as { customs_override_duty_usd?: number | null } | null;
      const v = row?.customs_override_duty_usd;
      const n = v != null ? Number(v) : null;
      onCustomsChange({ confirmedDuty: n });
      toast.success("Митну суму збережено");
      const oid = existingOffer!.id;
      qc.invalidateQueries({ queryKey: ["manager-offers"] });
      qc.invalidateQueries({ queryKey: ["manager-offer", oid] });
      qc.invalidateQueries({ queryKey: ["manager-offer-responses", oid] });
      qc.invalidateQueries({ queryKey: ["shipments-link-options"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });


  return (
    <div className="rounded-2xl border border-border bg-card/40 p-3 space-y-3">
      {total > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            Товар {index + 1} з {total}
          </div>
          {onRemove && (
            <Button size="sm" variant="ghost" onClick={onRemove}>
              <Trash2 className="mr-1 h-3 w-3" /> Видалити
            </Button>
          )}
        </div>
      )}

      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Товар *</span>
        {identityLocked ? (
          <Input value={form.product_name} disabled readOnly />
        ) : (
          <ValidatedAutocomplete
            value={form.product_name}
            onChange={(v) => update({ product_name: v })}
            options={productOptions}
            aliases={productAliases}
            placeholder="Почніть вводити назву товару"
            required

          />
        )}
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Країна походження *</span>
        {identityLocked ? (
          <Input value={form.origin_country} disabled readOnly />
        ) : (
          <ValidatedAutocomplete
            value={form.origin_country}
            onChange={(v) => update({ origin_country: v })}
            options={countryOptions}
            aliases={countryAliases}
            placeholder="Почніть вводити країну"
            required
          />
        )}
      </label>
      {identityLocked && (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-[11px] text-warning-foreground">
          {CUSTOMS_STRINGS.blockedByBranchActivity}
        </div>
      )}

      {(
        [
          ["caliber", "Калібр"],
          ["packaging", "Упаковка"],
          ["specification", "Специфікація"],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="block text-sm">
          <span className="mb-1 block text-muted-foreground">{label}</span>
          <Input value={form[k]} onChange={(e) => update({ [k]: e.target.value } as Partial<FormState>)} />
        </label>
      ))}
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Сорт / асортимент</span>
        <VarietyField
          value={form.variety}
          productName={form.product_name}
          onChange={(v) => update({ variety: v })}
        />
      </label>
      <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
        <div className="text-xs font-semibold uppercase text-muted-foreground">
          Розрахунок собівартості (внутрішнє)
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Ціна за кг *</span>
            <Input
              type="number"
              step="0.0001"
              value={form.price_per_kg}
              placeholder="напр. 1.50"
              onChange={(e) => update({ price_per_kg: e.target.value })}
              className={cn(!priceValid && "border-destructive bg-destructive/10")}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Валюта</span>
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={form.price_currency}
              onChange={(e) => update({ price_currency: e.target.value as "EUR" | "USD" })}
            >
              <option value="EUR">€ EUR</option>
              <option value="USD">$ USD</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Фрахт *</span>
            <Input
              type="number"
              step="0.01"
              value={form.freight_amount}
              placeholder="напр. 3500"
              onChange={(e) => update({ freight_amount: e.target.value })}
              className={cn(!freightValid && "border-destructive bg-destructive/10")}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Валюта</span>
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={form.freight_currency}
              onChange={(e) => update({ freight_currency: e.target.value as "EUR" | "USD" })}
            >
              <option value="EUR">€ EUR</option>
              <option value="USD">$ USD</option>
            </select>
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">Вага палети, кг *</span>
          <Input
            type="number"
            step="0.1"
            value={form.pallet_weight}
            placeholder="напр. 750"
            onChange={(e) => update({ pallet_weight: e.target.value })}
            className={cn(!palletValid && "border-destructive bg-destructive/10")}
          />
        </label>

        <div className="rounded-lg border border-border bg-background p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">FX EUR/USD</span>
            <span className="tabular-nums">
              {fxRate ? fxRate.toFixed(4) : "—"}
              {fxRow?.date && <span className="ml-1 text-muted-foreground">({fxRow.date})</span>}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">Митниця</span>
            <div className="flex flex-col items-end gap-1">
              {productCanonical && countryCanonical ? (
                <CustomsStatusChip status={getCustomsStatusFromRef(customsRef)} compact />
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
              {customsRef && (
                <CustomsInfoPopover
                  customsRef={customsRef}
                  calc={calc}
                  country={countryCanonical}
                  label="деталі"
                  labelClass="text-[10px] text-muted-foreground underline decoration-dotted underline-offset-2"
                />
              )}
            </div>
          </div>
          {calc && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Очік. палет / фура</span>
                <span className="tabular-nums">{calc.expectedPallets}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Транспорт, $/кг</span>
                <span className="tabular-nums">${calc.transportPerKg.toFixed(4)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-border pt-2">
                <span className="font-semibold text-success">Індикативна</span>
                <span className="font-bold tabular-nums text-success">
                  ${calc.indicativeCost.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-destructive">Інвойсна</span>
                <span className="font-bold tabular-nums text-destructive">
                  ${calc.invoiceCost.toFixed(2)}
                </span>
              </div>
            </>
          )}
          {!calc && (
            <div className="text-muted-foreground">
              Заповніть товар, країну, ціну, фрахт та вагу палети для розрахунку.
            </div>
          )}
        </div>
      </div>

      {currentStatus === "red" && (
        <CustomsManualOverrideField
          confirmedDuty={existingOffer ? confirmedDuty : pendingDuty}
          pending={confirmExisting.isPending}
          onConfirm={(duty) => {
            if (existingOffer) {
              confirmExisting.mutate(duty);
            } else {
              onCustomsChange({ pendingDuty: duty });
            }
          }}
        />
      )}



      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Палет (опціонально)</span>
          <Input
            type="number"
            value={form.offered_pallets}
            onChange={(e) => update({ offered_pallets: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Термін дії, год</span>
          <Input
            type="number"
            placeholder={existingExpiresAt ? "не змінювати" : "без обмеження"}
            value={form.expires_in_hours}
            onChange={(e) => update({ expires_in_hours: e.target.value })}
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Очікувана дата прибуття (ETA)</span>
        <Input
          type="date"
          value={form.expected_eta}
          onChange={(e) => update({ expected_eta: e.target.value })}
        />
        <span className="mt-1 block text-[11px] text-muted-foreground">
          Орієнтовна дата для філій. Після прив'язки до поставки використовується реальний ETA авто.
        </span>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Примітки</span>
        <Textarea value={form.notes} onChange={(e) => update({ notes: e.target.value })} />
      </label>

      {(!productValid || !countryValid) && (form.product_name || form.origin_country) && (
        <div className="text-xs text-destructive">
          {!productValid && form.product_name ? "Товар має відповідати базі. " : ""}
          {!countryValid && form.origin_country ? "Країна має відповідати базі." : ""}
        </div>
      )}
    </div>
  );
}

const VEHICLE_MAX_PALLETS_LINK = 26;

function LinkShipmentDialog({
  offer: initialOffer,
  onClose,
  onLinked,
}: {
  offer: OfferWithResponses | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const offerId = initialOffer?.id ?? null;

  const { data: currentManagerId } = useQuery({
    queryKey: ["current-import-manager-id", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("current_import_manager_id");
      if (error) throw error;
      return data ?? null;
    },
  });

  // Live offer data so pending pallets refresh after each link.
  const { data: liveOffer } = useQuery({
    queryKey: ["link-dialog-offer", offerId],
    enabled: !!offerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_offers")
        .select("*, manager_offer_responses(*), manager_offer_targets(branch_id)")
        .eq("id", offerId!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const responses = (data.manager_offer_responses ?? []) as ManagerOfferResponse[];
      const targetBranchIds = ((data.manager_offer_targets ?? []) as { branch_id: string }[])
        .map((t) => t.branch_id);
      return { ...data, responses, targetBranchIds } as OfferWithResponses;
    },
  });

  const offer = liveOffer ?? initialOffer;

  const pendingLinked = useMemo(() => {
    if (!offer) return 0;
    const inScope = (branchId: string) =>
      offer.target_mode === "all" || offer.targetBranchIds.includes(branchId);
    const active = offer.responses.filter((r) => inScope(r.branch_id));
    const totalApproved = active.reduce(
      (s, r) => s + Number(r.approved_pallets ?? r.requested_pallets ?? 0),
      0,
    );
    const totalLinked = active.reduce(
      (s, r) => s + Number((r as ManagerOfferResponse & { linked_pallets?: number }).linked_pallets ?? 0),
      0,
    );
    return Math.max(totalApproved - totalLinked, 0);
  }, [offer]);

  // Auto-close when nothing left to load.
  useEffect(() => {
    if (offerId && liveOffer && pendingLinked === 0) {
      onLinked();
    }
  }, [offerId, liveOffer, pendingLinked, onLinked]);

  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const target = offer ? norm(offer.product_name) : "";
  const targetCountry = offer ? norm(offer.origin_country) : "";
  const targetCaliber = offer ? norm(offer.caliber) : "";

  const { data: shipments } = useQuery({
    queryKey: ["shipments-link-options", offerId, user?.id, currentManagerId],
    enabled: !!offer && !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select(
          "id,code,country,eta,created_by,import_manager_id,shipment_items(id,product_name,origin_country,caliber,pallet_count,distribution_items(pallets,reserved_pallets))",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      const all = (data ?? []) as Array<{
        id: string;
        code: string;
        country: string | null;
        eta: string | null;
        created_by?: string | null;
        import_manager_id?: string | null;
        shipment_items:
          | {
              id: string;
              product_name: string;
              origin_country: string | null;
              caliber: string | null;
              pallet_count: number | null;
              distribution_items:
                | { pallets: number | null; reserved_pallets: number | null }[]
                | null;
            }[]
          | null;
      }>;
      return all.filter((s) =>
        s.created_by === user!.id || (!!currentManagerId && s.import_manager_id === currentManagerId),
      );
    },
  });

  type Card = {
    id: string;
    shipmentItemId: string;
    code: string;
    country: string | null;
    eta: string | null;
    freeP: number;
    match: "exact" | "caliber_mismatch";
    shipmentCaliber: string | null;
  };

  const itemAvailable = (i: {
    pallet_count: number | null;
    distribution_items: { pallets: number | null; reserved_pallets: number | null }[] | null;
  }) => {
    const total = Number(i.pallet_count ?? 0);
    const allocated = (i.distribution_items ?? []).reduce(
      (a, d) => a + Math.max(Number(d.pallets ?? 0), Number(d.reserved_pallets ?? 0)),
      0,
    );
    return Math.max(0, total - allocated);
  };

  const cards: Card[] = useMemo(() => {
    if (!offer || !shipments) return [];
    if (!target || !targetCountry) return [];
    const out: Card[] = [];
    for (const s of shipments) {
      const items = s.shipment_items ?? [];
      // Strict filter: product + country must match for at least one item.
      const productCountryItems = items.filter(
        (i) => norm(i.product_name) === target && norm(i.origin_country) === targetCountry,
      );
      if (productCountryItems.length === 0) continue;

      const exact = targetCaliber
        ? productCountryItems.find((i) => norm(i.caliber) === targetCaliber)
        : productCountryItems[0];

      if (exact) {
        const freeP = itemAvailable(exact);
        if (freeP <= 0) continue;
        out.push({
          id: s.id,
          shipmentItemId: exact.id,
          code: s.code,
          country: s.country,
          eta: s.eta,
          freeP,
          match: "exact",
          shipmentCaliber: exact.caliber ?? null,
        });
        continue;
      }
      // Caliber mismatch: pick the first product+country item (its caliber wins).
      const mismatch = productCountryItems[0];
      const freeP = itemAvailable(mismatch);
      if (freeP <= 0) continue;
      out.push({
        id: s.id,
        shipmentItemId: mismatch.id,
        code: s.code,
        country: s.country,
        eta: s.eta,
        freeP,
        match: "caliber_mismatch",
        shipmentCaliber: mismatch.caliber ?? null,
      });
    }
    return out;
  }, [offer, shipments, target, targetCountry, targetCaliber]);

  const link = useMutation({
    mutationFn: async (vars: { shipmentItemId: string; allowMismatch: boolean }) => {
      if (!offer) return;
      const { error } = await supabase.rpc("link_offer_to_shipment_item_fifo", {
        p_offer_id: offer.id,
        p_shipment_item_id: vars.shipmentItemId,
        p_max_pallets: null as unknown as number,
        p_allow_caliber_mismatch: vars.allowMismatch,
        p_notes: null as unknown as string,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Товар додано в поставку");
      qc.invalidateQueries({ queryKey: ["link-dialog-offer", offerId] });
      qc.invalidateQueries({ queryKey: ["shipments-link-options"] });
      qc.invalidateQueries({ queryKey: ["manager-offers"] });
    },
    onError: (err: any) => {
      const msg = err?.message ?? "";
      if (msg.includes("OVER_CAPACITY")) toast.error("Перевищено місткість палет у позиції поставки");
      else if (msg.includes("OVER_REMAINING")) toast.error("Перевищено залишок для підтвердження");
      else if (msg.includes("PRODUCT_MISMATCH")) toast.error("Товар не відповідає позиції поставки");
      else if (msg.includes("COUNTRY_MISMATCH")) toast.error("Країна не відповідає позиції поставки");
      else if (msg.includes("CALIBER_MISMATCH")) toast.error("Калібр не відповідає позиції поставки");
      else if (msg.includes("LEGACY_LINK_EXISTS")) toast.error("Ця пропозиція має стару прив'язку. Потрібна технічна перевірка.");
      else if (msg.includes("NOTHING_TO_ALLOCATE")) toast.error("Немає підтвердженого об'єму для додавання");
      else if (msg.includes("FORBIDDEN")) toast.error("Недостатньо прав");
      else toast.error("Не вдалося додати в поставку");
    },
  });

  const handlePick = (c: Card) => {
    if (link.isPending) return;
    if (c.freeP <= 0) {
      toast.error("У поставці немає вільних палет");
      return;
    }
    if (c.match === "caliber_mismatch") {
      const ok = window.confirm(
        `Калібр у поставці (${c.shipmentCaliber ?? "—"}) відрізняється від очікуваного (${offer?.caliber ?? "—"}). ` +
          `Товар буде додано в поставку з калібром поставки. Продовжити?`,
      );
      if (!ok) return;
      toast.info(`Калібр змінено: ${offer?.caliber ?? "—"} → ${c.shipmentCaliber ?? "—"}`);
    }
    link.mutate({ shipmentItemId: c.shipmentItemId, allowMismatch: c.match === "caliber_mismatch" });
  };

  return (
    <Sheet open={!!initialOffer} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Підтягнути до поставки</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {offer && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm space-y-1">
              <div className="font-semibold">{offer.product_name}</div>
              <div className="text-xs text-muted-foreground">
                {offer.origin_country ?? "—"}
                {offer.caliber ? ` · калібр ${offer.caliber}` : ""}
              </div>
              <div className="pt-1 text-sm">
                Залишилось завантажити: <b>{pendingLinked}п</b>
              </div>
            </div>
          )}

          {cards.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Немає поставок з відповідним товаром.
            </div>
          ) : (
            cards.map((c) => {
              const disabled = c.freeP <= 0 || link.isPending || pendingLinked <= 0;
              const isExact = c.match === "exact";
              return (
                <button
                  key={c.shipmentItemId}
                  type="button"
                  onClick={() => handlePick(c)}
                  disabled={disabled}
                  className={cn(
                    "flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition",
                    isExact
                      ? "border-success/50 bg-success/5 hover:bg-success/10"
                      : "border-warning/50 bg-warning/5 hover:bg-warning/10",
                    disabled && "opacity-60 cursor-not-allowed",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">{c.code}</div>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                        isExact ? "bg-success/15 text-success" : "bg-warning/20 text-warning",
                      )}
                    >
                      {isExact ? "є товар" : "інший калібр"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {c.country ?? "—"} · ETA {c.eta ?? "—"}
                  </div>
                  {!isExact && (
                    <div className="text-xs text-warning">
                      Не збігається калібр. Потрібно: <b>{offer?.caliber ?? "—"}</b>,
                      у поставці: <b>{c.shipmentCaliber ?? "—"}</b>
                    </div>
                  )}
                  <div className="text-xs font-medium text-foreground">
                    Вільних палет: <b>{c.freeP}п</b>
                  </div>
                </button>
              );
            })
          )}

          <div className="flex flex-col gap-2 pt-2">
            <Link
              to="/shipments/new"
              search={offerId ? { fromOffer: offerId } : {}}
              onClick={() => onClose()}
              className="block"
            >
              <Button size="sm" className="w-full bg-brand text-brand-foreground hover:bg-brand/90">
                <Plus className="mr-1 h-4 w-4" /> Нова поставка
              </Button>
            </Link>
            <Button variant="outline" size="sm" className="w-full" onClick={onClose}>
              Створю пізніше
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PublishOfferDialog({
  offer,
  branches,
  onClose,
  onPublished,
}: {
  offer: ManagerOffer | null;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onPublished: () => void;
}) {
  const isDraft = offer?.status === "draft";
  const [mode, setMode] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  // Load existing targets when opening for an offer that's already published
  const { data: existingTargets = EMPTY_TARGET_IDS } = useQuery({
    queryKey: ["manager-offer-targets-edit", offer?.id],
    enabled: !!offer,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_offer_targets")
        .select("branch_id")
        .eq("offer_id", offer!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.branch_id as string);
    },
  });

  // reset state when opening, then merge in existing targets once loaded
  useEffect(() => {
    if (offer) {
      setMode(offer.target_mode ?? "all");
      setSelected({});
    }
  }, [offer?.id]);

  useEffect(() => {
    if (!offer) {
      setSelected({});
      return;
    }

    if (offer.target_mode === "selected") {
      setSelected(toBranchSelection(existingTargets));
      return;
    }

    setSelected({});
  }, [offer?.id, existingTargets]);

  const publish = useMutation({
    mutationFn: async () => {
      if (!offer) return;
      const branchIds =
        mode === "selected"
          ? Object.entries(selected)
              .filter(([, v]) => v)
              .map(([k]) => k)
          : [];
      if (mode === "selected" && branchIds.length === 0) {
        throw new Error("Виберіть хоча б одну філію");
      }

      // Reset existing targets for this offer
      const { error: delErr } = await supabase
        .from("manager_offer_targets")
        .delete()
        .eq("offer_id", offer.id);
      if (delErr) throw delErr;

      if (mode === "selected" && branchIds.length > 0) {
        const { error: insErr } = await supabase
          .from("manager_offer_targets")
          .insert(branchIds.map((branch_id) => ({ offer_id: offer.id, branch_id })));
        if (insErr) throw insErr;
      }

      const update: { target_mode: "all" | "selected"; status?: ManagerOfferStatus } = {
        target_mode: mode,
      };
      if (isDraft) update.status = "active";
      const { error } = await supabase
        .from("manager_offers")
        .update(update)
        .eq("id", offer.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(isDraft ? "Пропозицію опубліковано" : "Цільові філії оновлено");
      onPublished();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const allBranchIds = branches.map((b) => b.id);
  const allSelected = allBranchIds.length > 0 && allBranchIds.every((id) => selected[id]);

  return (
    <Sheet open={!!offer} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {isDraft
              ? "Запропонувати всім філіям чи вибірково?"
              : "Змінити цільові філії"}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {!isDraft && (
            <p className="text-xs text-muted-foreground">
              Зміни застосовуються миттєво. Філії, які буде вилучено, втратять доступ до
              цієї пропозиції; їх відгуки збережуться як історія, але не враховуються в
              підсумках.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant={mode === "all" ? "default" : "outline"}
              onClick={() => setMode("all")}
              className="flex-1"
            >
              Всім
            </Button>
            <Button
              variant={mode === "selected" ? "default" : "outline"}
              onClick={() => setMode("selected")}
              className="flex-1"
            >
              Вибірково
            </Button>
          </div>

          {mode === "selected" && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Виберіть філії ({selectedCount} обрано)
                </span>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => {
                    if (allSelected) setSelected({});
                    else {
                      const m: Record<string, boolean> = {};
                      for (const id of allBranchIds) m[id] = true;
                      setSelected(m);
                    }
                  }}
                >
                  {allSelected ? "Зняти всі" : "Вибрати всі"}
                </button>
              </div>
              {branches.map((b) => (
                <label
                  key={b.id}
                  className="flex cursor-pointer items-center gap-2 py-1 text-sm"
                >
                  <Checkbox
                    checked={!!selected[b.id]}
                    onCheckedChange={(v) =>
                      setSelected((p) => ({ ...p, [b.id]: !!v }))
                    }
                  />
                  <span>{b.name}</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              Скасувати
            </Button>
            <Button
              onClick={() => publish.mutate()}
              disabled={publish.isPending}
            >
              {isDraft ? "Запропонувати" : "Зберегти"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CustomsInfoPopover({
  customsRef,
  calc,
  country,
  label,
  labelClass,
}: {
  customsRef: CustomsRefRow | null;
  calc: ReturnType<typeof computeOfferCost> | null;
  country: string | null;
  label: string;
  labelClass?: string;
}) {
  const eu = isEuCountry(country ?? "");
  const pct = customsRef ? (eu ? Number(customsRef.euro1_percent || 0) : Number(customsRef.customs_fee_percent || 0)) : 0;
  const threshold = Number(customsRef?.threshold_price_usd || 0);
  const indicative = Number(customsRef?.euro1_markup_usd || 0);
  const unitUsd = calc?.unitUsd ?? 0;
  const usedFlat = calc && customsRef ? unitUsd <= threshold : false;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={cn("cursor-pointer text-left", labelClass)}>
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80 text-xs space-y-2">
        <div className="font-semibold text-sm">Розрахунок митниці</div>
        {customsRef ? (
          <div className="space-y-1">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Аналог (товар)</span>
              <span className="text-right">{customsRef.product_name ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Аналог (країна)</span>
              <span className="text-right">{customsRef.country ?? "—"} {eu ? "(ЄС)" : ""}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Поріг ціни</span>
              <span className="tabular-nums">${threshold.toFixed(2)}/кг</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Індикативне мито</span>
              <span className="tabular-nums">${indicative.toFixed(4)}/кг</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">{eu ? "EUR1 %" : "Мито %"}</span>
              <span className="tabular-nums">{pct.toFixed(2)}%</span>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-border bg-muted/30 p-2 text-muted-foreground">
            У митній базі не знайдено запису для цього товару та країни. У розрахунку мито взято як <b>$0.0000</b>.
          </div>
        )}
        {calc && (
          <div className="border-t border-border pt-2 space-y-1">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">Ціна за кг (USD)</span>
              <span className="tabular-nums">${unitUsd.toFixed(4)}</span>
            </div>
            <div className="text-muted-foreground">
              {!customsRef ? (
                <>Запису в митній базі немає → мито не додається, собівартість = ціна + транспорт.</>
              ) : usedFlat ? (
                <>Ціна ≤ порогу → мито = індикатив = <b>${indicative.toFixed(4)}</b></>
              ) : (
                <>Ціна &gt; порогу → інвойсне мито: unit×1.20×{pct.toFixed(2)}%/100 + unit×0.20 + 0.02 = <b>${calc.invoiceDuty.toFixed(4)}</b></>
              )}
            </div>
            <div className="flex justify-between gap-2 pt-1">
              <span className="font-semibold text-success">Індикативне мито</span>
              <span className="tabular-nums font-semibold text-success">${calc.indicativeDuty.toFixed(4)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="font-semibold text-destructive">Інвойсне мито</span>
              <span className="tabular-nums font-semibold text-destructive">${calc.invoiceDuty.toFixed(4)}</span>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
