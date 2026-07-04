import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState, createContext, useContext, useCallback, type FocusEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ArrowLeft, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toUaCountry, normalizeCountry } from "@/lib/countries";
import { AutocompleteCell } from "@/components/AutocompleteCell";
import { InlineAutocomplete } from "@/components/InlineAutocomplete";
import { useCountryOptions } from "@/hooks/useCountryOptions";
import { CostPair } from "@/components/CostPair";
import { deleteEmptyDraftShipment } from "@/lib/shipments.functions";
import { canonicalizeProductName, normalizeProductKey, resolveProductOption } from "@/lib/product-aliases";
import { translateError } from "@/lib/mutation-helpers";
import { CustomsStatusChip } from "@/components/CustomsStatusChip";
import { CustomsManualOverrideField } from "@/components/CustomsManualOverrideField";
import { CUSTOMS_STRINGS, getCustomsStatusFromMatch } from "@/lib/customs-status";
import { allocateTransport } from "@/lib/transport";
import { rollbackBirthPosition } from "@/lib/position-attach";
import { commitNewShipmentItem } from "@/lib/commit-shipment-row";
import { blurOnEnter, MOBILE_ENTER_KEY_HINT, scrollFocusedIntoView } from "@/lib/mobile-input";
import { ShipmentProductCard } from "@/components/shipments/ShipmentProductCard";
import { getCountryAliasTargets } from "@/lib/alias-cache";
import {
  type DraftRow,
  type ProductRef,
  type RequiredField,
  type ActiveCustomsRef,
  type RowComponents,
  type ItemRowLike,
  type ShipmentRowLike,
  type VehicleContextLike,
  isKnownProductName,
  isEuCountry,
  normalizeCustomsKey,
  customsLookupName,
  getCountryCandidatesNormalized,
  pickCustomsRefForDraft,
  computeCustomsPreview,
  computeRowPreview,
  emptyDraftRow,
  itemRowToDraft,
  isDraftDirty,
  getMissingDraftFields,
  buildPayload as buildShipmentItemPayload,
  isNetGreaterThanGross,
  sumCapacity,
} from "@/lib/shipment-row-engine";


// Patch 6B: per-shipment customs-ref index supplied via context (no module globals).
// D1-Fix v2.5.3 — widened to carry numeric fields so clean rows can compute
// breakdown values directly from the saved customs_match_id row (deactivation-safe).
type CustomsRefIndex = Map<string, {
  id: string;
  product_name: string;
  country: string;
  threshold_price_usd: number | null;
  customs_fee_percent: number | null;
  euro1_markup_usd: number | null;
  euro1_percent: number | null;
}>;
const CustomsRefContext = createContext<CustomsRefIndex>(new Map());

// Patch 6B follow-up: per-row YELLOW selection so the explanation panel can
// switch between fallback items instead of always showing the first one.
type FallbackSelection = {
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  openRef: { current: (open: boolean) => void };
};
const FallbackSelectionContext = createContext<FallbackSelection>({
  selectedId: null,
  setSelectedId: () => {},
  openRef: { current: () => {} },
});


import { StaffOnly } from "@/components/StaffOnly";

export const Route = createFileRoute("/_authenticated/shipments/$id/products")({
  validateSearch: (search: Record<string, unknown>): { fromOffer?: string } => ({
    fromOffer: typeof search.fromOffer === "string" ? search.fromOffer : undefined,
  }),
  component: () => <StaffOnly><ProductsFullscreen /></StaffOnly>,
});

import { useCountryAliases } from "@/hooks/useCountryAliases";
import { useProductAliases } from "@/hooks/useProductAliases";
import { useVarietiesFor } from "@/hooks/useProductVarieties";
import { VarietyAutocomplete } from "@/components/VarietyAutocomplete";
import { usePalletResolver, type PackageOption } from "@/hooks/usePackageOptions";
import { resolvePalletForText } from "@/lib/pallet-resolver";

type ItemRow = {
  id: string;
  product_name: string | null;
  variety: string | null;
  origin_country: string | null;
  caliber: string | null;
  sku: string | null;
  pallet_count: number | null;
  pallet_weight: number | null;
  unit_price: number | null;
  price_currency: string | null;
  final_cost_indicative: number | null;
  final_cost_invoice: number | null;
  customs_match_id: string | null;
  customs_override_duty_usd: number | null;
  customs_override_confirmed_at: string | null;
  customs_override_by: string | null;
  // 9F Phase B — final weight model (Phase A added columns).
  package_used: string | null;
  net_weight_kg: number | null;
  gross_weight_kg: number | null;
  resolver_net_per_pallet_kg: number | null;
  resolver_gross_per_pallet_kg: number | null;
  net_auto: boolean | null;
  gross_auto: boolean | null;
  // R1A — brand/class persistence plumbing (SELECT + payload only;
  // no UI fields added to the editor in R1A).
  brand: string | null;
  class: string | null;
  // Phase 1 final — position anchor used to lock product/origin identity
  // in ShipmentProductCard once a position_id exists for the row.
  position_id: string | null;
};

// 9F Phase D1 — strict draft/confirm/save contract.
// Manual rows live in local state until "Готово" commits them.
// addItem / edit / delete never touch the DB on their own — only commitDraft does.
// DraftRow moved to @/lib/shipment-row-engine (Build A).

// D1-Fix v2.5.4 — recognition hint shared between row resolver and commit guard.
// Stored per-localId in a ref. Keys identify which draft values produced the
// status so commitDraft can detect stale hints and re-check via read-only RPC.
export type ResolverHintStatus =
  | "matched"
  | "pallet_no_match"
  | "product_no_match"
  | "product_ambiguous"
  | "country_no_match";
export type ResolverHintInfo = {
  status: ResolverHintStatus;
  productKey: string;
  countryKey: string;
  packageKey: string;
};
function resolverKeyOf(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}



// DRAFT_EDITABLE_KEYS, itemRowToDraft, emptyDraftRow, isDraftDirty,
// getMissingDraftFields moved to @/lib/shipment-row-engine (Build A).

type CustomsRefMini = {
  id: string;
  product_name: string;
  country: string;
  threshold_price_usd: number | null;
  customs_fee_percent: number | null;
  euro1_markup_usd: number | null;
  euro1_percent: number | null;
};

// Customs helpers (isEuCountry, normalizeCustomsKey, customsLookupName,
// ActiveCustomsRef, getCountryCandidatesNormalized, pickCustomsRefForDraft,
// computeCustomsPreview) moved to @/lib/shipment-row-engine (Build A).

// RowComponents type and computeRowPreview moved to
// @/lib/shipment-row-engine (Build A).

type ShipmentRow = {
  id: string;
  code: string;
  country: string | null;
  logistics_cost: number | null;
  logistics_cost_currency: string | null;
  logistics_cost_usd: number | null;
  eur_usd_rate: number | null;
  vehicle_id: string | null;
  created_by: string | null;
  import_manager_id: string | null;
  vehicle_owner_id: string | null;
  supplier_name: string | null;
};

type VehicleContext = {
  vehicle: {
    id: string;
    code: string | null;
    country: string | null;
    total_pallets: number | null;
    total_weight_kg: number | null;
    created_by: string | null;
  };
  ownerName: string;
  ownerShipment: {
    id: string;
    logistics_cost: number | null;
    logistics_cost_currency: string | null;
  } | null;
  loadedItems: Array<{
    id: string;
    shipment_id: string;
    shipment_code: string;
    supplier_name: string | null;
    owner_id: string | null;
    owner_name: string;
    product_name: string | null;
    variety: string | null;
    origin_country: string | null;
    pallet_count: number | null;
    pallet_weight: number | null;
    net_weight_kg: number | null;
    gross_weight_kg: number | null;
    isCurrentShipment: boolean;
    isOwnManager: boolean;
  }>;
  vehicleStatus: string | null;
  shipments: Array<{ id: string; logistics_cost_usd: number | null }>;
};

// Phase 0 — legacy products.default_pallet_weight removed. Pallet/net/gross
// come from pallet_standards via DB resolver only. No product-only fallback.
// ProductRef + isKnownProductName moved to @/lib/shipment-row-engine (Build A).

function isValidShipmentItem(item: Pick<ItemRow, "product_name" | "pallet_count">) {
  return (item.product_name ?? "").trim().length > 0 && Number(item.pallet_count ?? 0) > 0;
}

// RequiredField moved to @/lib/shipment-row-engine (Build A).

function getMissingFields(item: ItemRow): RequiredField[] {
  const missing: RequiredField[] = [];
  if (!(item.product_name ?? "").trim() || item.product_name === "Новий товар") missing.push("product_name");
  if (!(item.origin_country ?? "").trim()) missing.push("origin_country");
  const pc = Number(item.pallet_count ?? 0);
  if (pc <= 0) missing.push("pallet_count");
  const totalW = pc * Number(item.pallet_weight ?? 0);
  if (totalW <= 0) missing.push("total_weight");
  if (!item.unit_price || Number(item.unit_price) <= 0) missing.push("unit_price");
  return missing;
}

// Auto-close only. NEVER auto-reopens a closed vehicle — a closed vehicle can
// only return to "open" via an explicit user reopen action, which currently
// does not exist. Merely editing / exiting a shipment (parent or child) must
// not resurrect a closed vehicle. This was the root cause of the
// "закрите авто самопроизвольно повертається у Не закриті авто" regression.
async function syncVehicleStateForShipment(shipmentId: string) {
  const { data: shipment } = await supabase
    .from("shipments")
    .select("vehicle_id")
    .eq("id", shipmentId)
    .maybeSingle();

  const vehicleId = (shipment as { vehicle_id?: string | null } | null)?.vehicle_id;
  if (!vehicleId) return;

  const { data: vehicle } = await supabase
    .from("vehicles" as never)
    .select("id,status,closed_at")
    .eq("id", vehicleId)
    .maybeSingle();

  const currentStatus = (vehicle as { status?: string | null } | null)?.status ?? null;
  // If vehicle is already closed — DO NOT TOUCH IT. No reopen, no closed_at
  // reset. Reopening only via an explicit action, which is out of scope here.
  if (currentStatus === "closed") return;

  // Aggregate loaded pallets/gross from actual shipment_items on this vehicle.
  // Gross-first fallback: gross_weight_kg → net_weight_kg → pallet_count*pallet_weight.
  // Do NOT use vehicles.total_weight_kg — it is net-ish via DB trigger.
  const { data: itemsRows } = await supabase
    .from("shipment_items")
    .select(
      "pallet_count,pallet_weight,net_weight_kg,gross_weight_kg,shipments!inner(vehicle_id)",
    )
    .eq("shipments.vehicle_id", vehicleId);
  let totalPallets = 0;
  let totalWeight = 0;
  for (const it of (itemsRows ?? []) as Array<{
    pallet_count: number | null;
    pallet_weight: number | null;
    net_weight_kg: number | null;
    gross_weight_kg: number | null;
  }>) {
    const pc = Number(it.pallet_count ?? 0);
    totalPallets += pc;
    const g = Number(it.gross_weight_kg ?? 0);
    if (g > 0) totalWeight += g;
    else {
      const net = Number(it.net_weight_kg ?? 0);
      const pw = Number(it.pallet_weight ?? 0);
      totalWeight += net > 0 ? net : pc * pw;
    }
  }
  // Авто закривається автоматично, якщо:
  //   • завантажено ≥ 26 палет (незалежно від ваги), АБО
  //   • завантажено ≥ 21000 кг брутто (незалежно від кількості палет).
  const shouldBeClosed =
    totalPallets >= MAX_PALLETS || totalWeight >= MIN_AUTOCLOSE_WEIGHT_KG;
  if (!shouldBeClosed) return;

  await supabase
    .from("vehicles" as never)
    .update({
      status: "closed",
      closed_at: new Date().toISOString(),
    } as never)
    .eq("id", vehicleId);
}

function invalidateVehicleAndShipmentCaches(qc: ReturnType<typeof useQueryClient>) {
  // refetchType: "all" — also refetch queries that aren't currently mounted,
  // so when the user navigates back to /shipments the list is already fresh
  // (global default refetchOnMount is false in router.tsx).
  qc.invalidateQueries({ queryKey: ["shipments-list"], refetchType: "all" });
  qc.invalidateQueries({ queryKey: ["dash-manager"], refetchType: "all" });
  qc.invalidateQueries({ queryKey: ["open-vehicles"], refetchType: "all" });
  qc.invalidateQueries({ queryKey: ["open-vehicles-list"], refetchType: "all" });
  qc.invalidateQueries({ queryKey: ["vehicles-list"], refetchType: "all" });
  qc.invalidateQueries({ queryKey: ["vehicles-open"], refetchType: "all" });
  qc.invalidateQueries({ queryKey: ["distribution-list"] });
  qc.invalidateQueries({ queryKey: ["shipment-products"] });
}

const FocusedColContext = createContext<{ focused: number | null; setFocused: (i: number | null) => void }>({
  focused: null,
  setFocused: () => {},
});

const MOBILE_EDITOR_LABELS: Record<string, string> = {
  "0": "Товар",
  "1": "Сорт",
  "2": "Країна",
  "3": "Калібр",
  "4": "SKU",
  "5": "Упаковка",
  "6": "Палети",
  "7": "Нетто",
  "8": "Брутто",
  "9": "Ціна",
};

function getMobileEditorLabel(target: EventTarget | null): string | null {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return null;
  const explicit = el.closest("[data-mobile-edit-label]") as HTMLElement | null;
  if (explicit?.dataset.mobileEditLabel) return explicit.dataset.mobileEditLabel;
  const td = el.closest("td[data-col]") as HTMLElement | null;
  if (!td) return null;
  return MOBILE_EDITOR_LABELS[td.dataset.col ?? ""] ?? null;
}

function isEditableFieldTarget(target: EventTarget | null) {
  const el = target instanceof HTMLElement ? target : null;
  if (!el) return false;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
    return false;
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return !el.readOnly && !el.disabled;
  }
  return !el.disabled;
}

function ProductsScrollArea({
  itemsCount,
  empty,
  emptyContent,
  children,
  editingToolbarVisible = false,
}: {
  itemsCount: number;
  empty: boolean;
  emptyContent: ReactNode;
  children: ReactNode;
  editingToolbarVisible?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const prevCount = useRef(itemsCount);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // When a new row is added, scroll the container so the new row and the
    // "Додати товар" button stay in view. Older rows naturally scroll up under
    // the sticky <thead>.
    if (itemsCount > prevCount.current) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      });
    }
    prevCount.current = itemsCount;
  }, [itemsCount]);
  return (
    <div
      ref={ref}
      data-mobile-scroll-container
      className="relative min-h-0 flex-1 overflow-auto overscroll-contain"
      style={{
        ["--mobile-focus-top-offset" as string]: "46px",
        ["--mobile-focus-bottom-offset" as string]: editingToolbarVisible ? "92px" : "24px",
        scrollPaddingTop: "46px",
        scrollPaddingBottom: editingToolbarVisible ? "92px" : "24px",
      }}
    >
      {empty ? emptyContent : children}
    </div>
  );
}


function CustomsStatusBadge({
  status,
  fallbackItems,
}: {
  status: "found" | "fallback";
  fallbackItems: Array<{ item: ItemRow; ref: CustomsRefMini }>;
}) {
  if (status === "found") {
    return (
      <span className="font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
        Індикатив: знайдено
      </span>
    );
  }
  const { openRef } = useContext(FallbackSelectionContext);
  const [open, setLocalOpen] = useState(false);
  // Register the popover opener so YELLOW row chips can open the panel.
  useEffect(() => {
    openRef.current = setLocalOpen;
    return () => { openRef.current = () => {}; };
  }, [openRef]);
  const count = fallbackItems.length;
  return (
    <Popover open={open} onOpenChange={setLocalOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-amber-600 hover:text-amber-700 dark:text-amber-400"
        >
          Індикатив: не знайдено
          <AlertTriangle className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="center"
        className="w-80 border-amber-400/40 bg-amber-50 p-3 text-[11px] leading-snug text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
      >
        <div className="font-semibold">
          Fallback по товару: {count} {count === 1 ? "позиція" : count < 5 ? "позиції" : "позицій"}
        </div>
        <ul className="mt-2 space-y-1.5 border-t border-amber-400/30 pt-2">
          {fallbackItems.map((f) => {
            const product = f.item.product_name || "—";
            const origin =
              toUaCountry(f.item.origin_country ?? "") || f.item.origin_country || "—";
            const basisProduct = f.ref.product_name || "—";
            const basisCountry = toUaCountry(f.ref.country) || f.ref.country || "—";
            return (
              <li key={f.item.id} className="leading-snug">
                <div>
                  <b>{product}</b> · <b>{origin}</b>
                </div>
                <div className="text-amber-700/80 dark:text-amber-300/80">
                  базис: {basisProduct} · {basisCountry}
                </div>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}


function ProductsFullscreen() {
  const { id } = Route.useParams();
  const search = Route.useSearch();
  const fromOfferId = search.fromOffer;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const deleteEmptyDraftShipmentFn = useServerFn(deleteEmptyDraftShipment);
  const { user, loading, hasRole } = useAuth();
  const isAdmin = hasRole(["super_admin", "admin"]);
  const { data: currentManagerId } = useQuery({
    queryKey: ["current-import-manager-id", user?.id],
    enabled: !loading && !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("current_import_manager_id");
      if (error) throw error;
      return data ?? null;
    },
  });

  const { data } = useQuery({
    queryKey: ["shipment-products", user?.id, id],
    enabled: !loading && !!user,
    // D1-Fix v2.5.2 — vehicle close / sibling updates: refetch when tab regains focus
    // and on every mount. Hydration guard (line ~839) ensures dirty draft state is preserved.
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    queryFn: async () => {
      const [s, items, prods] = await Promise.all([
        supabase.from("shipments").select("id,code,country,logistics_cost,logistics_cost_currency,logistics_cost_usd,eur_usd_rate,vehicle_id,created_by,import_manager_id,suppliers(name)").eq("id", id).single(),
        supabase.from("shipment_items").select("id,product_name,variety,origin_country,caliber,sku,brand,class,pallet_count,pallet_weight,unit_price,price_currency,final_cost_indicative,final_cost_invoice,customs_match_id,customs_override_duty_usd,customs_override_confirmed_at,customs_override_by,package_used,net_weight_kg,gross_weight_kg,resolver_net_per_pallet_kg,resolver_gross_per_pallet_kg,net_auto,gross_auto,position_id").eq("shipment_id", id).order("created_at"),
        Promise.all([
          supabase.from("product_dictionary").select("product_name_ua").order("product_name_ua"),
          supabase.from("product_varieties").select("product_name_ua").range(0, 1999),
        ]),
      ]);
      const sh = s.data as {
        id: string;
        code: string;
        country: string | null;
        logistics_cost: number | null;
        logistics_cost_currency: string | null;
        logistics_cost_usd: number | null;
        eur_usd_rate: number | null;
        vehicle_id: string | null;
        created_by: string | null;
        import_manager_id: string | null;
        suppliers?: { name: string | null } | null;
      } | null;
      let vehicleOwnerId: string | null = null;
      let vehicleContext: VehicleContext | null = null;
      if (sh?.vehicle_id) {
        const [{ data: v }, { data: siblingShipments }] = await Promise.all([
          supabase
            .from("vehicles" as never)
            .select("id,code,country,total_pallets,total_weight_kg,created_by,status")
            .eq("id", sh.vehicle_id)
            .single(),
          supabase
            .from("shipments")
            .select("id,code,created_by,import_manager_id,logistics_cost,logistics_cost_currency,logistics_cost_usd,suppliers(name)")
            .eq("vehicle_id", sh.vehicle_id)
            .order("created_at"),
        ]);
        vehicleOwnerId = (v as { created_by: string | null } | null)?.created_by ?? null;

        const shipmentsForVehicle = (siblingShipments ?? []).map((row) => ({
          id: row.id,
          code: row.code,
          created_by: row.created_by ?? null,
          import_manager_id: row.import_manager_id ?? null,
          logistics_cost: row.logistics_cost ?? null,
          logistics_cost_currency: row.logistics_cost_currency ?? null,
          logistics_cost_usd: (row as { logistics_cost_usd?: number | null }).logistics_cost_usd ?? null,
          supplier_name: row.suppliers?.name ?? null,
          owner_id: row.import_manager_id ?? row.created_by ?? null,
        }));
        const shipmentIds = shipmentsForVehicle.map((row) => row.id);
        const ownerIds = Array.from(
          new Set(
            [vehicleOwnerId, ...shipmentsForVehicle.map((row) => row.owner_id)].filter(
              (value): value is string => !!value,
            ),
          ),
        );

        const [{ data: vehicleItems }, { data: profiles }] = await Promise.all([
          shipmentIds.length
            ? supabase
                .from("shipment_items")
                .select("id,shipment_id,product_name,variety,origin_country,pallet_count,pallet_weight,net_weight_kg,gross_weight_kg")
                .in("shipment_id", shipmentIds)
                .order("created_at")
            : Promise.resolve({ data: [] }),
          ownerIds.length
            ? supabase.from("profiles").select("id,full_name").in("id", ownerIds)
            : Promise.resolve({ data: [] }),
        ]);

        const profileNameById = new Map((profiles ?? []).map((profile) => [profile.id, profile.full_name || "Менеджер"]));
        const shipmentById = new Map(shipmentsForVehicle.map((row) => [row.id, row]));
        const ownerShipment = shipmentsForVehicle.find((row) => row.created_by === vehicleOwnerId) ?? shipmentsForVehicle.find((row) => Number(row.logistics_cost ?? 0) > 0) ?? null;

        // D1-Fix v2.4 — dedupe shipments by id for transportTotalUsd computation.
        const dedupedShipments = Array.from(
          new Map(shipmentsForVehicle.map((row) => [row.id, { id: row.id, logistics_cost_usd: row.logistics_cost_usd }])).values(),
        );

        vehicleContext = v
          ? {
              vehicle: v as VehicleContext["vehicle"],
              ownerName: vehicleOwnerId ? profileNameById.get(vehicleOwnerId) ?? "Власник авто" : "Власник авто",
              ownerShipment: ownerShipment
                ? {
                    id: ownerShipment.id,
                    logistics_cost: ownerShipment.logistics_cost,
                    logistics_cost_currency: ownerShipment.logistics_cost_currency,
                  }
                : null,
              loadedItems: (vehicleItems ?? []).map((vehicleItem) => {
                const parentShipment = shipmentById.get(vehicleItem.shipment_id);
                const ownerId = parentShipment?.owner_id ?? null;
                return {
                  id: vehicleItem.id,
                  shipment_id: vehicleItem.shipment_id,
                  shipment_code: parentShipment?.code ?? "—",
                  supplier_name: parentShipment?.supplier_name ?? null,
                  owner_id: ownerId,
                  owner_name: ownerId ? profileNameById.get(ownerId) ?? "Менеджер" : "Менеджер",
                  product_name: vehicleItem.product_name ?? null,
                  variety: vehicleItem.variety ?? null,
                  origin_country: vehicleItem.origin_country ?? null,
                  pallet_count: vehicleItem.pallet_count ?? null,
                  pallet_weight: vehicleItem.pallet_weight ?? null,
                  net_weight_kg: vehicleItem.net_weight_kg ?? null,
                  gross_weight_kg: vehicleItem.gross_weight_kg ?? null,
                  isCurrentShipment: vehicleItem.shipment_id === id,
                  isOwnManager: ownerId != null && ownerId === user?.id,
                };
              }),
              vehicleStatus: (v as { status?: string | null } | null)?.status ?? null,
              shipments: dedupedShipments,
            }
          : null;
      }
      const itemRows = (items.data ?? []) as ItemRow[];
      const matchIds = Array.from(
        new Set(itemRows.map((r) => r.customs_match_id).filter((v): v is string => !!v)),
      );
      const { data: refs } = matchIds.length
        ? await supabase
            .from("customs_reference")
            .select("id,product_name,country,threshold_price_usd,customs_fee_percent,euro1_markup_usd,euro1_percent")
            .in("id", matchIds)
        : { data: [] };
      return {
        shipment: sh ? ({ ...sh, vehicle_owner_id: vehicleOwnerId, supplier_name: sh.suppliers?.name ?? null } as ShipmentRow) : null,
        items: itemRows,
        products: Array.from(
          new Map(
            [
              ...((prods[0].data ?? []).map((row) => ({ name: row.product_name_ua as string })) as ProductRef[]),
              ...((prods[1].data ?? []).map((row) => ({ name: row.product_name_ua as string })) as ProductRef[]),
            ]
              .map((product) => [normalizeProductKey(product.name), { name: product.name.trim() }] as const)
              .filter(([key]) => !!key),
          ).values(),
        ),
        customsRefs: (refs ?? []) as CustomsRefMini[],
        vehicleContext,
      };
    },
  });

  // D1-Fix v2.4 — one-shot prefetch of all active customs_reference rows (965 entries; <= 2000 ceiling).
  // No per-keypress DB hits; staleTime keeps cache warm for 5 minutes.
  const { data: activeCustomsRefs } = useQuery({
    queryKey: ["customs-reference-active"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("customs_reference")
        .select("id,product_name,country,threshold_price_usd,customs_fee_percent,euro1_markup_usd,euro1_percent")
        .eq("active", true)
        .range(0, 1999);
      return (data ?? []) as ActiveCustomsRef[];
    },
  });

  // D1-Fix v2.4 — latest EUR->USD fallback when shipment has no eur_usd_rate yet.
  const { data: latestEurUsd } = useQuery({
    queryKey: ["fx-eur-usd-latest"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("exchange_rates")
        .select("rate")
        .eq("base_currency", "EUR")
        .eq("target_currency", "USD")
        .order("rate_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data ? Number((data as { rate: number }).rate) : null;
    },
  });

  const sh = data?.shipment;
  const items = data?.items ?? [];
  const products = data?.products ?? [];
  const vehicleContext = data?.vehicleContext ?? null;
  const customsRefs = data?.customsRefs ?? [];
  const refById = new Map(customsRefs.map((r) => [r.id, r])) as CustomsRefIndex;
  const country = toUaCountry(sh?.country) || "—";

  // 9F Phase D1 — strict draft/confirm/save state.
  // draftItems is the source of truth for the editor; items (DB) only feeds hydration.
  const [draftItems, setDraftItems] = useState<DraftRow[]>([]);
  const baselinesRef = useRef<Map<string, DraftRow>>(new Map());
  const [pendingDeletes, setPendingDeletes] = useState<string[]>([]);
  // P-Fix #4 — submit lock prevents the user from double-tapping "Готово"
  // and getting duplicate rows. savingRef is the synchronous guard (state
  // updates are async, so the ref blocks the second click before React
  // re-renders the disabled button).
  const savingRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  // SURGICAL RECOVERY — transport is now local draft. No autosave.
  // Persisted mirror lets retry of "Готово" after a downstream failure
  // skip re-running the transport UPDATE (diff vs. last server response).
  const [draftTransport, setDraftTransport] = useState<{ amount: string; currency: "EUR" | "USD" } | null>(null);
  const [persistedTransport, setPersistedTransport] = useState<{
    amount: number | null;
    currency: "EUR" | "USD";
    amountUsd: number | null;
    eurUsdRate: number | null;
  } | null>(null);
  // P-Fix #6 — bumping this tick auto-collapses expanded cost/details panels
  // (e.g. ItemCustomsOverride) when a new row is added, so a stale expanded
  // block can never overlap freshly added rows.
  const [collapseExpandedTick, setCollapseExpandedTick] = useState(0);

  const hasLocalChanges = (() => {
    if (pendingDeletes.length > 0) return true;
    for (const d of draftItems) {
      if (d.dbId === null) return true;
      const base = baselinesRef.current.get(d.dbId);
      if (!base) return true;
      if (isDraftDirty(d, base)) return true;
    }
    return false;
  })();

  // Hydrate draftItems from DB only when local state is clean.
  // After commitDraft we clear local state, then hydration syncs to the freshly-fetched DB rows.
  useEffect(() => {
    if (hasLocalChanges) return;
    const next = items.map(itemRowToDraft);
    baselinesRef.current = new Map(next.map((d) => [d.dbId as string, { ...d }]));
    setDraftItems(next);
    setPendingDeletes([]);
    // We intentionally depend on `items` reference; hasLocalChanges is checked above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const patchDraft = useCallback((localId: string, patch: Partial<DraftRow>) => {
    setDraftItems((prev) => prev.map((d) => (d.localId === localId ? { ...d, ...patch } : d)));
  }, []);

  const removeDraft = useCallback((localId: string) => {
    setDraftItems((prev) => {
      const target = prev.find((d) => d.localId === localId);
      if (!target) return prev;
      if (target.dbId) {
        setPendingDeletes((pd) => (pd.includes(target.dbId as string) ? pd : [...pd, target.dbId as string]));
      }
      return prev.filter((d) => d.localId !== localId);
    });
  }, []);

  // DB rows currently visible (existing rows not pending delete) — used for server-computed fields
  // (customs status, indicative/invoice cost) which only exist on persisted rows.
  const dbItemsVisible = items.filter((it) => !pendingDeletes.includes(it.id));
  const dbItemById = new Map(items.map((it) => [it.id, it]));
  const validDbItems = dbItemsVisible.filter(isValidShipmentItem);

  // Patch 6B: count RED rows (valid persisted, no customs_match_id) lacking a confirmed
  // manual customs duty — used to gate Done/Назад.
  const redUnconfirmedCount = validDbItems.filter(
    (it) =>
      !it.customs_match_id &&
      !(it.customs_override_confirmed_at && it.customs_override_duty_usd != null),
  ).length;

  // Customs match status for the header indicator (server-computed only).
  const fallbackItems = validDbItems
    .map((it) => {
      const ref = it.customs_match_id ? refById.get(it.customs_match_id) : null;
      if (!ref) return null;
      const cand = getCountryCandidatesNormalized(it.origin_country ?? "");
      const sameCountry = cand.has(normalizeCustomsKey(ref.country));
      return sameCountry ? null : { item: it, ref };
    })
    .filter((v): v is { item: ItemRow; ref: CustomsRefMini } => !!v);
  const customsStatus: "found" | "fallback" | "none" =
    validDbItems.length === 0
      ? "none"
      : fallbackItems.length > 0
        ? "fallback"
        : "found";

  // D1: incomplete + hasRealPallets are now derived from the visible draft state.
  const incompleteCount = draftItems.filter((d) => getMissingDraftFields(d, products).length > 0).length;
  const hasRealPallets = draftItems.some(
    (d) => d.product_name.trim().length > 0 && d.pallet_count > 0,
  );
  const currentShipmentOwnerId = sh ? sh.import_manager_id ?? sh.created_by ?? null : null;
  const currentShipmentEditable = !!user?.id && (
    !!isAdmin
    || sh?.created_by === user.id
    || sh?.import_manager_id === user.id
    || sh?.import_manager_id === currentManagerId
  );

  // D1 §5 — capacity must reflect draftItems (not stale DB rows of current shipment).
  // Other shipments' rows stay as-is from vehicleContext.loadedItems.
  const currentLoadedSample = vehicleContext?.loadedItems.find((li) => li.isCurrentShipment) ?? null;
  const draftAsLoaded = draftItems.map((d) => ({
    id: d.localId,
    shipment_id: id,
    shipment_code: currentLoadedSample?.shipment_code ?? sh?.code ?? "—",
    supplier_name: currentLoadedSample?.supplier_name ?? sh?.supplier_name ?? null,
    owner_id: currentLoadedSample?.owner_id ?? currentShipmentOwnerId,
    owner_name: currentLoadedSample?.owner_name ?? "Менеджер",
    product_name: d.product_name || null,
    variety: d.variety || null,
    origin_country: d.origin_country || null,
    pallet_count: d.pallet_count,
    pallet_weight: d.pallet_count > 0 ? d.net_weight_kg / d.pallet_count : 0,
    net_weight_kg: d.net_weight_kg,
    gross_weight_kg: d.gross_weight_kg,
    isCurrentShipment: true,
    isOwnManager: (currentLoadedSample?.owner_id ?? currentShipmentOwnerId) === user?.id,
  }));
  const effectiveLoadedItems = vehicleContext
    ? [...vehicleContext.loadedItems.filter((li) => !li.isCurrentShipment), ...draftAsLoaded]
    : draftAsLoaded;
  const effectiveVehicleContext: VehicleContext | null = vehicleContext
    ? { ...vehicleContext, loadedItems: effectiveLoadedItems }
    : null;

  // SURGICAL RECOVERY — baseline + parsed-draft + preview-context patch.
  // baselineTransport: persisted mirror (after successful UPDATE) ?? DB row.
  const baselineTransport = useMemo(() => {
    if (persistedTransport) return persistedTransport;
    const baseAmount =
      vehicleContext?.ownerShipment?.logistics_cost ?? sh?.logistics_cost ?? null;
    const baseCur =
      (vehicleContext?.ownerShipment?.logistics_cost_currency ?? sh?.logistics_cost_currency ?? "EUR") as
        | "EUR"
        | "USD";
    return {
      amount: baseAmount,
      currency: baseCur,
      amountUsd: sh?.logistics_cost_usd ?? null,
      eurUsdRate: sh?.eur_usd_rate ?? null,
    };
  }, [persistedTransport, vehicleContext?.ownerShipment, sh]);

  // Parse the draft amount: supports "2000", "2000.50", "2000,50".
  // Trailing "." or "," is held back as "invalid" so it cannot be saved
  // and cannot drive a preview number.
  const draftParsed = useMemo(() => {
    if (!draftTransport) return null;
    const trimmed = draftTransport.amount.trim();
    if (trimmed === "") return { valid: true, num: 0, empty: true } as const;
    if (/[.,]$/.test(trimmed)) return { valid: false, num: Number.NaN, empty: false } as const;
    const n = Number(trimmed.replace(",", "."));
    if (!Number.isFinite(n)) return { valid: false, num: Number.NaN, empty: false } as const;
    return { valid: true, num: n, empty: false } as const;
  }, [draftTransport]);

  const hasPositiveManualTransport = !!draftTransport && !!draftParsed?.valid && draftParsed.num > 0;
  const draftCurrency: "EUR" | "USD" = draftTransport?.currency ?? baselineTransport.currency;

  // FX selection mirrors DB calc_shipment_logistics_usd: snapshot first, latest fallback.
  // SURGICAL RECOVERY — after a successful transport UPDATE we may still be
  // mid-commit (downstream step failed); `sh` is stale until refetch lands,
  // so the freshly-persisted snapshot (persistedTransport.eurUsdRate) wins.
  const isValidFx = (x: number | null | undefined): x is number =>
    typeof x === "number" && Number.isFinite(x) && x > 0;
  const effectiveFx = isValidFx(persistedTransport?.eurUsdRate ?? null)
    ? Number(persistedTransport!.eurUsdRate)
    : isValidFx(sh?.eur_usd_rate)
      ? Number(sh!.eur_usd_rate)
      : isValidFx(latestEurUsd ?? null)
        ? Number(latestEurUsd)
        : null;

  // Local preview USD for the transport amount.
  // null = "no working FX for EUR" -> do NOT override persisted preview.
  let effectiveTransportUsd: number | null = null;
  if (draftTransport) {
    if (!hasPositiveManualTransport) {
      // empty / 0 / invalid → user-cleared transport → preview shows 0
      effectiveTransportUsd = 0;
    } else if (draftCurrency === "USD") {
      effectiveTransportUsd = draftParsed!.num;
    } else if (effectiveFx != null) {
      effectiveTransportUsd = draftParsed!.num * effectiveFx;
    } else {
      effectiveTransportUsd = null;
    }
  }

  const transportTargetId = vehicleContext?.ownerShipment?.id ?? sh?.id ?? null;
  const hasVehicle = !!sh?.vehicle_id;

  // Patched preview contexts (point-replace only the owner's logistics_cost_usd).
  const shForPreview = useMemo(() => {
    if (!sh || !draftTransport || hasVehicle || effectiveTransportUsd == null) return sh ?? null;
    return { ...sh, logistics_cost_usd: effectiveTransportUsd };
  }, [sh, draftTransport, hasVehicle, effectiveTransportUsd]);

  const vehicleContextForPreview = useMemo(() => {
    if (!vehicleContext || !draftTransport || !hasVehicle || effectiveTransportUsd == null || !transportTargetId) {
      return vehicleContext;
    }
    return {
      ...vehicleContext,
      shipments: vehicleContext.shipments.map((row) =>
        row.id === transportTargetId ? { ...row, logistics_cost_usd: effectiveTransportUsd } : row,
      ),
    };
  }, [vehicleContext, draftTransport, hasVehicle, effectiveTransportUsd, transportTargetId]);

  // D1-Fix v2.5.1 — live preview map (localId -> { isDirty, value, components }).
  // Clean existing row -> show DB final_cost_*; dirty/new row -> show preview value (or "—").
  // D1-Fix v2.5.2 — also carries live customs status.
  // D1-Fix v2.5.3 — also carries component breakdown values; clean rows use
  // the saved customs_match_id row from refById (deactivation-safe), never re-pick.
  type PreviewEntry = {
    isDirty: boolean;
    value: { indicative: number; invoice: number } | null;
    hasCustomsInputs: boolean;
    liveCustomsStatus: "green" | "yellow" | "red" | null;
    components: RowComponents;
  };
  const previewMap = useMemo(() => {
    const m = new Map<string, PreviewEntry>();
    for (const d of draftItems) {
      const dbItem = d.dbId ? dbItemById.get(d.dbId) ?? null : null;
      const baseline = d.dbId ? baselinesRef.current.get(d.dbId) ?? null : null;
      // SURGICAL RECOVERY — split two notions:
      //  - rowDirty:        row-level field changes (drives customs safety).
      //  - useLiveCost:     also true when only transport draft changed, so
      //                     the main CostPair shows preview.value instead of
      //                     stale dbItem.final_cost_* values.
      const rowDirty = d.dbId == null || !baseline || isDraftDirty(d, baseline);
      const isCleanForCustoms = !rowDirty;
      const useLiveCost = rowDirty || draftTransport !== null;

      const isClean = isCleanForCustoms;
      let savedRefForClean: ActiveCustomsRef | null = null;
      if (isClean && dbItem?.customs_match_id) {
        const r = refById.get(dbItem.customs_match_id);
        if (r) {
          savedRefForClean = {
            id: r.id,
            product_name: r.product_name,
            country: r.country,
            threshold_price_usd: r.threshold_price_usd,
            customs_fee_percent: r.customs_fee_percent,
            euro1_markup_usd: r.euro1_markup_usd,
            euro1_percent: r.euro1_percent,
          };
        }
      }

      const { value, components } = computeRowPreview(
        d,
        dbItem,
        shForPreview ?? null,
        vehicleContextForPreview,
        activeCustomsRefs ?? null,
        latestEurUsd ?? null,
        products,
        isClean,
        savedRefForClean,
      );

      // Live customs chip status derived from the same components.customsBasis
      // so the chip and breakdown panel can never disagree.
      const productTrim = d.product_name.trim();
      const countryTrim = d.origin_country.trim();
      const hasCustomsInputs = !!productTrim && !!countryTrim;
      let liveCustomsStatus: "green" | "yellow" | "red" | null = null;
      if (hasCustomsInputs) {
        if (components.customsBasis === "exact") liveCustomsStatus = "green";
        else if (components.customsBasis === "fallback") liveCustomsStatus = "yellow";
        else if (components.customsBasis === "none") liveCustomsStatus = "red";
        // "manual" leaves chip null — the manual override widget owns the UI.
      }

      m.set(d.localId, { isDirty: useLiveCost, value, hasCustomsInputs, liveCustomsStatus, components });
    }
    return m;
    // baselinesRef and refById are intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftItems, dbItemById, shForPreview, vehicleContextForPreview, activeCustomsRefs, latestEurUsd, products, draftTransport]);

  // 9F Phase C2b — truck capacity uses gross_weight_kg; fallback to legacy pc*pallet_weight when gross missing.
  const { pallets: loadedPallets, grossKg: loadedKg } = sumCapacity(effectiveLoadedItems);
  const remainingPallets = Math.max(0, MAX_PALLETS - loadedPallets);
  const remainingKg = Math.max(0, MAX_WEIGHT_KG - loadedKg);
  const canEditTransport = !!sh && (!sh.vehicle_id
    ? currentShipmentEditable
    : !!user?.id && !!vehicleContext?.ownerShipment && vehicleContext.ownerShipment.id === sh.id && sh.vehicle_owner_id === user.id);

  // SURGICAL RECOVERY — UI transport value reflects local draft (if any),
  // otherwise the persisted baseline. Cleared draft hides the old DB number.
  const transportCostValue = draftTransport
    ? (draftParsed!.valid ? draftParsed!.num : 0)
    : Number(baselineTransport.amount ?? 0);
  const transportMissing = canEditTransport && transportCostValue <= 0;
  const canSaveForLater = !!fromOfferId && hasRealPallets && incompleteCount === 0;


  const [shake, setShake] = useState(false);
  const [flashTransport, setFlashTransport] = useState(false);
  const [pulseFields, setPulseFields] = useState(false);
  const triggerShake = (flashTr: boolean) => {
    setFlashTransport(flashTr);
    setPulseFields(true);
    setShake(false);
    requestAnimationFrame(() => setShake(true));
    window.setTimeout(() => {
      setShake(false);
      setPulseFields(false);
      if (flashTr) setFlashTransport(false);
    }, 1500);
  };

  // R1A — offer-prefill state machine.
  // States:
  //   idle      — no fromOffer in URL
  //   loading   — prefill request in flight (or about to start)
  //   applied   — prefilled row exists (or items already populated)
  //   blocked: no_position_id — source offer has no position anchor (legacy)
  //   blocked: zero_pending  — offer has no remaining approved pallets
  //   failed    — fetch/RPC error; Retry button is the only way out
  // prefillRunRef is the single-attempt guard. offerPrefillAttempt is the
  // reactive retry nonce — bumping it re-runs the effect after Retry resets
  // prefillRunRef. prefillSeqRef is the stale-response guard: every attempt
  // captures its sequence and discards mutations that arrive after a newer
  // attempt (or after id/fromOfferId change).
  type OfferPrefillState =
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "applied"; offerId: string | null }
    | { kind: "blocked"; reason: "no_position_id" | "zero_pending"; offerId: string }
    | { kind: "failed"; offerId: string; error: string | null };
  const [offerPrefill, setOfferPrefill] = useState<OfferPrefillState>(
    () => (fromOfferId ? { kind: "loading" } : { kind: "idle" }),
  );
  const [offerPrefillAttempt, setOfferPrefillAttempt] = useState(0);
  const prefillRunRef = useRef(false);
  const prefillSeqRef = useRef(0);

  // R1A — leavingRef gates the auto-first-row effect during Back cleanup so
  // a fresh empty draft cannot reappear after deleteEmptyDraftShipment runs.
  // autoFirstRowSpawnedRef is a single-shot guard per shipment id.
  const leavingRef = useRef(false);
  const autoFirstRowSpawnedRef = useRef(false);

  // R1A — reset prefill/auto-first-row state on shipment id or fromOfferId
  // change. Must run before any effect that reads these refs/state.
  useEffect(() => {
    prefillRunRef.current = false;
    autoFirstRowSpawnedRef.current = false;
    leavingRef.current = false;
    setOfferPrefill(fromOfferId ? { kind: "loading" } : { kind: "idle" });
    setOfferPrefillAttempt(0);
    // prefillSeqRef is bumped on entry of the prefill effect; we also bump
    // here so any in-flight handler from a previous route becomes stale.
    prefillSeqRef.current += 1;
  }, [id, fromOfferId]);

  // Auto-prefill a product row + freight from the source manager offer when
  // creating a new shipment directly under that offer ("Створити нову
  // поставку" button). Runs once per shipment. Retry via offerPrefillAttempt.
  useEffect(() => {
    if (!fromOfferId || !sh || !currentShipmentEditable) return;
    // Already-resolved guard: shipment already has rows → no-op, never
    // remain stuck in loading.
    if (items.length > 0) {
      if (!prefillRunRef.current) {
        prefillRunRef.current = true;
        setOfferPrefill({ kind: "applied", offerId: fromOfferId });
      }
      return;
    }
    if (prefillRunRef.current) return;
    prefillRunRef.current = true;
    const seq = ++prefillSeqRef.current;
    const isStale = () => prefillSeqRef.current !== seq;
    (async () => {
      try {
        const { data: offer, error: offerErr } = await supabase
          .from("manager_offers")
          .select(
            "id,product_name,origin_country,caliber,variety,pallet_net_kg,pallet_gross_kg,price_per_kg,price_currency,freight_amount,freight_currency,position_id,import_manager_id",
          )
          .eq("id", fromOfferId)
          .maybeSingle();
        if (isStale()) return;
        if (offerErr || !offer) {
          setOfferPrefill({ kind: "failed", offerId: fromOfferId, error: offerErr?.message ?? "Не вдалося завантажити пропозицію" });
          return;
        }

        // Phase 2 hard guard: offers without a position anchor are legacy.
        // Do NOT silently mint a new product identity here — block the
        // prefill explicitly so the user fixes the source offer first.
        const offerPositionId =
          (offer as { position_id?: string | null }).position_id ?? null;
        if (!offerPositionId) {
          toast.error(
            "Пропозиція без position_id (legacy). Створення поставки за пропозицією заблоковано.",
          );
          setOfferPrefill({ kind: "blocked", reason: "no_position_id", offerId: fromOfferId });
          return;
        }

        // Defense-in-depth Net/Gross gate. shipments/new.tsx already guards
        // creation, but the products screen may be reached directly.
        // Require net > 0 and gross > net. NO fallback to pallet_weight.
        const offerNet = Number((offer as { pallet_net_kg?: number | null }).pallet_net_kg ?? NaN);
        const offerGross = Number((offer as { pallet_gross_kg?: number | null }).pallet_gross_kg ?? NaN);
        const netGrossOk =
          Number.isFinite(offerNet) &&
          Number.isFinite(offerGross) &&
          offerNet > 0 &&
          offerGross > offerNet;
        if (!netGrossOk) {
          toast.error(
            "У пропозиції не заповнено коректні нетто та брутто. Спочатку відредагуйте пропозицію.",
          );
          setOfferPrefill({ kind: "blocked", reason: "no_position_id", offerId: fromOfferId });
          return;
        }

        // Pending по всьому offer: approved - ordered - cancelled (через allocation_parts).
        const { data: responses, error: responsesError } = await supabase
          .from("manager_offer_responses")
          .select("approved_pallets")
          .eq("offer_id", offer.id);
        if (isStale()) return;
        if (responsesError) {
          setOfferPrefill({
            kind: "failed",
            offerId: fromOfferId,
            error: "Не вдалося завантажити відповіді по пропозиції",
          });
          return;
        }
        const approvedTotal = (responses ?? []).reduce(
          (s, r) =>
            s + Number((r as { approved_pallets: number | null }).approved_pallets ?? 0),
          0,
        );

        const { data: allocParts, error: allocPartsError } = await supabase
          .from("manager_offer_allocation_parts")
          .select("pallets, status")
          .eq("offer_id", offer.id);
        if (isStale()) return;
        if (allocPartsError) {
          setOfferPrefill({
            kind: "failed",
            offerId: fromOfferId,
            error: "Не вдалося завантажити розподіл пропозиції",
          });
          return;
        }
        const orderedTotal = (allocParts ?? [])
          .filter((p) => (p as { status: string }).status === "ordered")
          .reduce((s, p) => s + Number((p as { pallets: number | null }).pallets ?? 0), 0);
        const cancelledTotal = (allocParts ?? [])
          .filter((p) => (p as { status: string }).status === "cancelled")
          .reduce((s, p) => s + Number((p as { pallets: number | null }).pallets ?? 0), 0);

        const pending = approvedTotal - orderedTotal - cancelledTotal;

        // Capacity uses GROSS (truck KG ceiling); pallet count then drives
        // both net and gross totals from per-pallet values.
        const TARGET_KG = 21000;
        const desiredPalletCount = Math.min(
          MAX_PALLETS,
          Math.max(1, Math.floor(TARGET_KG / offerGross)),
        );
        const safePalletCount = Math.min(desiredPalletCount, pending);

        if (safePalletCount <= 0) {
          toast.error("Немає вільних палет за цією пропозицією");
          setOfferPrefill({ kind: "blocked", reason: "zero_pending", offerId: fromOfferId });
          return;
        }
        if (safePalletCount < desiredPalletCount) {
          toast.info(
            `Кількість зменшено до ${safePalletCount} палет за залишком пропозиції`,
          );
        }

        const netKg = safePalletCount * offerNet;
        const grossKg = safePalletCount * offerGross;

        if (isStale()) return;
        setDraftItems((prev) => {
          if (prev.some((draft) => draft.source_offer_id === offer.id)) return prev;
          return [
            ...prev,
            {
              ...emptyDraftRow(),
              source_offer_id: offer.id,
              source_position_id: offerPositionId,
              source_offer_freight_amount: Number(offer.freight_amount ?? 0),
              source_offer_freight_currency: offer.freight_currency ?? "EUR",
              product_name: offer.product_name ?? "",
              origin_country: offer.origin_country ? normalizeCountry(offer.origin_country) : "",
              caliber: offer.caliber ?? "",
              variety: offer.variety ?? "",
              pallet_count: safePalletCount,
              net_weight_kg: netKg,
              gross_weight_kg: grossKg,
              unit_price: Number(offer.price_per_kg ?? 0),
              price_currency: (offer.price_currency ?? "EUR") as "EUR" | "USD",
            },
          ];
        });
        setOfferPrefill({ kind: "applied", offerId: fromOfferId });

        qc.invalidateQueries({ queryKey: ["shipment-products", user?.id, id] });
        qc.invalidateQueries({ queryKey: ["shipment", id] });
        qc.invalidateQueries({ queryKey: ["manager-offers"] });
        qc.invalidateQueries({ queryKey: ["manager-offer-linked-shipments"] });
        qc.invalidateQueries({ queryKey: ["manager-offer-targets"] });
        qc.invalidateQueries({ queryKey: ["shipments-link-options"] });
        qc.invalidateQueries({ queryKey: ["manager-offer-responses"] });
        qc.invalidateQueries({ queryKey: ["link-dialog-offer"] });
        qc.invalidateQueries({ queryKey: ["branch-active-offers"] });
        qc.invalidateQueries({ queryKey: ["my-branch-responses"] });
        qc.invalidateQueries({ queryKey: ["branch-offer-shipments"] });
        qc.invalidateQueries({ queryKey: ["nav-branch-manager-offers"] });
        qc.invalidateQueries({ queryKey: ["nav-pending-manager-responses"] });
        qc.invalidateQueries({ queryKey: ["dash-manager"] });
        invalidateVehicleAndShipmentCaches(qc);
      } catch (err) {
        if (isStale()) return;
        setOfferPrefill({
          kind: "failed",
          offerId: fromOfferId,
          error: err instanceof Error ? err.message : null,
        });
      }
    })();
  }, [fromOfferId, sh, items.length, currentShipmentEditable, id, qc, user?.id, offerPrefillAttempt]);

  // R1A — Retry handler for offer-prefill failures. Resets the single-shot
  // guard, flips state back to loading, and bumps the reactive attempt nonce
  // so the prefill effect re-runs exactly once.
  const retryOfferPrefill = useCallback(() => {
    if (!fromOfferId) return;
    prefillRunRef.current = false;
    setOfferPrefill({ kind: "loading" });
    setOfferPrefillAttempt((n) => n + 1);
  }, [fromOfferId]);





  // D1 §8 — "Назад": discard local draft + pendingDeletes, no DB writes.
  // Safety: deleteEmptyDraftShipment only removes a truly empty newly created shipment
  // (it checks the DB; under D1 manual rows never reach DB until "Готово", so a fresh
  // shipment with no prefill and no committed rows stays eligible for cleanup).
  const leaveProducts = async () => {
    // R1A — gate auto-first-row effect immediately; cleanup is async and a
    // local empty row must not be re-spawned between setDraftItems([]) and
    // the navigate call below.
    leavingRef.current = true;
    setDraftItems([]);
    setPendingDeletes([]);
    baselinesRef.current = new Map();
    let deleted = false;
    try {
      const res = await deleteEmptyDraftShipmentFn({ data: { shipmentId: id } });
      deleted = res.deleted;
    } catch {
      deleted = false;
    }
    if (deleted) {
      navigate({ to: "/shipments" });
      return;
    }
    await syncVehicleStateForShipment(id);
    qc.invalidateQueries({ queryKey: ["shipment-products", user?.id, id] });
    invalidateVehicleAndShipmentCaches(qc);
    navigate({ to: "/shipments" });
  };

  // D1 — manual addItem: local draft only, NO INSERT.
  const addItem = () => {
    // R1A — hard guard: while a fromOffer prefill is loading / blocked /
    // failed, no Add entry point may create a manual draft row. Every UI
    // trigger (header +, empty-state button, footer Add, keyboard shortcut)
    // must route through this single function.
    if (fromOfferId && offerPrefill.kind !== "applied") {
      return;
    }
    if (!currentShipmentEditable) {
      toast.error("Ви можете додавати товари лише у власну поставку");
      return;
    }
    if (sh?.vehicle_id && remainingPallets <= 0 && remainingKg <= 0) {
      toast.error("У спільному авто більше немає вільного місця");
      return;
    }
    // P-Fix #6 — collapse any open cost/details panels so they don't overlap
    // freshly added rows when the table layout reflows.
    setCollapseExpandedTick((t) => t + 1);
    setDraftItems((prev) => [...prev, emptyDraftRow()]);
  };

  // R1A — auto-first local row. After /shipments/new becomes header-only it
  // creates a draft shipment and navigates here with zero shipment_items.
  // The editor must show one ready-to-fill row immediately, locally — no DB
  // write. Predicate uses every guard from the contract; setDraftItems uses
  // a functional updater + length check so a concurrent local row cannot be
  // replaced. Located AFTER the hydration effect (line ~704), so hydration
  // can't overwrite the spawned row once autoFirstRowSpawnedRef is set.
  useEffect(() => {
    if (!data) return; // shipment query must be successful
    if (items.length !== 0) return;
    if (draftItems.length !== 0) return;
    if (pendingDeletes.length !== 0) return;
    if (!currentShipmentEditable) return;
    if (fromOfferId) return;
    if (offerPrefill.kind !== "idle") return;
    if (savingRef.current) return;
    if (leavingRef.current) return;
    if (autoFirstRowSpawnedRef.current) return;
    autoFirstRowSpawnedRef.current = true;
    setDraftItems((prev) => (prev.length > 0 ? prev : [emptyDraftRow()]));
  }, [
    data,
    items.length,
    draftItems.length,
    pendingDeletes.length,
    currentShipmentEditable,
    fromOfferId,
    offerPrefill,
  ]);



  // D1 §6 — INSERT/UPDATE payload preserves current net/gross + legacy compat-shim.
  // Pure builder lives in @/lib/shipment-row-engine (Build A); thin wrapper kept
  // here so call sites stay byte-identical.
  const buildPayload = useCallback(
    (d: DraftRow, opts: { forUpdate: boolean }): Record<string, unknown> =>
      buildShipmentItemPayload(d, { products, shipmentId: id }, opts),
    [products, id],
  );

  // D1 §3 — non-atomic client batch: validate → INSERT new → UPDATE dirty → DELETE last.
  const commitDraft = async () => {
    // P-Fix #4 — synchronous re-entry guard (UI disable alone is too late
    // because React renders after the second tap has already dispatched).
    if (savingRef.current) return;
    if (!currentShipmentEditable) {
      toast.error("Ви можете редагувати лише власну поставку");
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    try {
    // 1. Validate every visible draft row.
    const anyInvalid = draftItems.some((d) => getMissingDraftFields(d, products).length > 0);
    if (anyInvalid) {
      toast.error("Заповніть обов'язкові поля");
      triggerShake(false);
      return;
    }
    // 1b. Mobile-typo guard: net must not exceed gross.
    const anyNetGtGross = draftItems.some((d) => isNetGreaterThanGross(d));
    if (anyNetGtGross) {
      toast.error("Нетто не може бути більше брутто");
      triggerShake(false);
      return;
    }
    // 2. D1-Fix v2.4 — capacity validation (vehicle-wide) BEFORE any DB writes.
    // No pallet_count clamp; only block "Готово".
    const { pallets: capPallets, grossKg: capGrossKg } = sumCapacity(effectiveLoadedItems);
    if (capGrossKg > MAX_WEIGHT_KG) {
      toast.error(`Перевищено вагу авто: ${Math.round(capGrossKg)} кг > ${MAX_WEIGHT_KG} кг`);
      triggerShake(false);
      return;
    }
    if (capPallets > MAX_PALLETS) {
      toast.error(`Перевищено палети авто: ${capPallets} > ${MAX_PALLETS}`);
      triggerShake(false);
      return;
    }

    // D1-Fix v2.5.4 — product/country recognition gate BEFORE any DB writes.
    // Uses hints captured by row resolver only when productKey/countryKey/packageKey
    // match the current draft row; otherwise re-checks via read-only RPC.
    const BLOCKING: ResolverHintStatus[] = [
      "product_no_match",
      "product_ambiguous",
      "country_no_match",
    ];
    const TOAST_PRODUCT = "Товар не розпізнано. Уточніть назву товару.";
    const TOAST_COUNTRY = "Країну не розпізнано. Уточніть країну.";
    const TOAST_RPC_FAIL = "Не вдалося перевірити товар. Спробуйте ще раз.";

    type CheckOutcome =
      | { kind: "ok" }
      | { kind: "block"; status: ResolverHintStatus }
      | { kind: "rpc_fail" };

    const checks: CheckOutcome[] = await Promise.all(
      draftItems.map(async (d): Promise<CheckOutcome> => {
        const productKey = resolverKeyOf(d.product_name);
        const countryKey = resolverKeyOf(d.origin_country);
        const packageKey = resolverKeyOf(d.package_used);
        const hint = resolverHintsRef.current.get(d.localId);
        const hintFresh =
          hint &&
          hint.productKey === productKey &&
          hint.countryKey === countryKey &&
          hint.packageKey === packageKey;
        if (hintFresh) {
          if (BLOCKING.includes(hint!.status)) {
            return { kind: "block", status: hint!.status };
          }
          return { kind: "ok" };
        }
        // Missing or stale hint → read-only resolver check, no state mutation.
        if (!productKey || !countryKey) {
          // getMissingDraftFields already covered empty cases above; defensive
          // pass-through here to avoid double-toasting.
          return { kind: "ok" };
        }
        try {
          const { data, error } = await supabase.rpc(
            "rpc_resolve_offer_line_defaults" as never,
            {
              p_product_query: d.product_name.trim(),
              p_country_query: d.origin_country.trim(),
              p_package_used: d.package_used.trim() || null,
              p_include_reserve: false,
            } as never,
          );
          if (error) return { kind: "rpc_fail" };
          const row = Array.isArray(data) ? (data as unknown[])[0] : data;
          const status =
            row && typeof row === "object"
              ? ((row as Record<string, unknown>).status as ResolverHintStatus | undefined)
              : undefined;
          if (status && BLOCKING.includes(status)) {
            return { kind: "block", status };
          }
          return { kind: "ok" };
        } catch {
          return { kind: "rpc_fail" };
        }
      }),
    );

    const rpcFailed = checks.find((c) => c.kind === "rpc_fail");
    if (rpcFailed) {
      toast.error(TOAST_RPC_FAIL);
      triggerShake(false);
      return;
    }
    const blocker = checks.find(
      (c): c is { kind: "block"; status: ResolverHintStatus } => c.kind === "block",
    );
    if (blocker) {
      toast.error(
        blocker.status === "country_no_match" ? TOAST_COUNTRY : TOAST_PRODUCT,
      );
      triggerShake(false);
      return;
    }

    try {
      // SURGICAL RECOVERY — step 5: validate manual transport draft.
      if (draftTransport && draftParsed && !draftParsed.valid) {
        toast.error("Невірна сума перевезення");
        triggerShake(true);
        return;
      }
      // SURGICAL RECOVERY — step 6: verified transport UPDATE.
      // Runs ONLY for a positive manual draft AND a diff vs. baseline.
      // Must complete BEFORE any shipment_items / position / FIFO writes.
      if (hasPositiveManualTransport && transportTargetId) {
        const baselineAmount = Number(baselineTransport.amount ?? 0);
        const baselineCurrency = baselineTransport.currency;
        const changed =
          draftParsed!.num !== baselineAmount || draftCurrency !== baselineCurrency;
        if (changed) {
          const { data: updRows, error: updErr } = await supabase
            .from("shipments")
            .update({
              logistics_cost: draftParsed!.num,
              logistics_cost_currency: draftCurrency,
            })
            .eq("id", transportTargetId)
            .select("id, logistics_cost, logistics_cost_currency, logistics_cost_usd, eur_usd_rate");
          if (updErr) {
            toast.error(translateError(updErr));
            return;
          }
          const rows = (updRows ?? []) as Array<{
            id: string;
            logistics_cost: number | null;
            logistics_cost_currency: string | null;
            logistics_cost_usd: number | null;
            eur_usd_rate: number | null;
          }>;
          if (rows.length !== 1 || rows[0].id !== transportTargetId) {
            toast.error("Не вдалося оновити вартість перевезення");
            return;
          }
          const u = rows[0];
          setPersistedTransport({
            amount: u.logistics_cost,
            currency: ((u.logistics_cost_currency ?? "EUR") as "EUR" | "USD"),
            amountUsd: u.logistics_cost_usd,
            eurUsdRate: u.eur_usd_rate,
          });
        }
      }

      // 3. Phase 2: INSERT new rows ONE BY ONE with position anchor.
      // For each new draft: create operational_position (draft) → insert
      // shipment_item → attach to position via RPC. On any failure, delete
      // all just-inserted items and roll back their fresh positions.
      const newDrafts = draftItems.filter((d) => d.dbId === null);

      const insertedIds: string[] = [];
      const createdPositionIds: string[] = [];
      let abortReason: string | null = null;

      for (const d of newDrafts) {
        // Build 2A — delegated to shared helper. Semantics unchanged:
        // manual rows create a fresh draft position; offer rows reuse
        // d.source_position_id. Helper rolls back its own inserted
        // shipment_item on attach/FIFO failure; caller still rolls back
        // freshly-created positions via createdPositionIds.
        const payload = buildPayload(d, { forUpdate: false });
        const res = await commitNewShipmentItem({
          shipmentId: id,
          draft: {
            localId: d.localId,
            source_offer_id: d.source_offer_id ?? null,
            source_position_id: d.source_position_id ?? null,
            product_name: d.product_name,
            origin_country: d.origin_country,
            caliber: d.caliber,
            package_used: d.package_used,
            pallet_count: d.pallet_count,
          },
          payload,
          responsibleManagerId: sh?.import_manager_id ?? null,
        });
        if (res.createdPositionId) createdPositionIds.push(res.createdPositionId);
        if (!res.ok) {
          abortReason = res.reason;
          break;
        }
        insertedIds.push(res.itemId);
      }

      if (abortReason) {
        // Cleanup orphan shipment_items and roll back their positions.
        if (insertedIds.length > 0) {
          await supabase.from("shipment_items").delete().in("id", insertedIds);
        }
        for (const pid of createdPositionIds) {
          await rollbackBirthPosition(pid);
        }
        toast.error(abortReason);
        return;
      }

      // Stage 3B pre-flight: detect existing rows whose pallet_count is shrinking,
      // then find linked offer allocation rows that must be rebalanced after UPDATE.
      const shrinkItemIds: string[] = [];
      for (const d of draftItems) {
        if (d.dbId === null) continue;
        const base = baselinesRef.current.get(d.dbId);
        if (!base) continue;
        const oldP = Number(base.pallet_count ?? 0);
        const newP = Number(d.pallet_count ?? 0);
        if (newP < oldP) shrinkItemIds.push(d.dbId);
      }
      const shrinkPairs: { offer_id: string; shipment_item_id: string }[] = [];
      if (shrinkItemIds.length > 0) {
        const { data: linkedRows, error: linkedErr } = await supabase
          .from("manager_offer_allocation_parts")
          .select("offer_id, shipment_item_id")
          .in("shipment_item_id", shrinkItemIds)
          .eq("status", "ordered");
        if (linkedErr) {
          toast.error(
            `Не вдалося перевірити прив'язки пропозицій: ${translateError(linkedErr)}`,
          );
          return;
        }
        const seen = new Set<string>();
        for (const row of (linkedRows ?? []) as Array<{
          offer_id: string;
          shipment_item_id: string;
        }>) {
          const key = `${row.offer_id}:${row.shipment_item_id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          shrinkPairs.push({
            offer_id: row.offer_id,
            shipment_item_id: row.shipment_item_id,
          });
        }
      }

      // 4. UPDATE dirty existing rows (dbId !== null).
      for (const d of draftItems) {
        if (d.dbId === null) continue;
        const base = baselinesRef.current.get(d.dbId);
        if (base && !isDraftDirty(d, base)) continue;
        const { error: upErr } = await supabase
          .from("shipment_items")
          .update(buildPayload(d, { forUpdate: true }) as never)
          .eq("id", d.dbId);
        if (upErr) {
          toast.error(translateError(upErr));
          return;
        }
      }

      // 4b. Stage 3B rebalance: reconcile offer allocation rows with new pallet_count.
      //     Halfway-stop on failure — do not run DELETE, do not show success.
      let rebalanceFailed = false;
      for (const { offer_id, shipment_item_id } of shrinkPairs) {
        const { error: rbErr } = await supabase.rpc(
          "rebalance_offer_allocation_for_item" as never,
          { p_offer_id: offer_id, p_shipment_item_id: shipment_item_id } as never,
        );
        if (rbErr) {
          rebalanceFailed = true;
          toast.error(
            `Не вдалося оновити залишок пропозиції (${offer_id.slice(0, 8)}…): ${translateError(rbErr)}. Видалення відкладено — натисніть "Готово" ще раз.`,
          );
        }
      }
      if (rebalanceFailed) {
        qc.invalidateQueries({ queryKey: ["manager-offers"] });
        qc.invalidateQueries({ queryKey: ["manager-offer-responses"] });
        qc.invalidateQueries({ queryKey: ["shipment-products", user?.id, id] });
        qc.invalidateQueries({ queryKey: ["shipment", id] });
        invalidateVehicleAndShipmentCaches(qc);
        return;
      }

      // 5. DELETE pendingDeletes LAST.
      if (pendingDeletes.length > 0) {
        const { error: delErr } = await supabase
          .from("shipment_items")
          .delete()
          .in("id", pendingDeletes);
        if (delErr) {
          toast.error(translateError(delErr));
        }
      }

      const offerFreightDraft = draftItems.find(
        (d) => d.source_offer_id && Number(d.source_offer_freight_amount ?? 0) > 0,
      );
      if (
        !hasPositiveManualTransport &&
        offerFreightDraft &&
        (sh?.logistics_cost == null || Number(sh.logistics_cost) <= 0)
      ) {
        const { error: freightErr } = await supabase
          .from("shipments")
          .update({
            logistics_cost: Number(offerFreightDraft.source_offer_freight_amount),
            logistics_cost_currency: offerFreightDraft.source_offer_freight_currency ?? "EUR",
          })
          .eq("id", id);
        if (freightErr) {
          toast.error(translateError(freightErr));
          return;
        }
      }

      // 6. Clear local state so hydration takes over after refetch.
      setDraftItems([]);
      setPendingDeletes([]);
      setDraftTransport(null);
      baselinesRef.current = new Map();

      await syncVehicleStateForShipment(id);
      // D1-Fix v2.4 — invalidate then FORCE-refetch ["shipment", id] before navigate.
      // Details page reads final_cost_* from this key; "type: all" reaches the unmounted route.
      qc.invalidateQueries({ queryKey: ["manager-offers"] });
      qc.invalidateQueries({ queryKey: ["manager-offer-responses"] });
      qc.invalidateQueries({ queryKey: ["shipment-products", user?.id, id] });
      qc.invalidateQueries({ queryKey: ["shipment", id] });
      qc.invalidateQueries({ queryKey: ["shipments"] });
      if (sh?.vehicle_id) {
        qc.invalidateQueries({ queryKey: ["vehicle-transport", sh.vehicle_id, id] });
      }
      invalidateVehicleAndShipmentCaches(qc);
      await qc.refetchQueries({ queryKey: ["shipment", id], type: "all" });
      void insertedIds;
      navigate({ to: "/shipments" });
    } catch (e) {
      toast.error(translateError(e));
    }
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };


  const tryLeave = (e: React.MouseEvent | null) => {
    if (redUnconfirmedCount > 0) {
      e?.preventDefault();
      toast.error(`${redUnconfirmedCount} ${redUnconfirmedCount === 1 ? "товар" : "товарів"} ${CUSTOMS_STRINGS.shipmentDoneRedSuffix}`);
      triggerShake(false);
      return false;
    }
    return true;
  };

  const fallbackOpenRef = useRef<(open: boolean) => void>(() => {});
  const [selectedFallbackId, setSelectedFallbackId] = useState<string | null>(null);
  const [mobileEditingLabel, setMobileEditingLabel] = useState<string | null>(null);
  const fallbackSelection: FallbackSelection = {
    selectedId: selectedFallbackId,
    setSelectedId: setSelectedFallbackId,
    openRef: fallbackOpenRef,
  };

  const blurActiveEditor = useCallback(() => {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    setMobileEditingLabel(null);
  }, []);

  useEffect(() => {
    const onFocusIn = (event: Event) => {
      if (!isEditableFieldTarget(event.target)) return;
      setMobileEditingLabel(getMobileEditorLabel(event.target));
    };
    const onFocusOut = (_event: Event) => {
      window.setTimeout(() => {
        if (isEditableFieldTarget(document.activeElement)) {
          setMobileEditingLabel(getMobileEditorLabel(document.activeElement));
          return;
        }
        setMobileEditingLabel(null);
      }, 0);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // D1-Fix v2.5.4 — recognition hints captured from per-row resolver runs.
  // commitDraft consumes the ref; stale or missing entries trigger a
  // read-only resolver RPC before any DB write.
  // D1-Fix v2.5.5 — state mirror (resolverHints) drives top-zone re-render.
  // The ref keeps commit/delete behavior identical to v2.5.4.
  const resolverHintsRef = useRef<Map<string, ResolverHintInfo>>(new Map());
  const [resolverHints, setResolverHints] = useState<Map<string, ResolverHintInfo>>(new Map());
  const setResolverHint = useCallback(
    (localId: string, info: ResolverHintInfo | null) => {
      if (info == null) resolverHintsRef.current.delete(localId);
      else resolverHintsRef.current.set(localId, info);
      setResolverHints((prev) => {
        const next = new Map(prev);
        if (info == null) next.delete(localId);
        else next.set(localId, info);
        return next;
      });
    },
    [],
  );

  // D1-Fix v2.5.5 — Top calculation zone open/scroll trigger from row chevrons.
  const [topZoneOpenTick, setTopZoneOpenTick] = useState(0);
  const [topZoneScrollTarget, setTopZoneScrollTarget] = useState<string | null>(null);
  const openTopZone = useCallback((localId: string) => {
    setTopZoneScrollTarget(localId);
    setTopZoneOpenTick((t) => t + 1);
  }, []);


  if (typeof document === "undefined") return null;
  return createPortal(
   <CustomsRefContext.Provider value={refById}>
    <FallbackSelectionContext.Provider value={fallbackSelection}>
    <div
      className={cn("fixed inset-x-0 top-0 z-[100] flex flex-col overflow-x-hidden overscroll-contain bg-background", shake && "animate-shake")}
      style={{ bottom: "var(--keyboard-inset, 0px)" }}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 pt-safe">
        <button
          type="button"
          onClick={() => { if (tryLeave(null)) void leaveProducts(); }}
          className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-sm font-semibold">{sh?.code ?? "…"}</div>
          <div className="flex items-center justify-center gap-1.5 text-[10px] uppercase tracking-wide">
            <span className={cn(incompleteCount > 0 ? "text-destructive" : "text-muted-foreground")}>
              {country}
              {incompleteCount > 0 && ` · ${incompleteCount} незаповн.`}
            </span>
          </div>
        </div>

        {/* R1A — while a fromOffer prefill is loading/blocked/failed, hide
            the Add (+) button entirely. Back stays available via the left
            chevron. Manual addItem is also hard-blocked at the function. */}
        {!(fromOfferId && offerPrefill.kind !== "applied") && (
          <Button size="sm" onClick={addItem} disabled={!currentShipmentEditable} className="bg-brand text-brand-foreground hover:bg-brand/90 disabled:opacity-60">
            <Plus className="h-4 w-4" />
          </Button>
        )}
        {fromOfferId && offerPrefill.kind !== "applied" && (
          <span className="w-9" aria-hidden="true" />
        )}
      </header>


      {sh && (
        <TransportBar
          shipment={sh}
          currentUserId={user?.id ?? null}
          vehicleContext={effectiveVehicleContext}
          canEditTransport={canEditTransport}
          flash={flashTransport}
          value={
            draftTransport
              ? draftTransport.amount
              : baselineTransport.amount == null || Number(baselineTransport.amount) === 0
                ? ""
                : String(baselineTransport.amount)
          }
          currency={draftTransport ? draftTransport.currency : baselineTransport.currency}
          onChange={(amount, currency) => setDraftTransport({ amount, currency })}
        />
      )}
      {effectiveVehicleContext && (
        <SharedVehicleSummary
          vehicleContext={effectiveVehicleContext}
          currentShipmentId={id}
        />
      )}

      {/* D1-Fix v2.5.5 — single top calculation zone (source of truth for
          per-row component values). Visible draftItems excluding pendingDeletes. */}
      <TopCalculationZone
        draftItems={draftItems}
        pendingDeletes={pendingDeletes}
        previewMap={previewMap}
        resolverHints={resolverHints}
        openTick={topZoneOpenTick}
        scrollTarget={topZoneScrollTarget}
      />

      <ProductsScrollArea
        itemsCount={draftItems.length}
        empty={draftItems.length === 0}
        editingToolbarVisible={!!mobileEditingLabel}
        emptyContent={
          fromOfferId && offerPrefill.kind !== "applied" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              {offerPrefill.kind === "loading" && (
                <p className="text-sm text-muted-foreground">Завантаження товару з пропозиції…</p>
              )}
              {offerPrefill.kind === "blocked" && offerPrefill.reason === "no_position_id" && (
                <p className="text-sm text-destructive">
                  Пропозиція без position_id (legacy). Створення поставки за пропозицією заблоковано.
                </p>
              )}
              {offerPrefill.kind === "blocked" && offerPrefill.reason === "zero_pending" && (
                <p className="text-sm text-destructive">
                  Немає вільних палет за цією пропозицією.
                </p>
              )}
              {offerPrefill.kind === "failed" && (
                <>
                  <p className="text-sm text-destructive">
                    Не вдалося завантажити товар з пропозиції{offerPrefill.error ? `: ${offerPrefill.error}` : ""}.
                  </p>
                  <Button onClick={retryOfferPrefill} className="bg-brand text-brand-foreground hover:bg-brand/90">
                    Повторити
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm text-muted-foreground">Позицій ще немає</p>
              <Button onClick={addItem} className="bg-brand text-brand-foreground hover:bg-brand/90">
                <Plus className="mr-1 h-4 w-4" /> Додати товар
              </Button>
            </div>
          )
        }
      >
        <ProductsTable
          drafts={draftItems}
          dbItemById={dbItemById}
          shipmentId={id}
          products={products}
          vehicleContext={effectiveVehicleContext}
          previewMap={previewMap}
          currentShipmentEditable={currentShipmentEditable}
          pulseFields={pulseFields}
          collapseExpandedTick={collapseExpandedTick}
          onPatch={patchDraft}
          onRemove={removeDraft}
          onResolverHint={setResolverHint}
          onShowBreakdown={openTopZone}
        />


        {currentShipmentEditable && !(fromOfferId && offerPrefill.kind !== "applied") && (
          <div className="sticky left-0 flex justify-center pb-2 pt-3" style={{ width: "100vw" }}>
            <Button
              type="button"
              size="sm"
              onClick={addItem}
              className="h-8 rounded-full border border-destructive/40 bg-destructive/10 px-3 text-[12px] font-semibold text-destructive shadow-sm hover:bg-destructive/20"
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Додати товар
            </Button>
          </div>
        )}



      </ProductsScrollArea>

      {mobileEditingLabel && currentShipmentEditable && (
        <div
          className="fixed inset-x-0 z-40 border-t border-border bg-background/95 px-3 py-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.5)] backdrop-blur md:hidden"
          style={{ bottom: "var(--keyboard-inset, 0px)" }}
        >
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Редагування
              </div>
              <div className="truncate text-sm font-semibold text-foreground">{mobileEditingLabel}</div>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={blurActiveEditor}
              className="h-9 shrink-0 bg-brand px-4 text-brand-foreground hover:bg-brand/90"
            >
              Готово
            </Button>
          </div>
        </div>
      )}

      <footer className="border-t border-border bg-card px-3 py-2 pb-safe">
        <button
          type="button"
          disabled={isSaving}
          className="block w-full disabled:opacity-60"
          onClick={(e) => {
            if (isSaving) { e.preventDefault(); return; }
            if (incompleteCount > 0 || !hasRealPallets || (transportMissing && !canSaveForLater)) {
              e.preventDefault();
              triggerShake(transportMissing);
              return;
            }
            if (!tryLeave(e)) return;
            void commitDraft();
          }}
        >
          <Button
            asChild={false}
            disabled={isSaving}
            className={cn(
              "w-full",
              (incompleteCount > 0 || (transportMissing && !canSaveForLater) || redUnconfirmedCount > 0)
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-brand text-brand-foreground hover:bg-brand/90",
            )}
          >
            {isSaving
              ? "Збереження…"
              : transportMissing
                ? canSaveForLater
                  ? "Зберегти зараз, перевезення додасте пізніше"
                  : "Вкажіть вартість перевезення"
                : incompleteCount > 0
                  ? `Заповніть обов'язкові поля (${incompleteCount})`
                  : redUnconfirmedCount > 0
                    ? `Підтвердіть ручну суму митного збору (${redUnconfirmedCount})`
                    : canSaveForLater
                      ? "Зберегти та вийти"
                      : "Готово"}
          </Button>
        </button>
      </footer>

    </div>
    </FallbackSelectionContext.Provider>
   </CustomsRefContext.Provider>,
   document.body,
  );
}

function TransportBar({
  shipment,
  currentUserId,
  vehicleContext,
  canEditTransport,
  flash,
  value,
  currency,
  onChange,
}: {
  shipment: ShipmentRow;
  currentUserId: string | null;
  vehicleContext: VehicleContext | null;
  canEditTransport: boolean;
  flash?: boolean;
  value: string;
  currency: "EUR" | "USD";
  onChange: (amount: string, currency: "EUR" | "USD") => void;
}) {
  // SURGICAL RECOVERY — controlled component. No useState/useRef/useEffect for the
  // amount/currency, no debounce, no supabase, no autosave. The parent owns
  // draftTransport and only commitDraft writes to the DB.
  const lockedByOwner =
    !!shipment.vehicle_id &&
    !!shipment.vehicle_owner_id &&
    !!currentUserId &&
    shipment.vehicle_owner_id !== currentUserId;
  const inputRef = useRef<HTMLInputElement>(null);
  const isEmpty = value === "" || Number(value.replace(",", ".")) <= 0;

  if (lockedByOwner || !canEditTransport) {
    // Read-only view always reflects the persisted DB value, not the controlled draft.
    const baseAmount =
      vehicleContext?.ownerShipment?.logistics_cost ?? shipment.logistics_cost;
    const baseCur =
      vehicleContext?.ownerShipment?.logistics_cost_currency ??
      shipment.logistics_cost_currency ??
      "EUR";
    const baseEmpty = baseAmount == null || Number(baseAmount) <= 0;
    const route = toUaCountry(vehicleContext?.vehicle.country ?? shipment.country) || "—";
    return (
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Транспорт
        </span>
        <span className="text-[12px] font-semibold text-foreground">
          {baseEmpty ? "—" : `${baseAmount} ${baseCur}`}
        </span>
        <span className="truncate text-[10px] text-muted-foreground">
          · {route}{vehicleContext?.ownerName ? ` · ${vehicleContext.ownerName}` : ""}
        </span>
        <span className="ml-auto shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
          перегляд
        </span>
      </div>
    );
  }

  return (
    <div className={cn(
      "group flex items-center gap-2 border-b px-3 py-1.5 transition-colors focus-within:bg-primary/5",
      isEmpty ? "border-destructive bg-destructive/10" : "border-border bg-muted/40",
      flash && "field-invalid",
    )}>
      <span className={cn(
        "text-[11px] font-semibold uppercase tracking-wide transition-colors group-focus-within:text-primary",
        isEmpty ? "text-destructive" : "text-muted-foreground",
      )}>
        Перевезення авто
      </span>
      <Input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        enterKeyHint={MOBILE_ENTER_KEY_HINT}
        placeholder="Перевезення авто"
        value={value}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={(e) => {
          e.currentTarget.select();
          scrollFocusedIntoView(e.currentTarget);
        }}
        onKeyDown={blurOnEnter}
        onBlur={() => {
          // Visual cue only: the field already pulses red while empty.
        }}
        onChange={(e) => {
          const next = e.target.value.replace(/[^\d.,-]/g, "");
          onChange(next, currency);
        }}
        className={cn(
          "h-7 flex-1 px-2 text-[12px]",
          isEmpty && "border-destructive bg-destructive/15 ring-2 ring-destructive/60",
        )}
      />
      <select
        value={currency}
        onChange={(e) => onChange(value, e.target.value as "EUR" | "USD")}
        className="h-7 rounded-md border border-input bg-background px-1.5 text-[11px]"
      >
        <option value="EUR">EUR</option>
        <option value="USD">USD</option>
      </select>
    </div>
  );
}

// D1-Fix v2.5.5 — single top calculation zone.
// Source of truth = visible draftItems (clean / dirty / new / invalid-recognition),
// minus pendingDeletes (string[] of dbIds — array semantics, type unchanged).
// Component values come from previewMap (computeRowPreview with isClean=true for
// clean rows -> saved customs_match_id via refById, never re-picked). final_cost_*
// is NEVER read here and is NEVER displayed (no duplicate of the row's CostPair).
function TopCalculationZone({
  draftItems,
  pendingDeletes,
  previewMap,
  resolverHints,
  openTick,
  scrollTarget,
}: {
  draftItems: DraftRow[];
  pendingDeletes: string[];
  previewMap: Map<string, PreviewEntry>;
  resolverHints: Map<string, ResolverHintInfo>;
  openTick: number;
  scrollTarget: string | null;
}) {
  const [open, setOpen] = useState(false);

  // Visible rows = draftItems minus pending-deleted dbIds. New rows (dbId=null)
  // are always included so the manager sees them BEFORE "Готово".
  const visible = useMemo(
    () =>
      draftItems.filter(
        (d) => !(d.dbId && pendingDeletes.includes(d.dbId)),
      ),
    [draftItems, pendingDeletes],
  );

  // Open + scroll/highlight when a row chevron fires (openTick increments).
  useEffect(() => {
    if (openTick === 0) return;
    setOpen(true);
    const raf = requestAnimationFrame(() => {
      if (!scrollTarget) return;
      const el = document.querySelector(
        `[data-topzone-row-id="${CSS.escape(scrollTarget)}"]`,
      );
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      el.classList.add("ring-2", "ring-brand");
      window.setTimeout(() => {
        el.classList.remove("ring-2", "ring-brand");
      }, 1500);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openTick]);

  // Markers — derived from the SAME visible rows.
  let hasYellow = false;
  let hasRed = false;
  let hasManual = false;
  for (const d of visible) {
    const h = resolverHints.get(d.localId);
    if (
      h &&
      (h.status === "product_no_match" ||
        h.status === "product_ambiguous" ||
        h.status === "country_no_match")
    ) {
      hasRed = true;
      continue;
    }
    const c = previewMap.get(d.localId)?.components;
    if (!c) continue;
    if (c.customsBasis === "fallback") hasYellow = true;
    else if (
      c.customsBasis === "none" &&
      d.product_name.trim() &&
      d.origin_country.trim()
    )
      hasRed = true;
    else if (c.customsBasis === "manual") hasManual = true;
  }

  const count = visible.length;
  const wordForm =
    count === 1 ? "позиція" : count >= 2 && count <= 4 ? "позиції" : "позицій";

  return (
    <div className="border-b border-border bg-card/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1 text-left"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Собівартість
        </span>
        <span className="text-[11px] text-foreground">
          <span className="font-semibold">{count}</span>
          <span className="text-muted-foreground"> {wordForm}</span>
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold">
          {hasYellow && (
            <span
              title="Fallback по товару"
              className="text-amber-600 dark:text-amber-400"
            >
              ⚠
            </span>
          )}
          {hasRed && (
            <span
              title="Митну базу або товар/країну не знайдено"
              className="text-destructive"
            >
              ✕
            </span>
          )}
          {hasManual && (
            <span
              title="Ручна сума митного збору"
              className="text-success"
            >
              ✎
            </span>
          )}
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 transition-transform text-muted-foreground",
              open && "rotate-180",
            )}
          />
        </span>
      </button>
      {open && (
        <div className="max-h-64 overflow-y-auto border-t border-border px-2 py-2">
          {count === 0 ? (
            <div className="px-1 py-1 text-[12px] text-muted-foreground">
              Поки що немає позицій
            </div>
          ) : (
            <ul className="space-y-1.5">
              {visible.map((d) => (
                <TopCalcEntry
                  key={d.localId}
                  draft={d}
                  preview={previewMap.get(d.localId) ?? null}
                  hint={resolverHints.get(d.localId) ?? null}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TopCalcEntry({
  draft,
  preview,
  hint,
}: {
  draft: DraftRow;
  preview: PreviewEntry | null;
  hint: ResolverHintInfo | null;
}) {
  const productInvalid =
    !!hint &&
    (hint.status === "product_no_match" || hint.status === "product_ambiguous");
  const countryInvalid = !!hint && hint.status === "country_no_match";
  const isInvalid = productInvalid || countryInvalid;

  const c = preview?.components ?? EMPTY_COMPONENTS;

  const productLabel = draft.product_name.trim() || "—";
  const countryLabel =
    (draft.origin_country &&
      (toUaCountry(draft.origin_country) || draft.origin_country)) ||
    "—";

  const fmtMoney = (n: number | null) =>
    isInvalid || n == null ? "—" : `$${n.toFixed(4)}`;
  const fmtPrice = (n: number | null, ccy: "EUR" | "USD" | null) =>
    isInvalid || n == null ? "—" : `${n.toFixed(4)} ${ccy ?? ""}`.trim();
  const fmtRate = (n: number | null) =>
    isInvalid || n == null ? "—" : n.toFixed(4);

  let basisText: string;
  let basisCls = "text-muted-foreground";
  if (productInvalid) {
    basisText = "Митна база: недоступна, товар не розпізнано";
    basisCls = "text-destructive";
  } else if (countryInvalid) {
    basisText = "Митна база: недоступна, країну не розпізнано";
    basisCls = "text-destructive";
  } else if (c.customsBasis === "exact" && c.matchedRef) {
    const cc = toUaCountry(c.matchedRef.country) || c.matchedRef.country;
    basisText = `Використано: ${c.matchedRef.product_name} / ${cc}`;
  } else if (c.customsBasis === "fallback" && c.matchedRef) {
    const cc = toUaCountry(c.matchedRef.country) || c.matchedRef.country;
    basisText = `Митна база: fallback по товару · Використано: ${c.matchedRef.product_name} / ${cc}`;
    basisCls = "text-amber-700 dark:text-amber-400";
  } else if (c.customsBasis === "manual") {
    const d = c.customsIndicative ?? 0;
    basisText = `Митний збір введено вручну: ${d.toFixed(4)} USD/кг`;
    basisCls = "text-success";
  } else {
    basisText =
      "Митна база: товар не знайдено · Розрахунок без митної складової";
    basisCls = "text-destructive";
  }

  const containerCls = isInvalid
    ? "border-destructive/40 bg-destructive/5"
    : c.customsBasis === "fallback"
      ? "border-amber-400/40 bg-amber-50/60 dark:bg-amber-950/20"
      : c.customsBasis === "none" &&
          draft.product_name.trim() &&
          draft.origin_country.trim()
        ? "border-destructive/40 bg-destructive/5"
        : c.customsBasis === "manual"
          ? "border-success/40 bg-success/5"
          : "border-border";

  return (
    <li
      data-topzone-row-id={draft.localId}
      className={cn(
        "rounded border px-2 py-1.5 text-[11px] leading-snug",
        containerCls,
      )}
    >
      <div className="font-semibold">
        {productLabel} · {countryLabel}
        {isInvalid && (
          <span className="ml-1 text-destructive">
            ·{" "}
            {productInvalid
              ? hint?.status === "product_ambiguous"
                ? "Уточніть назву товару"
                : "Товар не розпізнано"
              : "Країну не розпізнано"}
          </span>
        )}
      </div>
      <div className="mt-0.5 grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums sm:grid-cols-3">
        <span>
          <span className="text-muted-foreground">Ціна: </span>
          {fmtPrice(c.inputPrice, c.inputCurrency)}
        </span>
        {c.inputCurrency === "EUR" && (
          <span>
            <span className="text-muted-foreground">Курс EUR→USD: </span>
            {fmtRate(c.fxRate)}
          </span>
        )}
        <span>
          <span className="text-muted-foreground">Ціна USD/кг: </span>
          {fmtMoney(c.unitUsd)}
        </span>
        <span>
          <span className="text-muted-foreground">Транспорт: </span>
          {fmtMoney(c.transportPerKg)}
        </span>
        <span>
          <span className="text-muted-foreground">Митниця інд.: </span>
          {fmtMoney(c.customsIndicative)}
        </span>
        <span>
          <span className="text-muted-foreground">Митниця інв.: </span>
          {fmtMoney(c.customsInvoice)}
        </span>
      </div>
      <div className={cn("mt-0.5", basisCls)}>{basisText}</div>
    </li>
  );
}



function SharedVehicleSummary({ vehicleContext, currentShipmentId: _currentShipmentId }: { vehicleContext: VehicleContext; currentShipmentId: string }) {
  // 9F Phase C2b-Fix — live aggregate from loadedItems (gross-based),
  // not vehicles.total_weight_kg (which is still net-based via DB trigger).
  // D1-Fix v2.5.6 (Issue 1) — old expanded Auto duplicate list removed.
  // Product details live in the TopCalculationZone ("Собівартість · N позицій")
  // and in the editor table. Here we only keep compact capacity counters.
  const { pallets: totalPallets, grossKg: totalKg } = sumCapacity(vehicleContext.loadedItems);
  const remainingPallets = Math.max(0, MAX_PALLETS - totalPallets);
  const remainingKg = Math.max(0, MAX_WEIGHT_KG - totalKg);
  const tight = remainingPallets <= 1;

  return (
    <div className="border-b border-border bg-card/70">
      <div className="flex w-full items-center gap-2 px-3 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Авто · завантаження машини</span>
        <span className="text-[11px] text-foreground">
          <span className="font-semibold">{totalPallets}</span>
          <span className="text-muted-foreground">/{MAX_PALLETS}п</span>
          <span className="text-muted-foreground"> · </span>
          <span className="font-semibold">{Math.round(totalKg)}</span>
          <span className="text-muted-foreground">/{MAX_WEIGHT_KG}кг</span>
        </span>
        <span className={cn("text-[11px] font-semibold", tight ? "text-destructive" : "text-emerald-600")}>
          вільно {remainingPallets}п · {Math.round(remainingKg)}кг
        </span>
      </div>
    </div>
  );
}

type PreviewEntry = {
  isDirty: boolean;
  value: { indicative: number; invoice: number } | null;
  // D1-Fix v2.5.2 — live customs status fields (for dirty/new rows).
  hasCustomsInputs: boolean;
  liveCustomsStatus: "green" | "yellow" | "red" | null;
  // D1-Fix v2.5.3 — ready component values for the per-row breakdown panel.
  components: RowComponents;
};

const EMPTY_COMPONENTS: RowComponents = {
  productName: "",
  country: "",
  inputPrice: null,
  inputCurrency: null,
  fxRate: null,
  unitUsd: null,
  transportPerKg: null,
  customsIndicative: null,
  customsInvoice: null,
  customsBasis: "none",
  matchedRef: null,
};

function ProductsTable({ drafts, dbItemById, shipmentId, products, vehicleContext, previewMap, currentShipmentEditable, pulseFields, collapseExpandedTick, onPatch, onRemove, onResolverHint, onShowBreakdown }: {
  drafts: DraftRow[];
  dbItemById: Map<string, ItemRow>;
  shipmentId: string;
  products: ProductRef[];
  vehicleContext: VehicleContext | null;
  previewMap: Map<string, PreviewEntry>;
  currentShipmentEditable: boolean;
  pulseFields: boolean;
  collapseExpandedTick: number;
  onPatch: (localId: string, patch: Partial<DraftRow>) => void;
  onRemove: (localId: string) => void;
  onResolverHint: (localId: string, info: ResolverHintInfo | null) => void;
  onShowBreakdown: (localId: string) => void;
}) {


  const [focused, setFocused] = useState<number | null>(null);
  // D1-Fix v2.5.5 — per-row breakdown panel removed; row chevron now shortcuts
  // to the single TopCalculationZone above the table.

  const setFocusedCb = useCallback((i: number | null) => setFocused(i), []);
  const headerCls = (i: number) => cn(
    "px-1.5 py-2 font-medium transition-colors",
    focused === i ? "text-destructive" : "",
  );
  // Capacity source: effective loadedItems (other shipments + draftAsLoaded for current).
  const capacitySource = vehicleContext?.loadedItems ?? drafts.map((d) => ({
    id: d.localId,
    pallet_count: d.pallet_count,
    pallet_weight: d.pallet_count > 0 ? d.net_weight_kg / d.pallet_count : 0,
    gross_weight_kg: d.gross_weight_kg,
  } as { id: string; pallet_count: number | null; pallet_weight: number | null; gross_weight_kg: number | null }));
  // Phase 1 — card list replaces the legacy row-editor table. Cards still
  // write straight into DraftRow via the same onPatch/onRemove callbacks, so
  // the existing save/commit flow is preserved without changes.
  void focused; void setFocusedCb; void headerCls;
  return (
    <FocusedColContext.Provider value={{ focused, setFocused: setFocusedCb }}>
      <div className="space-y-3">
        {drafts.map((d, idx) => {
          const ownKey = d.localId;
          const others = capacitySource.filter((x) => x.id !== ownKey);
          const { pallets: otherPallets, grossKg: otherKg } = sumCapacity(others);
          const dbItem = d.dbId ? dbItemById.get(d.dbId) ?? null : null;
          const preview: PreviewEntry = previewMap.get(d.localId) ?? { isDirty: d.dbId == null, value: null, hasCustomsInputs: false, liveCustomsStatus: null, components: EMPTY_COMPONENTS };
          // Phase 1 final — identity-lock for Товар / Походження only.
          // Locked when a position_id is anchored either on the saved row
          // (dbItem.position_id) or carried by an offer-derived draft
          // (d.source_position_id). Independent from currentShipmentEditable.
          const productOriginLocked =
            Boolean(dbItem?.position_id) || Boolean(d.source_position_id);
          return (
            <ShipmentProductCard
              key={d.localId}
              index={idx}
              draft={d}
              dbItem={dbItem}
              shipmentId={shipmentId}
              products={products}
              otherPallets={otherPallets}
              otherKg={otherKg}
              preview={preview}
              readOnly={!currentShipmentEditable}
              productOriginLocked={productOriginLocked}
              pulse={pulseFields}
              collapseExpandedTick={collapseExpandedTick}
              onShowBreakdown={() => onShowBreakdown(d.localId)}
              onPatch={(patch: Partial<DraftRow>) => onPatch(d.localId, patch)}
              onRemove={() => onRemove(d.localId)}
              onResolverHint={(info: ResolverHintInfo | null) => onResolverHint(d.localId, info)}
            />
          );
        })}
      </div>
      <span hidden>{String(currentShipmentEditable)}</span>
    </FocusedColContext.Provider>
  );
}


const MAX_PALLETS = 26;
const MAX_WEIGHT_KG = 21500;
const MIN_AUTOCLOSE_WEIGHT_KG = 21000;

function ProductRowEditor({ draft, dbItem, shipmentId, products, otherPallets, otherKg, preview, readOnly, pulse = false, collapseExpandedTick, onShowBreakdown, onPatch, onRemove, onResolverHint }: {
  draft: DraftRow;
  dbItem: ItemRow | null;
  shipmentId: string;
  products: ProductRef[];
  otherPallets: number;
  otherKg: number;
  preview: PreviewEntry;
  readOnly: boolean;
  pulse?: boolean;
  collapseExpandedTick: number;
  onShowBreakdown: () => void;
  onPatch: (patch: Partial<DraftRow>) => void;
  onRemove: () => void;
  onResolverHint: (info: ResolverHintInfo | null) => void;
}) {


  const dbCountries = useCountryOptions();
  const countryAliases = useCountryAliases();
  const productAliases = useProductAliases();
  const COUNTRY_OPTIONS = dbCountries;
  const knownProductNames = products.map((product) => product.name);
  // D1: draft is the source of truth — no internal form state, no autosave.
  const form = draft;
  // formRef always points at latest draft (assigned in render body so the
  // resolver — which can be invoked via setTimeout or via a same-tick blur
  // before React has re-rendered the parent — always reads the canonical
  // value just written by AutocompleteCell.onSelect/handleBlur.
  const formRef = useRef(form);
  formRef.current = form;
  const touchedRef = useRef({ product: false, country: false });
  const set = <K extends keyof DraftRow>(k: K, v: DraftRow[K]) => {
    if (readOnly) return;
    onPatch({ [k]: v } as Partial<DraftRow>);
  };

  // Field-level validation
  const palletCountNum = Number(form.pallet_count) || 0;
  const netNum = Number(form.net_weight_kg) || 0;
  const grossNum = Number(form.gross_weight_kg) || 0;
  const invalidProduct = !form.product_name.trim();
  const unknownProduct = !!form.product_name.trim() && !isKnownProductName(form.product_name, products);
  const invalidCountry = !form.origin_country.trim();
  const invalidPallets = palletCountNum <= 0;
  const invalidNet = netNum <= 0;
  const invalidGross = grossNum <= 0;
  // Mobile-safety: net must not exceed gross (typo guard). Always red, not pulse-gated.
  const netGtGross = netNum > 0 && grossNum > 0 && netNum > grossNum;
  const invalidPrice = !form.unit_price || Number(form.unit_price) <= 0;

  

  // Resolver — onBlur of Товар/Країна, gated by touchedRef.
  type ResolverHint =
    | { status: "pallet_no_match" | "product_no_match" | "product_ambiguous" | "country_no_match" }
    | null;
  const [hint, setHint] = useState<ResolverHint>(null);
  const [resolverBusy, setResolverBusy] = useState(false);
  const resolverSeqRef = useRef(0);


  const runResolver = useCallback(async () => {
    if (readOnly) return;
    if (!touchedRef.current.product && !touchedRef.current.country) return;
    // Always read the latest canonical values written by AutocompleteCell.
    const latest = formRef.current;
    const product = latest.product_name.trim();
    const country = latest.origin_country.trim();
    if (!product || !country) return;
    const productKey = resolverKeyOf(product);
    const countryKey = resolverKeyOf(country);
    const packageKey = resolverKeyOf(latest.package_used);
    const reportHint = (status: ResolverHintStatus | null) => {
      if (status == null) {
        setHint(null);
        onResolverHint(null);
        return;
      }
      onResolverHint({ status, productKey, countryKey, packageKey });
      if (
        status === "pallet_no_match" ||
        status === "product_no_match" ||
        status === "product_ambiguous" ||
        status === "country_no_match"
      ) {
        setHint({ status });
      } else {
        setHint(null);
      }
    };
    const seq = ++resolverSeqRef.current;
    setResolverBusy(true);
    try {
      // 1) Product/country recognition status (still served by the legacy
      //    RPC because the unified resolver doesn't expose
      //    product_no_match / product_ambiguous / country_no_match).
      const { data, error } = await supabase.rpc(

        "rpc_resolve_offer_line_defaults" as never,
        {
          p_product_query: product,
          p_country_query: country,
          p_package_used: null,
          p_include_reserve: false,
        } as never,
      );
      if (seq !== resolverSeqRef.current) return;
      if (error) { reportHint(null); return; }
      const row = Array.isArray(data) ? (data as unknown[])[0] : data;
      if (!row || typeof row !== "object") { reportHint(null); return; }
      const r = row as Record<string, unknown>;
      const status = r.status;

      if (
        status === "product_no_match" ||
        status === "product_ambiguous" ||
        status === "country_no_match"
      ) {
        reportHint(status);
        return;
      }

      // 2) Pallet autofill — single source of truth shared with the
      //    packaging dropdown (`usePalletResolver`). Tier order:
      //    exact → compound_group → all_fallback → no_match.
      const pal = await resolvePalletForText(product, country);
      if (seq !== resolverSeqRef.current) return;

      const cur = formRef.current;
      if (pal.matchType !== "no_match" && pal.selected) {
        const pNet = pal.selected.pallet_net_kg;
        const pGross = pal.selected.pallet_gross_kg;
        const pkg = pal.selected.package_used;
        reportHint("matched");
        const pc = (Number(cur.pallet_count) || 0) > 0 ? Number(cur.pallet_count) : 1;
        onPatch({
          pallet_count: pc,
          package_used: pkg ?? cur.package_used,
          resolver_net_per_pallet_kg: pNet,
          resolver_gross_per_pallet_kg: pGross,
          net_auto: true,
          gross_auto: true,
          net_weight_kg: pNet != null ? pNet * pc : cur.net_weight_kg,
          gross_weight_kg: pGross != null ? pGross * pc : cur.gross_weight_kg,
        });
      } else {
        reportHint("pallet_no_match");
        onPatch({
          package_used: "",
          resolver_net_per_pallet_kg: null,
          resolver_gross_per_pallet_kg: null,
          net_auto: false,
          gross_auto: false,
        });
      }
    } catch {
      if (seq === resolverSeqRef.current) reportHint(null);
    } finally {
      if (seq === resolverSeqRef.current) setResolverBusy(false);
    }
  }, [readOnly, onPatch, onResolverHint]);


  // Resolver is invoked only via commit/select/blur of the autocomplete cells
  // (onCommit on AutocompleteCell + handleResolverBlur on the <td>). Running
  // it on every keystroke caused per-char RPCs, hint banner flicker and the
  // mobile "shaking" symptom.

  const handleResolverBlur = (e: FocusEvent<HTMLElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    void runResolver();
  };


  // D1: remove is local-only. DB DELETE happens last in commitDraft.
  const remove = () => {
    if (readOnly) {
      toast.error("Можна редагувати лише власні товари");
      return;
    }
    
    onRemove();
  };

  // D1-Fix v2.5.4 — collapse state lifted up so the green pill can render
  // inside the right-aligned cluster while the expanded red panel stays below.
  const confirmedOverrideDuty =
    dbItem && dbItem.customs_override_confirmed_at && dbItem.customs_override_duty_usd != null
      ? Number(dbItem.customs_override_duty_usd)
      : null;
  const overrideEligible =
    !!dbItem && !dbItem.customs_match_id && isValidShipmentItem(dbItem);
  const [overrideOpen, setOverrideOpen] = useState<boolean>(
    overrideEligible && confirmedOverrideDuty == null,
  );
  useEffect(() => {
    if (confirmedOverrideDuty != null) setOverrideOpen(false);
  }, [confirmedOverrideDuty]);
  // P-Fix #6 — when parent bumps the collapse tick (e.g. "Додати товар"),
  // close any expanded cost/customs/details panel so it doesn't overlap
  // freshly added rows or the sticky header.
  const firstCollapseTickRef = useRef(collapseExpandedTick);
  useEffect(() => {
    if (collapseExpandedTick === firstCollapseTickRef.current) return;
    firstCollapseTickRef.current = collapseExpandedTick;
    setOverrideOpen(false);
  }, [collapseExpandedTick]);

  const { setFocused } = useContext(FocusedColContext);

  return (
    <>
    <tr
      className="shipment-product-card border-b border-border/40"
      onFocusCapture={(e) => {
        const td = (e.target as HTMLElement).closest("td");
        if (td?.dataset.col) setFocused(Number(td.dataset.col));
      }}
      onBlurCapture={() => setFocused(null)}
    >
      <td data-col="0" data-label="Товар" data-required="true" onBlur={handleResolverBlur} className={cn("relative px-0.5 py-0.5", pulse && (invalidProduct || unknownProduct) && "field-invalid")}>
        <AutocompleteCell
          value={form.product_name}
          onChange={(v) => {
            if (readOnly) return;
            touchedRef.current.product = true;
            setHint(null);
            onResolverHint(null);
            onPatch({ product_name: v });
          }}
          onCommit={() => { void runResolver(); }}

          options={knownProductNames}
          aliases={productAliases}
          placeholder="Товар"
          className={cn(
            "font-medium",
            (invalidProduct || unknownProduct) && "border-destructive/70 ring-1 ring-destructive/40 placeholder:text-destructive/80",
          )}
          expandedMinWidth={200}
          required
          readOnly={readOnly}
        />
        {unknownProduct && (
          <div className="px-1.5 pt-0.5 text-[10px] font-medium text-destructive">
            Оберіть товар лише зі списку
          </div>
        )}
      </td>
      <td data-col="1" data-label="Сорт" className="relative px-0.5 py-0.5">
        <VarietyCell value={form.variety} onChange={(v) => set("variety", v)} productName={form.product_name} readOnly={readOnly} />
      </td>
      <td data-col="2" data-label="Походження" data-required="true" onBlur={handleResolverBlur} className={cn("relative px-0.5 py-0.5", pulse && invalidCountry && "field-invalid")}>
        <AutocompleteCell
          value={form.origin_country}
          onChange={(v) => {
            if (readOnly) return;
            touchedRef.current.country = true;
            setHint(null);
            onResolverHint(null);
            onPatch({ origin_country: v });
          }}
          onCommit={() => { void runResolver(); }}

          options={COUNTRY_OPTIONS}
          aliases={countryAliases}
          placeholder="Походження"
          className={cn(invalidCountry && "border-destructive/70 ring-1 ring-destructive/40 placeholder:text-destructive/80")}
          expandedMinWidth={180}
          readOnly={readOnly}
        />
      </td>
      <td data-col="3" data-label="Калібр" className="relative px-0.5 py-0.5">
        <CellInput value={form.caliber} placeholder="Калібр" onChange={(v) => set("caliber", v)} expandedMinWidth={120} readOnly={readOnly} />
      </td>
      <td data-col="4" data-label="SKU" className="relative px-0.5 py-0.5">
        <CellInput value={form.sku} placeholder="SKU" onChange={(v) => set("sku", v)} expandedMinWidth={120} readOnly={readOnly} />
      </td>
      <td data-col="5" data-label="Упаковка" data-required="true" className="relative px-0.5 py-0.5">
        <PackageCell
          value={form.package_used}
          productName={form.product_name}
          countryName={form.origin_country}
          readOnly={readOnly}
          onChangeText={(text) => {
            // Manual free-text edit — preserve user input even when no DB standards exist.
            // Net/gross are NOT touched here; user enters them manually in their own cells.
            onPatch({ package_used: text });
          }}
          onSelect={(opt) => {
            const pc = Number(form.pallet_count) > 0 ? Number(form.pallet_count) : 1;
            const pNet = opt.pallet_net_kg;
            const pGross = opt.pallet_gross_kg;
            onPatch({
              package_used: opt.package_used,
              pallet_count: Number(form.pallet_count) > 0 ? Number(form.pallet_count) : pc,
              resolver_net_per_pallet_kg: pNet,
              resolver_gross_per_pallet_kg: pGross,
              net_auto: true,
              gross_auto: true,
              net_weight_kg: pNet != null ? pNet * pc : form.net_weight_kg,
              gross_weight_kg: pGross != null ? pGross * pc : form.gross_weight_kg,
            });
          }}
        />
      </td>

      <td data-col="6" data-label="Палети" data-required="true" className={cn("relative px-0.5 py-0.5", pulse && invalidPallets && "field-invalid")}>
        <NumCell
          value={form.pallet_count}
          readOnly={readOnly}
          invalid={invalidPallets}
          onChange={(v) => {
            if (readOnly) return;
            const patch: Partial<DraftRow> = { pallet_count: v };
            if (form.net_auto && form.resolver_net_per_pallet_kg != null) {
              patch.net_weight_kg = form.resolver_net_per_pallet_kg * v;
            }
            if (form.gross_auto && form.resolver_gross_per_pallet_kg != null) {
              patch.gross_weight_kg = form.resolver_gross_per_pallet_kg * v;
            }
            // D1-Fix v2.5.2 — capacity warning uses the same visible-draft source as top АВТО.
            // Top АВТО formula (line ~964): kg = gross > 0 ? gross : pc * pallet_weight,
            // where draftAsLoaded.pallet_weight = net/pc, so the fallback equals net.
            // No dbItem.pallet_weight fallback here — top АВТО would not use it either.
            const simGross = patch.gross_weight_kg != null ? Number(patch.gross_weight_kg) : grossNum;
            const simNet = patch.net_weight_kg != null ? Number(patch.net_weight_kg) : netNum;
            const newRowKg = simGross > 0 ? simGross : simNet;
            const newTotalPallets = otherPallets + v;
            const newTotalKg = otherKg + newRowKg;
            if (newTotalPallets > MAX_PALLETS || newTotalKg > MAX_WEIGHT_KG) {
              toast.error(`Перевищено ліміт: макс ${MAX_PALLETS} палет / ${MAX_WEIGHT_KG} кг на машину`);
            }
            onPatch(patch);
          }}
        />
      </td>
      <td data-col="7" data-label="Нетто, кг" data-required="true" className={cn("relative px-0.5 py-0.5", (pulse && invalidNet) || netGtGross ? "field-invalid" : "")}>
        <NumCell
          value={Math.round(netNum)}
          readOnly={readOnly}
          step="1"
          invalid={invalidNet || netGtGross}
          onChange={(v) => {
            if (readOnly) return;
            const safe = Math.max(0, v);
            onPatch({ net_weight_kg: safe, net_auto: false });
          }}
        />
        {netGtGross && (
          <div className="mt-0.5 text-[10px] leading-tight text-destructive">
            Нетто не може бути більше брутто
          </div>
        )}
      </td>
      <td data-col="8" data-label="Брутто, кг" data-required="true" className={cn("relative px-0.5 py-0.5", (pulse && invalidGross) || netGtGross ? "field-invalid" : "")}>
        <NumCell
          value={Math.round(grossNum)}
          readOnly={readOnly}
          step="1"
          invalid={invalidGross || netGtGross}
          onChange={(v) => {
            if (readOnly) return;
            const safe = Math.max(0, v);
            onPatch({ gross_weight_kg: safe, gross_auto: false });
          }}
        />
      </td>
      <td data-col="9" data-label="Ціна за кг" data-required="true" className={cn("relative px-0.5 py-0.5 min-w-[96px]", pulse && invalidPrice && "field-invalid")}>
        <PriceCell
          value={form.unit_price}
          currency={form.price_currency}
          readOnly={readOnly}
          onValueChange={(v) => set("unit_price", v)}
          onCurrencyChange={(c) => set("price_currency", c)}
        />
      </td>
      <td className="sticky right-0 z-[60] w-12 min-w-[3rem] bg-card px-1 py-0.5 shadow-[-6px_0_10px_-6px_rgba(0,0,0,0.22)]">
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => { remove(); }}
            disabled={readOnly}
            aria-label="Видалити рядок"
            className="relative z-10 inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive active:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        </div>
      </td>
    </tr>
    <tr className="border-b border-border">
      <td colSpan={11} className="bg-muted/30 px-3 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Собівартість $/кг
          </span>
          <div className="flex items-center gap-2">
            {/* D1-Fix v2.5.3 — customs chip derived uniformly from preview.components
                so the chip (clean + dirty + new) and breakdown panel never disagree.
                Hidden when product recognition is in conflict to avoid mixed messages. */}
            {(() => {
              if (
                hint &&
                (hint.status === "product_no_match" ||
                  hint.status === "product_ambiguous" ||
                  hint.status === "country_no_match")
              ) {
                return null;
              }
              if (!preview.hasCustomsInputs) return null;
              const basis = preview.components.customsBasis;
              if (basis === "manual") return null;
              const status: "green" | "yellow" | "red" =
                basis === "exact" ? "green" : basis === "fallback" ? "yellow" : "red";
              if (status === "yellow") {
                return <YellowFallbackChip components={preview.components} />;
              }
              return <CustomsStatusChip status={status} compact />;
            })()}
            {/* D1-Fix v2.5.7 — invalid product/country rows show "—" for CostPair
                in both clean dbItem path and dirty/new previewMap path, so stale
                final_cost or live customs-derived preview cannot leak as a valid
                cost for an unrecognized product or country. */}
            {(() => {
              if (
                hint &&
                (hint.status === "product_no_match" ||
                  hint.status === "product_ambiguous" ||
                  hint.status === "country_no_match")
              ) {
                return <span className="whitespace-nowrap text-xs font-bold text-muted-foreground">—</span>;
              }
              const useDbCost = !!dbItem && !preview.isDirty;
              if (useDbCost) {
                return <CostPair indicative={dbItem!.final_cost_indicative} invoice={dbItem!.final_cost_invoice} size="sm" />;
              }
              const v = preview.value;
              if (v == null) {
                return <span className="whitespace-nowrap text-xs font-bold text-muted-foreground">—</span>;
              }
              return <CostPair indicative={v.indicative} invoice={v.invoice} size="sm" />;
            })()}
            {/* D1-Fix v2.5.4 — collapsed green pill belongs in the right cluster
                (alongside the customs chip / CostPair / chevron), not as a
                separate left-aligned line below the row. */}
            {overrideEligible && confirmedOverrideDuty != null && !overrideOpen && (
              <ItemCustomsConfirmedPill
                duty={confirmedOverrideDuty}
                onReopen={() => setOverrideOpen(true)}
                disabled={readOnly}
              />
            )}
            {/* D1-Fix v2.5.5 — chevron is a shortcut to the top calculation
                zone (single breakdown surface). Works for clean / dirty / new /
                invalid-recognition rows. */}
            <button
              type="button"
              onClick={onShowBreakdown}
              aria-label="Показати розрахунок угорі"
              className="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>
        {overrideEligible && overrideOpen && (
          <ItemCustomsOverride
            item={dbItem!}
            shipmentId={shipmentId}
            readOnly={readOnly}
            onCollapse={() => setOverrideOpen(false)}
          />
        )}
        {hint && !resolverBusy && (
          <div className="mt-1 text-[10px] leading-snug">
            {hint.status === "pallet_no_match" && (
              <span className="text-amber-600 dark:text-amber-400">
                Стандарт палети не знайдено — введіть Упаковка/Нетто/Брутто вручну
              </span>
            )}
            {hint.status === "product_no_match" && (
              <span className="text-destructive">Товар не розпізнано</span>
            )}
            {hint.status === "product_ambiguous" && (
              <span className="text-destructive">Уточніть назву товару</span>
            )}
            {hint.status === "country_no_match" && (
              <span className="text-destructive">Країну не розпізнано</span>
            )}
          </div>
        )}
      </td>
    </tr>


    </>
  );
}


function ItemCustomsChip({ item }: { item: ItemRow }) {
  const refById = useContext(CustomsRefContext);
  const { setSelectedId, openRef } = useContext(FallbackSelectionContext);
  const ref = item.customs_match_id ? refById.get(item.customs_match_id) : null;
  const status = getCustomsStatusFromMatch(item.customs_match_id, ref?.country, item.origin_country);
  if (status === "yellow") {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setSelectedId(item.id);
          openRef.current(true);
        }}
        className="cursor-pointer"
        title="Показати пояснення митниці для цієї позиції"
      >
        <CustomsStatusChip status={status} compact />
      </button>
    );
  }
  return <CustomsStatusChip status={status} compact />;
}

// D1-Fix v2.5.3 — yellow fallback chip with explanation-only popover.
// Used uniformly for clean and dirty/new rows. No override dialog from yellow.
function YellowFallbackChip({ components }: { components: RowComponents }) {
  const usedProduct = components.matchedRef?.product_name || "—";
  const usedCountryRaw = components.matchedRef?.country || "";
  const usedCountry = (usedCountryRaw && toUaCountry(usedCountryRaw)) || usedCountryRaw || "—";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-pointer"
          title="Показати пояснення митниці для цієї позиції"
        >
          <CustomsStatusChip status="yellow" compact />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="w-72 border-amber-400/40 bg-amber-50 p-3 text-[11px] leading-snug text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      >
        <div className="font-semibold">Точну країну не знайдено</div>
        <div className="mt-1">Розрахунок виконано за товаром.</div>
        <div className="mt-2">
          Використаний рядок: <b>{usedProduct}</b> · <b>{usedCountry}</b>
        </div>
        {components.customsIndicative != null && (
          <div className="mt-2">
            Митниця індикатив: <b>${components.customsIndicative.toFixed(4)}/кг</b>
          </div>
        )}
        {components.customsInvoice != null && (
          <div>
            Митниця інвойс: <b>${components.customsInvoice.toFixed(4)}/кг</b>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

// D1-Fix v2.5.3 — per-row component breakdown panel.
// Shows ready component values only. No formulas. No calculation steps.
// Final indicative/invoice are NOT duplicated here — they live in the main cost row.
function RowBreakdownPanel({ components }: { components: RowComponents }) {
  const fmtMoney = (n: number | null) => (n == null ? "—" : `$${n.toFixed(4)}`);
  const fmtPrice = (n: number | null, ccy: string | null) =>
    n == null ? "—" : `${n.toFixed(4)} ${ccy ?? ""}`.trim();
  const fmtRate = (n: number | null) => (n == null ? "—" : n.toFixed(4));
  const fmtPct = (n: number | null) => (n == null ? "—" : `${n.toFixed(2)}%`);
  const fmtThr = (n: number | null) => (n == null ? "—" : `$${n.toFixed(2)}/кг`);
  const countryLabel =
    (components.country && (toUaCountry(components.country) || components.country)) || "—";
  const basisLabel =
    components.customsBasis === "exact"
      ? "точне співпадіння"
      : components.customsBasis === "fallback"
        ? "fallback за товаром"
        : components.customsBasis === "manual"
          ? "ручна сума"
          : "немає митного запису";
  const Row = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );

  const m = components.matchedRef;
  const eu = isEuCountry(components.country);
  const pct = m ? (eu ? m.euro1_percent : m.customs_fee_percent) : null;
  const pctLabel = eu ? "EUR1 %" : "Мито %";
  const refCountryLabel = m
    ? (toUaCountry(m.country) || m.country) + (eu ? " (ЄС)" : "")
    : "—";

  // Final per-kg cost = unit + transport + customs
  const finalIndicative =
    components.unitUsd != null && components.transportPerKg != null && components.customsIndicative != null
      ? components.unitUsd + components.transportPerKg + components.customsIndicative
      : null;
  const finalInvoice =
    components.unitUsd != null && components.transportPerKg != null && components.customsInvoice != null
      ? components.unitUsd + components.transportPerKg + components.customsInvoice
      : null;

  // Mirror of "Запропонувати" invoice formula text (display only — no calc change).
  const showInvoiceFormula =
    m != null &&
    components.unitUsd != null &&
    m.threshold_price_usd != null &&
    Number(components.unitUsd) > Number(m.threshold_price_usd) &&
    pct != null;

  return (
    <div className="space-y-3 text-[11px]">
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        <Row label="Товар" value={`${components.productName || "—"} · ${countryLabel}`} />
        <Row label="Ціна" value={fmtPrice(components.inputPrice, components.inputCurrency)} />
        {components.inputCurrency === "EUR" && (
          <Row label="Курс EUR→USD" value={fmtRate(components.fxRate)} />
        )}
        <Row label="Ціна USD/кг" value={fmtMoney(components.unitUsd)} />
        <Row label="Транспорт USD/кг" value={fmtMoney(components.transportPerKg)} />
        <Row label="Митниця індикатив USD/кг" value={fmtMoney(components.customsIndicative)} />
        <Row label="Митниця інвойс USD/кг" value={fmtMoney(components.customsInvoice)} />
        <Row label="Митна основа" value={basisLabel} />
      </div>

      {m && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-1 border-t border-border pt-2 sm:grid-cols-2 lg:grid-cols-3">
          <Row label="Аналог (товар)" value={m.product_name || "—"} />
          <Row label="Аналог (країна)" value={refCountryLabel} />
          <Row label="Поріг ціни" value={fmtThr(m.threshold_price_usd)} />
          <Row label="Індикативне мито" value={fmtMoney(m.euro1_markup_usd)} />
          <Row label={pctLabel} value={fmtPct(pct)} />
        </div>
      )}

      {showInvoiceFormula && pct != null && (
        <div className="rounded-md border border-border bg-muted/20 p-2 text-muted-foreground">
          Ціна &gt; порогу → інвойсне мито: unit×1.20×{pct.toFixed(2)}%/100 + unit×0.20 + 0.02 ={" "}
          <b className="text-foreground">{fmtMoney(components.customsInvoice)}</b>
        </div>
      )}
      {m && components.unitUsd != null && m.threshold_price_usd != null &&
        Number(components.unitUsd) <= Number(m.threshold_price_usd) && (
        <div className="rounded-md border border-border bg-muted/20 p-2 text-muted-foreground">
          Ціна ≤ порогу → мито = індикатив ={" "}
          <b className="text-foreground">{fmtMoney(components.customsIndicative)}</b>
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-6 gap-y-1 border-t border-border pt-2 sm:grid-cols-2">
        <Row label="Індикативна собівартість USD/кг" value={fmtMoney(finalIndicative)} />
        <Row label="Інвойсна собівартість USD/кг" value={fmtMoney(finalInvoice)} />
      </div>
    </div>
  );
}

// D1-Fix v2.5.4 — small inline pill rendered in the right-aligned cluster
// next to the customs chip / CostPair / chevron. Clicking reopens the panel
// (which renders below the row via ItemCustomsOverride).
function ItemCustomsConfirmedPill({
  duty,
  onReopen,
  disabled,
}: {
  duty: number;
  onReopen: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onReopen}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-[11px] font-semibold text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-60"
      title="Натисніть, щоб переглянути або змінити"
    >
      Митниця підтверджена: ${duty.toFixed(4)}/кг
    </button>
  );
}

function ItemCustomsOverride({
  item,
  shipmentId,
  readOnly,
  onCollapse,
}: {
  item: ItemRow;
  shipmentId: string;
  readOnly: boolean;
  onCollapse?: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [pending, setPending] = useState(false);
  const confirmedDuty =
    item.customs_override_confirmed_at && item.customs_override_duty_usd != null
      ? Number(item.customs_override_duty_usd)
      : null;
  if (item.customs_match_id) return null;
  if (!isValidShipmentItem(item)) return null;
  const onConfirm = async (duty: number) => {
    setPending(true);
    try {
      const { error } = await supabase.rpc("confirm_shipment_item_customs_override", {
        p_item_id: item.id,
        p_duty: duty,
      });
      if (error) throw error;
      toast.success("Митний збір підтверджено");
      onCollapse?.();
      qc.invalidateQueries({ queryKey: ["shipment-products", user?.id, shipmentId] });
      qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
      qc.invalidateQueries({ queryKey: ["shipments-list"] });
      qc.invalidateQueries({ queryKey: ["dash-manager"] });
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="mt-2">
      <CustomsManualOverrideField
        confirmedDuty={confirmedDuty}
        onConfirm={onConfirm}
        pending={pending}
        disabled={readOnly}
      />
    </div>
  );
}


const FOCUS_STYLE = "border-brand bg-background ring-2 ring-brand/40";

function CellInput({ value, onChange, placeholder, className, list, expandedMinWidth, readOnly = false }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; list?: string; expandedMinWidth?: number; readOnly?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <Input
      data-mobile-edit-label={placeholder && placeholder !== "—" ? placeholder.replace("*", "") : undefined}
      value={value}
      readOnly={readOnly}
      list={list}
      enterKeyHint={MOBILE_ENTER_KEY_HINT}
      placeholder={focused ? "" : placeholder}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => {
        if (readOnly) return;
        setFocused(true);
        e.currentTarget.select();
        scrollFocusedIntoView(e.currentTarget);
      }}
      onKeyDown={blurOnEnter}
      onBlur={() => setFocused(false)}
      style={focused && expandedMinWidth ? { minWidth: expandedMinWidth } : undefined}
      className={cn(
        "h-8 w-full border-transparent bg-transparent px-1.5 text-[12px] focus:border-input focus:bg-background",
        focused && FOCUS_STYLE,
        readOnly && "cursor-default",
        className,
      )}
    />
  );
}

function PackageCell({
  value,
  productName,
  countryName,
  readOnly,
  onSelect,
  onChangeText,
}: {
  value: string;
  productName: string;
  countryName: string;
  readOnly: boolean;
  onSelect: (opt: PackageOption) => void;
  onChangeText: (text: string) => void;
}) {
  const { data: resolved, isLoading } = usePalletResolver(productName, countryName);
  const options: PackageOption[] = resolved?.options ?? [];
  const fallbackLabel = resolved?.isFallback ? resolved?.fallbackExplanation : null;
  const items = useMemo(
    () => options.map((opt, i) => ({
      ...opt,
      key: `${opt.package_used}|${opt.pallet_net_kg ?? ""}|${opt.pallet_gross_kg ?? ""}|${i}`,
      label: opt.package_used,
      searchStrings: [opt.package_used, opt.pallet_size ?? ""].filter(Boolean),
    })),
    [options],
  );


  if (readOnly) {
    return (
      <div className="h-8 truncate px-1.5 py-1 text-[12px] text-foreground/90">{value || "—"}</div>
    );
  }

  return (
    <InlineAutocomplete
      value={value}
      onValueChange={onChangeText}
      items={items}
      getKey={(item) => item.key}
      getLabel={(item) => item.label}
      getSearchStrings={(item) => item.searchStrings}
      onSelect={(item) => onSelect(item)}
      onCommit={() => {
        if (typeof document === "undefined") return;
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
      }}
        placeholder="Упаковка"
      expandedMinWidth={200}
      browseLimit={50}
      searchLimit={3}
      minSearchLength={2}
      className="w-full"
      inputClassName={cn(
        "h-8 w-full truncate rounded-md border border-transparent bg-transparent px-1.5 text-left text-[12px] outline-none transition-colors hover:border-input focus:border-input focus:bg-background",
        !value && "text-muted-foreground",
      )}
      inputProps={{ "data-mobile-edit-label": "Упаковка" }}
      renderItem={(item) => (
        <div>
          <div className="font-medium truncate">{item.package_used}</div>
          <div className="text-[11px] text-muted-foreground">
            net {item.pallet_net_kg ?? "—"} / gross {item.pallet_gross_kg ?? "—"} кг
            {item.pallet_size ? ` · ${item.pallet_size}` : ""}
          </div>
        </div>
      )}
    />
  );
}



function VarietyCell({ value, onChange, productName, readOnly }: { value: string; onChange: (v: string) => void; productName: string; readOnly: boolean }) {
  const varieties = useVarietiesFor(productName);
  return (
    <VarietyAutocomplete
      value={value}
      onChange={onChange}
      onCommit={() => {
        if (typeof document === "undefined") return;
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
      }}
      varieties={varieties}
      placeholder="Сорт"
      inputClassName={cn(
        "h-8 w-full border-transparent bg-transparent px-1.5 text-[12px] focus:border-input focus:bg-background",
        readOnly && "cursor-default",
      )}
      disabled={readOnly}
      expandedMinWidth={200}
    />
  );
}


function NumCell({ value, onChange, step, readOnly = false, invalid = false }: { value: number; onChange: (v: number) => void; step?: string; readOnly?: boolean; invalid?: boolean }) {
  const [text, setText] = useState<string>(value === 0 ? "" : String(value));
  const [focused, setFocused] = useState(false);
  // Only resync from prop when NOT focused, to avoid eating typed zeros (e.g. "1.0" → "1")
  useEffect(() => {
    if (focused) return;
    const parsed = text === "" ? 0 : Number(text);
    if (parsed !== value) setText(value === 0 ? "" : String(value));
  }, [value, focused, text]);
  return (
    <Input
      type="text"
      data-mobile-edit-label="Палети/вага"
      readOnly={readOnly}
      inputMode="decimal"
      enterKeyHint={MOBILE_ENTER_KEY_HINT}
      step={step ?? "1"}
      value={text}
      placeholder={focused ? "" : "Палети/вага"}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      onFocus={(e) => {
        if (readOnly) return;
        setFocused(true);
        e.currentTarget.select();
        scrollFocusedIntoView(e.currentTarget);
      }}
      onKeyDown={blurOnEnter}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        // Allow digits, comma, dot. Normalize comma → dot for parsing only.
        const raw = e.target.value.replace(/[^\d.,-]/g, "");
        setText(raw);
        const normalized = raw.replace(",", ".");
        // Don't push parent updates for incomplete numbers like "", "-", "1.", "0."
        if (normalized === "" || normalized === "-" || /[.,]$/.test(raw)) {
          if (raw === "") onChange(0);
          return;
        }
        const n = Number(normalized);
        if (!Number.isNaN(n)) onChange(n);
      }}
      className={cn(
        "h-8 w-full border-transparent bg-transparent px-1.5 text-right text-[12px] tabular-nums focus:border-input focus:bg-background",
        focused && FOCUS_STYLE,
        readOnly && "cursor-default",
        invalid && "border-destructive/70 ring-1 ring-destructive/40 placeholder:text-destructive/80",
      )}
    />
  );
}

function PriceCell({ value, currency, onValueChange, onCurrencyChange, readOnly = false }: {
  value: number; currency: "EUR" | "USD";
  onValueChange: (v: number) => void;
  onCurrencyChange: (c: "EUR" | "USD") => void;
  readOnly?: boolean;
}) {
  const [text, setText] = useState<string>(value === 0 ? "" : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (focused) return;
    const parsed = text === "" ? 0 : Number(text.replace(",", "."));
    if (parsed !== value) setText(value === 0 ? "" : String(value));
  }, [value, focused, text]);
  const isEmpty = !value || value <= 0;
  return (
    <div className={cn(
      "flex items-center gap-0.5 rounded border border-transparent",
      isEmpty && "border-destructive/70 ring-1 ring-destructive/40",
    )}>
      <Input
        type="text"
        data-mobile-edit-label="Ціна"
        readOnly={readOnly}
        inputMode="decimal"
        enterKeyHint={MOBILE_ENTER_KEY_HINT}
        value={text}
        placeholder={focused ? "" : "Ціна за кг"}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={(e) => {
          if (readOnly) return;
          setFocused(true);
          e.currentTarget.select();
          scrollFocusedIntoView(e.currentTarget);
        }}
        onKeyDown={blurOnEnter}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.,-]/g, "");
          setText(raw);
          const normalized = raw.replace(",", ".");
          if (normalized === "" || normalized === "-" || /[.,]$/.test(raw)) {
            if (raw === "") onValueChange(0);
            return;
          }
          const n = Number(normalized);
          if (!Number.isNaN(n)) onValueChange(n);
        }}
        className={cn(
          "h-10 w-full min-w-[60px] border-transparent bg-transparent px-2 text-right text-[13px] tabular-nums focus:border-input focus:bg-background",
          focused && FOCUS_STYLE,
          isEmpty && "placeholder:text-destructive/80",
          readOnly && "cursor-default",
        )}
      />
      <select
        data-mobile-edit-label="Валюта"
        value={currency}
        disabled={readOnly}
        onChange={(e) => onCurrencyChange(e.target.value as "EUR" | "USD")}
        className="h-10 rounded border-transparent bg-transparent px-1 text-[11px] focus:border-input focus:bg-background disabled:cursor-not-allowed disabled:opacity-70"
      >
        <option value="EUR">€</option>
        <option value="USD">$</option>
      </select>
    </div>
  );
}
