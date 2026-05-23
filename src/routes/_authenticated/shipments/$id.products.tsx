import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, createContext, useContext, useCallback, type FocusEvent, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toUaCountry, normalizeCountry } from "@/lib/countries";
import { AutocompleteCell } from "@/components/AutocompleteCell";
import { useCountryOptions } from "@/hooks/useCountryOptions";
import { CostPair } from "@/components/CostPair";
import { deleteShipmentIfEmpty } from "@/lib/cleanup-empty-shipment";
import { canonicalizeProductName, normalizeProductKey, resolveProductOption } from "@/lib/product-aliases";
import { translateError } from "@/lib/mutation-helpers";
import { CustomsStatusChip } from "@/components/CustomsStatusChip";
import { CustomsManualOverrideField } from "@/components/CustomsManualOverrideField";
import { CUSTOMS_STRINGS, getCustomsStatusFromMatch } from "@/lib/customs-status";

// Patch 6B: per-shipment customs-ref index supplied via context (no module globals).
type CustomsRefIndex = Map<string, { id: string; product_name: string; country: string }>;
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
import { useVarietiesFor } from "@/hooks/useProductVarieties";
import { VarietyAutocomplete } from "@/components/VarietyAutocomplete";

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
};

type CustomsRefMini = { id: string; product_name: string; country: string };

type ShipmentRow = {
  id: string;
  code: string;
  country: string | null;
  logistics_cost: number | null;
  logistics_cost_currency: string | null;
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
    isCurrentShipment: boolean;
    isOwnManager: boolean;
  }>;
};

type ProductRef = { name: string; default_pallet_weight: number | null };

function normalizeProductValue(value: string | null | undefined) {
  return normalizeProductKey(value);
}

function isKnownProductName(value: string | null | undefined, products: ProductRef[]) {
  const normalized = normalizeProductValue(canonicalizeProductName(value));
  if (!normalized) return false;
  if (products.some((product) => normalizeProductValue(product.name) === normalized)) return true;
  // Accept unique prefix match (e.g. "ків" → "Ківі")
  const resolved = resolveProductOption(value, products.map((p) => p.name));
  return !!resolved;
}

function isValidShipmentItem(item: Pick<ItemRow, "product_name" | "pallet_count">) {
  return (item.product_name ?? "").trim().length > 0 && Number(item.pallet_count ?? 0) > 0;
}

type RequiredField = "product_name" | "origin_country" | "pallet_count" | "total_weight" | "unit_price";

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
    .select("id,total_pallets,total_weight_kg,status,closed_by,closed_at")
    .eq("id", vehicleId)
    .maybeSingle();

  const totalPallets = Number((vehicle as { total_pallets?: number | null } | null)?.total_pallets ?? 0);
  const totalWeight = Number((vehicle as { total_weight_kg?: number | null } | null)?.total_weight_kg ?? 0);
  const closedBy = (vehicle as { closed_by?: string | null } | null)?.closed_by ?? null;
  const closedAt = (vehicle as { closed_at?: string | null } | null)?.closed_at ?? null;
  // Авто закривається автоматично, якщо:
  //   • завантажено ≥ 26 палет (незалежно від ваги), АБО
  //   • завантажено ≥ 21000 кг (незалежно від кількості палет).
  const shouldBeClosed =
    totalPallets >= MAX_PALLETS || totalWeight >= MIN_AUTOCLOSE_WEIGHT_KG;
  const nextStatus = shouldBeClosed ? "closed" : "open";

  if (closedBy && !shouldBeClosed) return;
  if ((vehicle as { status?: string | null } | null)?.status === nextStatus && (shouldBeClosed || !closedAt)) return;

  await supabase
    .from("vehicles" as never)
    .update({
      status: nextStatus,
      closed_at: shouldBeClosed ? closedAt ?? new Date().toISOString() : null,
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
  qc.invalidateQueries({ queryKey: ["vehicles-list"], refetchType: "all" });
  qc.invalidateQueries({ queryKey: ["vehicles-open"], refetchType: "all" });
  qc.invalidateQueries({ queryKey: ["distribution-list"] });
  qc.invalidateQueries({ queryKey: ["shipment-products"] });
}

const FocusedColContext = createContext<{ focused: number | null; setFocused: (i: number | null) => void }>({
  focused: null,
  setFocused: () => {},
});

function ProductsScrollArea({
  itemsCount,
  empty,
  emptyContent,
  children,
}: {
  itemsCount: number;
  empty: boolean;
  emptyContent: ReactNode;
  children: ReactNode;
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
    <div ref={ref} className="flex-1 overflow-auto relative">
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
  const { selectedId, setSelectedId, openRef } = useContext(FallbackSelectionContext);
  const [open, setLocalOpen] = useState(false);
  // Register the popover opener so YELLOW row chips can open the panel.
  useEffect(() => {
    openRef.current = setLocalOpen;
    return () => { openRef.current = () => {}; };
  }, [openRef]);
  const current =
    fallbackItems.find((f) => f.item.id === selectedId) ?? fallbackItems[0];
  const productName = current?.item.product_name || "—";
  const missingCountry =
    toUaCountry(current?.item.origin_country ?? "") || current?.item.origin_country || "—";
  const usedCountry = toUaCountry(current?.ref.country ?? "") || current?.ref.country || "—";
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setLocalOpen(o);
        if (o && !selectedId && fallbackItems[0]) {
          setSelectedId(fallbackItems[0].item.id);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-amber-600 hover:text-amber-700 dark:text-amber-400"
        >
          Індикатив: не знайдено
          <AlertTriangle className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="bottom" align="center" className="w-72 border-amber-400/40 bg-amber-50 p-3 text-[11px] leading-snug text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        <div>
          Товар <b>{productName}</b>: країна <b>{missingCountry}</b> відсутня у митній базі, собівартість розрахована по найвищому індикативу для цього товару (<b>{usedCountry}</b>).
        </div>
        {fallbackItems.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-1 border-t border-amber-400/30 pt-2">
            {fallbackItems.map((f) => {
              const active = f.item.id === (current?.item.id ?? null);
              const label = `${f.item.product_name || "—"} · ${toUaCountry(f.item.origin_country ?? "") || f.item.origin_country || "—"}`;
              return (
                <button
                  key={f.item.id}
                  type="button"
                  onClick={() => setSelectedId(f.item.id)}
                  className={cn(
                    "rounded border px-1.5 py-0.5 text-[10px] font-medium",
                    active
                      ? "border-amber-500 bg-amber-200/70 text-amber-900 dark:bg-amber-800/60 dark:text-amber-100"
                      : "border-amber-400/40 bg-transparent text-amber-700 hover:bg-amber-100 dark:text-amber-300",
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
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
    queryFn: async () => {
      const [s, items, prods] = await Promise.all([
        supabase.from("shipments").select("id,code,country,logistics_cost,logistics_cost_currency,vehicle_id,created_by,import_manager_id,suppliers(name)").eq("id", id).single(),
        supabase.from("shipment_items").select("id,product_name,variety,origin_country,caliber,sku,pallet_count,pallet_weight,unit_price,price_currency,final_cost_indicative,final_cost_invoice,customs_match_id,customs_override_duty_usd,customs_override_confirmed_at,customs_override_by,package_used,net_weight_kg,gross_weight_kg,resolver_net_per_pallet_kg,resolver_gross_per_pallet_kg,net_auto,gross_auto").eq("shipment_id", id).order("created_at"),
        Promise.all([
          supabase.from("products").select("name,default_pallet_weight").eq("is_active", true),
          supabase.from("product_varieties").select("product_name_ua").range(0, 1999),
        ]),
      ]);
      const sh = s.data as {
        id: string;
        code: string;
        country: string | null;
        logistics_cost: number | null;
        logistics_cost_currency: string | null;
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
            .select("id,code,country,total_pallets,total_weight_kg,created_by")
            .eq("id", sh.vehicle_id)
            .single(),
          supabase
            .from("shipments")
            .select("id,code,created_by,import_manager_id,logistics_cost,logistics_cost_currency,suppliers(name)")
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
                .select("id,shipment_id,product_name,variety,origin_country,pallet_count,pallet_weight")
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
                  isCurrentShipment: vehicleItem.shipment_id === id,
                  isOwnManager: ownerId != null && ownerId === user?.id,
                };
              }),
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
            .select("id,product_name,country")
            .in("id", matchIds)
        : { data: [] };
      return {
        shipment: sh ? ({ ...sh, vehicle_owner_id: vehicleOwnerId, supplier_name: sh.suppliers?.name ?? null } as ShipmentRow) : null,
        items: itemRows,
        products: Array.from(
          new Map(
            [
              ...((prods[0].data ?? []) as ProductRef[]),
              ...((prods[1].data ?? []).map((row) => ({
                name: row.product_name_ua as string,
                default_pallet_weight: null,
              })) as ProductRef[]),
            ]
              .map((product) => [normalizeProductKey(product.name), { name: product.name.trim(), default_pallet_weight: product.default_pallet_weight ?? null }] as const)
              .filter(([key]) => !!key),
          ).values(),
        ),
        customsRefs: (refs ?? []) as CustomsRefMini[],
        vehicleContext,
      };
    },
  });

  const sh = data?.shipment;
  const items = data?.items ?? [];
  const validItems = items.filter(isValidShipmentItem);
  const products = data?.products ?? [];
  const vehicleContext = data?.vehicleContext ?? null;
  const customsRefs = data?.customsRefs ?? [];
  const refById = new Map(customsRefs.map((r) => [r.id, r])) as CustomsRefIndex;
  // Patch 6B: count RED rows (valid, no customs_match_id) lacking a confirmed
  // manual customs duty — used to gate Done/Назад.
  const redUnconfirmedCount = validItems.filter(
    (it) =>
      !it.customs_match_id &&
      !(it.customs_override_confirmed_at && it.customs_override_duty_usd != null),
  ).length;
  const country = toUaCountry(sh?.country) || "—";

  // Customs match status for the header indicator.
  // - "found": every valid item matched product+country exactly in customs base.
  // - "fallback": at least one item matched product but country differs
  //   (the trigger picked the row with the highest indicative).
  // - "none": no valid items yet (hide indicator).
  const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
  const fallbackItems = validItems
    .map((it) => {
      const ref = it.customs_match_id ? refById.get(it.customs_match_id) : null;
      if (!ref) return null;
      const sameCountry = norm(ref.country) === norm(it.origin_country);
      return sameCountry ? null : { item: it, ref };
    })
    .filter((v): v is { item: ItemRow; ref: CustomsRefMini } => !!v);
  const customsStatus: "found" | "fallback" | "none" =
    validItems.length === 0
      ? "none"
      : fallbackItems.length > 0
        ? "fallback"
        : "found";
  
  const incompleteItems = items.filter((i) => {
    if (Number(i.pallet_count ?? 0) <= 0) return false;
    const missing = getMissingFields(i);
    return missing.length > 0 || !isKnownProductName(i.product_name, products);
  });
  const incompleteCount = incompleteItems.length;
  const hasRealPallets = validItems.length > 0;
  const currentShipmentOwnerId = sh ? sh.import_manager_id ?? sh.created_by ?? null : null;
  // Editable when admin, the explicit manager, or the creator (covers vacation
  // replacement: replacement creates the shipment, supplier belongs to the
  // vacationing manager — DB RLS already allows it via is_shipment_owner).
  const currentShipmentEditable = !!user?.id && (
    !!isAdmin
    || sh?.created_by === user.id
    || sh?.import_manager_id === user.id
    || sh?.import_manager_id === currentManagerId
  );
  const capacityItems = vehicleContext?.loadedItems ?? items.map((item) => ({
    id: item.id,
    pallet_count: item.pallet_count,
    pallet_weight: item.pallet_weight,
  }));
  const loadedPallets = capacityItems.reduce((sum, item) => sum + Number(item.pallet_count ?? 0), 0);
  const loadedKg = capacityItems.reduce((sum, item) => sum + Number(item.pallet_count ?? 0) * Number(item.pallet_weight ?? 0), 0);
  const remainingPallets = Math.max(0, MAX_PALLETS - loadedPallets);
  const remainingKg = Math.max(0, MAX_WEIGHT_KG - loadedKg);
  const canEditTransport = !!sh && (!sh.vehicle_id
    ? currentShipmentEditable
    : !!user?.id && !!vehicleContext?.ownerShipment && vehicleContext.ownerShipment.id === sh.id && sh.vehicle_owner_id === user.id);

  const transportCostValue = Number(
    (vehicleContext?.ownerShipment?.logistics_cost ?? sh?.logistics_cost) ?? 0,
  );
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

  useEffect(() => {
    const onUnload = () => {
      void deleteShipmentIfEmpty(id);
    };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, [id]);

  // Auto-prefill a product row + freight from the source manager offer when
  // creating a new shipment directly under that offer ("Створити нову
  // поставку" button). Runs once per shipment.
  const prefillRunRef = useRef(false);
  useEffect(() => {
    if (!fromOfferId || !sh || !currentShipmentEditable) return;
    if (items.length > 0) return;
    if (prefillRunRef.current) return;
    prefillRunRef.current = true;
    (async () => {
      try {
        const { data: offer, error: offerErr } = await supabase
          .from("manager_offers")
          .select(
            "id,product_name,origin_country,caliber,variety,pallet_weight,price_per_kg,price_currency,freight_amount,freight_currency",
          )
          .eq("id", fromOfferId)
          .maybeSingle();
        if (offerErr || !offer) return;

        const palletWeight = Number(offer.pallet_weight ?? 0);

        // Pending по всьому offer: approved - ordered - cancelled (через allocation_parts).
        const { data: responses } = await supabase
          .from("manager_offer_responses")
          .select("approved_pallets")
          .eq("offer_id", offer.id);
        const approvedTotal = (responses ?? []).reduce(
          (s, r) =>
            s + Number((r as { approved_pallets: number | null }).approved_pallets ?? 0),
          0,
        );

        const { data: allocParts } = await supabase
          .from("manager_offer_allocation_parts")
          .select("pallets, status")
          .eq("offer_id", offer.id);
        const orderedTotal = (allocParts ?? [])
          .filter((p) => (p as { status: string }).status === "ordered")
          .reduce((s, p) => s + Number((p as { pallets: number | null }).pallets ?? 0), 0);
        const cancelledTotal = (allocParts ?? [])
          .filter((p) => (p as { status: string }).status === "cancelled")
          .reduce((s, p) => s + Number((p as { pallets: number | null }).pallets ?? 0), 0);

        const pending = approvedTotal - orderedTotal - cancelledTotal;

        // Desired: заповнити фуру біля ліміту 21000 кг / MAX_PALLETS.
        const TARGET_KG = 21000;
        const desiredPalletCount =
          palletWeight > 0
            ? Math.min(MAX_PALLETS, Math.max(1, Math.floor(TARGET_KG / palletWeight)))
            : 0;
        const safePalletCount = Math.min(desiredPalletCount, pending);

        if (safePalletCount <= 0) {
          prefillRunRef.current = false;
          toast.error("Немає вільних палет за цією пропозицією");
          return;
        }
        if (safePalletCount < desiredPalletCount) {
          toast.info(
            `Кількість зменшено до ${safePalletCount} палет за залишком пропозиції`,
          );
        }

        

        // 9F Phase B — prefill writes new weight model + legacy compat-shim.
        // net = gross = pc * offer.pallet_weight (no resolver, manual mode).
        const palletWeightShim = palletWeight > 0 ? palletWeight : 0;
        const netKg = safePalletCount * palletWeightShim;
        const grossKg = netKg;

        const { data: inserted, error: insErr } = await supabase
          .from("shipment_items")
          .insert({
            shipment_id: id,
            product_name: offer.product_name,
            origin_country: offer.origin_country
              ? normalizeCountry(offer.origin_country)
              : null,
            caliber: offer.caliber ?? null,
            variety: offer.variety ?? null,
            pallet_count: safePalletCount,
            pallet_weight: palletWeightShim,
            unit_price: Number(offer.price_per_kg ?? 0),
            price_currency: offer.price_currency ?? "EUR",
            qty: netKg,
            unit: "kg",
            package_used: null,
            net_weight_kg: netKg > 0 ? netKg : null,
            gross_weight_kg: grossKg > 0 ? grossKg : null,
            resolver_net_per_pallet_kg: null,
            resolver_gross_per_pallet_kg: null,
            net_auto: false,
            gross_auto: false,
          })
          .select("id")
          .single();
        if (insErr) {
          prefillRunRef.current = false;
          toast.error(translateError(insErr));
          return;
        }
        const newItemId = inserted!.id as string;

        // Copy freight from offer to shipment if shipment has no freight yet.
        if (
          (sh.logistics_cost == null || Number(sh.logistics_cost) <= 0) &&
          Number(offer.freight_amount ?? 0) > 0
        ) {
          await supabase
            .from("shipments")
            .update({
              logistics_cost: Number(offer.freight_amount),
              logistics_cost_currency: offer.freight_currency ?? "EUR",
            })
            .eq("id", id);
        }

        // FIFO allocation через RPC (єдиний канонічний шлях прив'язки offer ↔ shipment).
        const { error: rpcErr } = await supabase.rpc(
          "link_offer_to_shipment_item_fifo",
          {
            p_offer_id: offer.id,
            p_shipment_item_id: newItemId,
            p_max_pallets: safePalletCount,
            p_allow_caliber_mismatch: false,
            p_notes: undefined,
          },
        );
        if (rpcErr) {
          // Cleanup orphan shipment_item, якщо немає прив'язок.
          const { data: ap } = await supabase
            .from("manager_offer_allocation_parts")
            .select("id")
            .eq("shipment_item_id", newItemId)
            .limit(1);
          const { data: di } = await supabase
            .from("distribution_items")
            .select("id")
            .eq("shipment_item_id", newItemId)
            .limit(1);
          if ((ap?.length ?? 0) === 0 && (di?.length ?? 0) === 0) {
            const { error: delErr } = await supabase
              .from("shipment_items")
              .delete()
              .eq("id", newItemId);
            if (delErr) {
              toast.error(
                `Помилка прив'язки і cleanup не вдалося: ${translateError(delErr)}`,
              );
            } else {
              toast.error(translateError(rpcErr));
            }
          } else {
            toast.error(
              `Помилка прив'язки, рядок залишено для перевірки: ${translateError(rpcErr)}`,
            );
          }
          prefillRunRef.current = false;
          return;
        }

        qc.invalidateQueries({ queryKey: ["shipment-products", user?.id, id] });
        qc.invalidateQueries({ queryKey: ["shipment", id] });
        qc.invalidateQueries({ queryKey: ["manager-offers"] });
        qc.invalidateQueries({ queryKey: ["shipments-link-options"] });
        qc.invalidateQueries({ queryKey: ["manager-offer-responses", offer.id] });

        qc.invalidateQueries({ queryKey: ["shipment-products", user?.id, id] });
        qc.invalidateQueries({ queryKey: ["shipment", id] });
        invalidateVehicleAndShipmentCaches(qc);
      } catch {
        prefillRunRef.current = false;
      }
    })();
  }, [fromOfferId, sh, items.length, currentShipmentEditable, id, qc, user?.id]);



  const leaveProducts = async () => {
    // Auto-cleanup: drop empty/placeholder rows on exit so they don't
    // persist as fake products.
    const emptyIds = items
      .filter(
        (item) =>
          !(item.product_name ?? "").trim() ||
          item.product_name === "Новий товар" ||
          Number(item.pallet_count ?? 0) <= 0,
      )
      .map((item) => item.id);
    if (emptyIds.length > 0) {
      await supabase.from("shipment_items").delete().in("id", emptyIds);
    }
    const deleted = await deleteShipmentIfEmpty(id);
    if (deleted) {
      navigate({ to: "/shipments" });
      return;
    }
    await syncVehicleStateForShipment(id);
    qc.invalidateQueries({ queryKey: ["shipment-products", user?.id, id] });
    invalidateVehicleAndShipmentCaches(qc);
    navigate({ to: "/shipments/$id", params: { id } });
  };


  const blockExit = (e: React.MouseEvent) => {
    if (incompleteCount > 0 || !hasRealPallets) {
      e.preventDefault();
      triggerShake(false);
    }
  };

  const addItem = async () => {
    if (!currentShipmentEditable) {
      toast.error("Ви можете додавати товари лише у власну поставку");
      return;
    }
    if (sh?.vehicle_id && remainingPallets <= 0 && remainingKg <= 0) {
      toast.error("У спільному авто більше немає вільного місця");
      return;
    }
    const { error } = await supabase.from("shipment_items").insert({
      shipment_id: id,
      product_name: "Новий товар",
      qty: 0,
      unit: "kg",
      unit_price: 0,
      price_currency: "EUR",
      pallet_count: 0,
      pallet_weight: 0,
    });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["shipment-products", user?.id, id] });
    qc.invalidateQueries({ queryKey: ["shipment", id] });
    invalidateVehicleAndShipmentCaches(qc);
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
  const fallbackSelection: FallbackSelection = {
    selectedId: selectedFallbackId,
    setSelectedId: setSelectedFallbackId,
    openRef: fallbackOpenRef,
  };

  return (
   <CustomsRefContext.Provider value={refById}>
    <FallbackSelectionContext.Provider value={fallbackSelection}>
    <div className={cn("fixed inset-0 z-50 flex flex-col bg-background", shake && "animate-shake")}>
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

        <Button size="sm" onClick={addItem} disabled={!currentShipmentEditable} className="bg-brand text-brand-foreground hover:bg-brand/90 disabled:opacity-60">
          <Plus className="h-4 w-4" />
        </Button>
      </header>

      {sh && (
        <TransportBar
          shipment={sh}
          currentUserId={user?.id ?? null}
          vehicleContext={vehicleContext}
          canEditTransport={canEditTransport}
          flash={flashTransport}
        />
      )}
      {vehicleContext && (
        <SharedVehicleSummary
          vehicleContext={vehicleContext}
          currentShipmentId={id}
          customsStatus={customsStatus}
          fallbackItems={fallbackItems}
        />
      )}


      <ProductsScrollArea
        itemsCount={items.length}
        empty={items.length === 0}
        emptyContent={
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">Позицій ще немає</p>
            <Button onClick={addItem} className="bg-brand text-brand-foreground hover:bg-brand/90">
              <Plus className="mr-1 h-4 w-4" /> Додати товар
            </Button>
          </div>
        }
      >
        <ProductsTable items={items} id={id} products={products} vehicleContext={vehicleContext} currentShipmentEditable={currentShipmentEditable} pulseFields={pulseFields} />
        {currentShipmentEditable && (
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

      <footer className="border-t border-border bg-card px-3 py-2 pb-safe">
        <Link to="/shipments/$id" params={{ id }} className="block" onClick={(e) => {
          if (incompleteCount > 0 || !hasRealPallets || (transportMissing && !canSaveForLater)) {
            e.preventDefault();
            triggerShake(transportMissing);
            return;
          }
          if (!tryLeave(e)) return;
          e.preventDefault();
          void leaveProducts();
        }}>
          <Button
            className={cn(
              "w-full",
              (incompleteCount > 0 || (transportMissing && !canSaveForLater) || redUnconfirmedCount > 0)
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-brand text-brand-foreground hover:bg-brand/90",
            )}
          >
            {transportMissing
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
        </Link>
      </footer>
    </div>
    </FallbackSelectionContext.Provider>
   </CustomsRefContext.Provider>
  );
}

function TransportBar({
  shipment,
  currentUserId,
  vehicleContext,
  canEditTransport,
  flash,
}: {
  shipment: ShipmentRow;
  currentUserId: string | null;
  vehicleContext: VehicleContext | null;
  canEditTransport: boolean;
  flash?: boolean;
}) {
  const lockedByOwner =
    !!shipment.vehicle_id &&
    !!shipment.vehicle_owner_id &&
    !!currentUserId &&
    shipment.vehicle_owner_id !== currentUserId;
  const qc = useQueryClient();
  const transportShipment = vehicleContext?.ownerShipment?.id === shipment.id
    ? shipment
    : vehicleContext?.ownerShipment
      ? {
          logistics_cost: vehicleContext.ownerShipment.logistics_cost,
          logistics_cost_currency: vehicleContext.ownerShipment.logistics_cost_currency,
        }
      : shipment;
  const [val, setVal] = useState<string>(
    transportShipment.logistics_cost == null || Number(transportShipment.logistics_cost) === 0 ? "" : String(transportShipment.logistics_cost),
  );
  const [cur, setCur] = useState<string>(transportShipment.logistics_cost_currency ?? "EUR");
  const dirty = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isEmpty = val === "" || Number(val.replace(",", ".")) <= 0;

  useEffect(() => {
    if (dirty.current) return;
    setVal(
      transportShipment.logistics_cost == null || Number(transportShipment.logistics_cost) === 0
        ? ""
        : String(transportShipment.logistics_cost),
    );
    setCur(transportShipment.logistics_cost_currency ?? "EUR");
  }, [transportShipment.logistics_cost, transportShipment.logistics_cost_currency]);

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(async () => {
      const normalized = val.replace(",", ".");
      // Skip incomplete numbers like "1." or "1,"
      if (/[.,]$/.test(val)) return;
      const num = normalized === "" ? 0 : Number(normalized);
      if (Number.isNaN(num)) return;
      const { error } = await supabase
        .from("shipments")
        .update({ logistics_cost: num, logistics_cost_currency: cur })
        .eq("id", shipment.id);
      if (error) toast.error(error.message);
      else {
        dirty.current = false;
        qc.invalidateQueries({ queryKey: ["shipment-products"] }); qc.invalidateQueries({ queryKey: ["shipment", shipment.id] });
      }
    }, 600);
    return () => clearTimeout(t);
  }, [val, cur, shipment.id, qc]);

  if (lockedByOwner || !canEditTransport) {
    const route = toUaCountry(vehicleContext?.vehicle.country ?? shipment.country) || "—";
    return (
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Транспорт
        </span>
        <span className="text-[12px] font-semibold text-foreground">
          {isEmpty ? "—" : `${val} ${cur}`}
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
        Перевезення авто {isEmpty && "*"}
      </span>
      <Input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        placeholder="Обов'язково"
        value={val}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          // Visual cue only: the field already pulses red while empty.
        }}
        onChange={(e) => {
          dirty.current = true;
          setVal(e.target.value.replace(/[^\d.,-]/g, ""));
        }}
        className={cn(
          "h-7 flex-1 px-2 text-[12px]",
          isEmpty && "border-destructive bg-destructive/15 ring-2 ring-destructive/60",
        )}
      />
      <select
        value={cur}
        onChange={(e) => { dirty.current = true; setCur(e.target.value); }}
        className="h-7 rounded-md border border-input bg-background px-1.5 text-[11px]"
      >
        <option value="EUR">EUR</option>
        <option value="USD">USD</option>
      </select>
    </div>
  );
}

function SharedVehicleSummary({ vehicleContext, currentShipmentId: _currentShipmentId, customsStatus, fallbackItems }: { vehicleContext: VehicleContext; currentShipmentId: string; customsStatus?: "found" | "fallback" | "none"; fallbackItems?: Array<{ item: ItemRow; ref: CustomsRefMini }> }) {
  const [open, setOpen] = useState(false);
  const totalPallets = Number(vehicleContext.vehicle.total_pallets ?? 0);
  const totalKg = Number(vehicleContext.vehicle.total_weight_kg ?? 0);
  const remainingPallets = Math.max(0, MAX_PALLETS - totalPallets);
  const remainingKg = Math.max(0, MAX_WEIGHT_KG - totalKg);
  const tight = remainingPallets <= 1;
  const count = vehicleContext.loadedItems.length;


  return (
    <div className="border-b border-border bg-card/70">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1 text-left"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Авто</span>
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
        <span className="ml-auto flex items-center gap-1 text-[10px]">
          {customsStatus && customsStatus !== "none" && (
            <CustomsStatusBadge status={customsStatus} fallbackItems={fallbackItems ?? []} />
          )}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform text-muted-foreground", open && "rotate-180")} />
        </span>

      </button>
      {open && (
        <div className="max-h-52 overflow-y-auto border-t border-border">
          {count === 0 ? (
            <div className="px-3 py-2 text-[12px] text-muted-foreground">Поки що немає завантажених товарів</div>
          ) : (
            <ul className="divide-y divide-border/60">
              {vehicleContext.loadedItems.map((loadedItem) => (
                <li key={loadedItem.id} className={cn("flex items-center justify-between gap-2 px-3 py-1.5", loadedItem.isCurrentShipment && "bg-brand/5")}>
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-foreground">
                      {loadedItem.product_name || "—"}{loadedItem.variety ? ` · ${loadedItem.variety}` : ""}
                    </div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {loadedItem.shipment_code} · {loadedItem.owner_name}{loadedItem.isCurrentShipment ? " · ваша" : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[10px] font-medium text-foreground">
                    {Number(loadedItem.pallet_count ?? 0)}п · {Math.round(Number(loadedItem.pallet_count ?? 0) * Number(loadedItem.pallet_weight ?? 0))}кг
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ProductsTable({ items, id, products, vehicleContext, currentShipmentEditable, pulseFields }: {
  items: ItemRow[];
  id: string;
  products: ProductRef[];
  vehicleContext: VehicleContext | null;
  currentShipmentEditable: boolean;
  pulseFields: boolean;
}) {
  const [focused, setFocused] = useState<number | null>(null);
  const setFocusedCb = useCallback((i: number | null) => setFocused(i), []);
  const headerCls = (i: number) => cn(
    "px-1.5 py-2 font-medium transition-colors",
    focused === i ? "text-destructive" : "",
  );
  return (
    <FocusedColContext.Provider value={{ focused, setFocused: setFocusedCb }}>
      <table className="w-full min-w-[860px] text-[12px] tabular-nums">
        <thead className="sticky top-0 z-10 text-muted-foreground shadow-sm [&_th]:bg-table-head [&_th]:font-bold">
          <tr className="border-b border-border">
            <th className={cn(headerCls(0), "text-left")}>Товар</th>
            <th className={cn(headerCls(1), "text-left")}>Сорт</th>
            <th className={cn(headerCls(2), "text-left")}>Країна</th>
            <th className={cn(headerCls(3), "text-left")}>Калібр</th>
            <th className={cn(headerCls(4), "text-left")}>SKU</th>
            <th className={cn(headerCls(5), "text-left")}>Упаковка</th>
            <th className={cn(headerCls(6), "text-right")}>Пал.</th>
            <th className={cn(headerCls(7), "text-right")}>Нетто</th>
            <th className={cn(headerCls(8), "text-right")}>Брутто</th>
            <th className={cn(headerCls(9), "text-right min-w-[92px]")}>Ціна</th>
            <th className="sticky right-0 z-20 w-12 min-w-[3rem] bg-card px-1 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => {
            const capacitySource = vehicleContext?.loadedItems ?? items;
            const otherPallets = capacitySource.reduce((a, x) => a + (x.id === it.id ? 0 : Number(x.pallet_count ?? 0)), 0);
            const otherKg = capacitySource.reduce((a, x) => a + (x.id === it.id ? 0 : Number(x.pallet_count ?? 0) * Number(x.pallet_weight ?? 0)), 0);
            return <ProductRowEditor key={it.id} item={it} shipmentId={id} products={products} otherPallets={otherPallets} otherKg={otherKg} readOnly={!currentShipmentEditable} pulse={pulseFields} />;
          })}
        </tbody>
      </table>
      {/* currentShipmentEditable acts as the gate; floating "Додати товар" is rendered by the parent. */}
      <span hidden>{String(currentShipmentEditable)}</span>
    </FocusedColContext.Provider>
  );
}

const MAX_PALLETS = 26;
const MAX_WEIGHT_KG = 21500;
const MIN_AUTOCLOSE_WEIGHT_KG = 21000;

function ProductRowEditor({ item, shipmentId, products, otherPallets, otherKg, readOnly, pulse = false }: { item: ItemRow; shipmentId: string; products: ProductRef[]; otherPallets: number; otherKg: number; readOnly: boolean; pulse?: boolean }) {
  const qc = useQueryClient();
  const dbCountries = useCountryOptions();
  const countryAliases = useCountryAliases();
  const COUNTRY_OPTIONS = dbCountries;
  const knownProductNames = products.map((product) => product.name);
  const normalizedProductName = item.product_name === "Новий товар" ? "" : (item.product_name ?? "");
  // 9F Phase B — final weight model: одна правда (Нетто/Брутто = totals строки).
  // resolver per-pallet base хранится скрыто в form/DB и в UI не показывается.
  const [form, setForm] = useState({
    product_name: normalizedProductName,
    variety: item.variety ?? "",
    origin_country: item.origin_country ?? "",
    caliber: item.caliber ?? "",
    sku: item.sku ?? "",
    pallet_count: item.pallet_count ?? 0,
    package_used: item.package_used ?? "",
    net_weight_kg: Number(item.net_weight_kg ?? 0),
    gross_weight_kg: Number(item.gross_weight_kg ?? 0),
    resolver_net_per_pallet_kg: item.resolver_net_per_pallet_kg ?? null,
    resolver_gross_per_pallet_kg: item.resolver_gross_per_pallet_kg ?? null,
    net_auto: item.net_auto ?? false,
    gross_auto: item.gross_auto ?? false,
    unit_price: item.unit_price ?? 0,
    price_currency: (item.price_currency ?? "EUR") as "EUR" | "USD",
  });
  const dirtyRef = useRef(false);
  // touchedRef — пользователь явно изменил Товар/Країна в текущей сессии.
  // Используется как gate для resolver: открытие старой строки resolver не запускает.
  const touchedRef = useRef({ product: false, country: false });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    if (readOnly) return;
    dirtyRef.current = true;
    setForm((f) => ({ ...f, [k]: v }));
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
  const invalidPrice = !form.unit_price || Number(form.unit_price) <= 0;

  // Debounced autosave. Не пишет, пока строка невалидна (pc>0, net>0, gross>0, известный товар).
  // compat-shim для legacy pallet_weight: pallet_weight = net/pc (никогда 0, никогда null
  // для валидной строки). qty = net_weight_kg — численно идентично legacy pc*pw.
  useEffect(() => {
    if (readOnly) return;
    if (!dirtyRef.current) return;
    const t = setTimeout(async () => {
      const resolvedName =
        resolveProductOption(form.product_name, products.map((p) => p.name)) ??
        canonicalizeProductName(form.product_name);
      const trimmedProductName = resolvedName;
      if (!trimmedProductName || !isKnownProductName(trimmedProductName, products)) {
        return;
      }
      const pc = Number(form.pallet_count) || 0;
      const net = Number(form.net_weight_kg) || 0;
      const gross = Number(form.gross_weight_kg) || 0;
      if (pc <= 0 || net <= 0 || gross <= 0) {
        // невалидная строка — не сохраняем, legacy pallet_weight не перетираем.
        return;
      }
      const palletWeightShim = net / pc; // safe: pc>0 проверено выше
      const { error } = await supabase
        .from("shipment_items")
        .update({
          product_name: trimmedProductName,
          variety: form.variety || null,
          origin_country: normalizeCountry(form.origin_country) || null,
          caliber: form.caliber || null,
          sku: form.sku || null,
          pallet_count: pc,
          package_used: form.package_used.trim() || null,
          net_weight_kg: net,
          gross_weight_kg: gross,
          resolver_net_per_pallet_kg: form.resolver_net_per_pallet_kg,
          resolver_gross_per_pallet_kg: form.resolver_gross_per_pallet_kg,
          net_auto: form.net_auto,
          gross_auto: form.gross_auto,
          pallet_weight: palletWeightShim,
          qty: net,
          unit_price: Number(form.unit_price),
          price_currency: form.price_currency,
        })
        .eq("id", item.id);
      if (error) toast.error(error.message);
      else {
        dirtyRef.current = false;
        await syncVehicleStateForShipment(shipmentId);
        qc.invalidateQueries({ queryKey: ["shipment-products"] }); qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
        invalidateVehicleAndShipmentCaches(qc);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [form, item.id, products, qc, readOnly, shipmentId]);

  const [confirmOpen, setConfirmOpen] = useState(false);

  // 9F Phase B — resolver: пишет в form state (matched / pallet_no_match) или
  // показывает inline hint (product/country errors). Триггер строго onBlur
  // Товар/Країна, только если пользователь явно изменил одно из этих полей
  // в текущей сессии (touchedRef). НЕ useEffect, НЕ on mount, НЕ на keystroke.
  type ResolverHint =
    | { status: "pallet_no_match" | "product_no_match" | "product_ambiguous" | "country_no_match" }
    | null;
  const [hint, setHint] = useState<ResolverHint>(null);
  const resolverSeqRef = useRef(0);

  const runResolver = useCallback(async () => {
    if (readOnly) return;
    if (!touchedRef.current.product && !touchedRef.current.country) return;
    const product = form.product_name.trim();
    const country = form.origin_country.trim();
    if (!product || !country) return;
    const seq = ++resolverSeqRef.current;
    try {
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
      if (error) { setHint(null); return; }
      const row = Array.isArray(data) ? (data as unknown[])[0] : data;
      if (!row || typeof row !== "object") { setHint(null); return; }
      const r = row as Record<string, unknown>;
      const status = r.status;
      const asNum = (v: unknown): number | null => {
        if (v == null || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const asStr = (v: unknown): string | null =>
        typeof v === "string" && v.length > 0 ? v : null;

      if (status === "matched") {
        const pNet = asNum(r.pallet_net_kg);
        const pGross = asNum(r.pallet_gross_kg);
        const pkg = asStr(r.package_used);
        setHint(null);
        dirtyRef.current = true;
        setForm((f) => {
          const pc = (Number(f.pallet_count) || 0) > 0 ? Number(f.pallet_count) : 1;
          return {
            ...f,
            pallet_count: pc,
            package_used: pkg ?? f.package_used,
            resolver_net_per_pallet_kg: pNet,
            resolver_gross_per_pallet_kg: pGross,
            net_auto: true,
            gross_auto: true,
            net_weight_kg: pNet != null ? pNet * pc : f.net_weight_kg,
            gross_weight_kg: pGross != null ? pGross * pc : f.gross_weight_kg,
          };
        });
      } else if (status === "pallet_no_match") {
        setHint({ status: "pallet_no_match" });
        dirtyRef.current = true;
        setForm((f) => ({
          ...f,
          package_used: "",
          resolver_net_per_pallet_kg: null,
          resolver_gross_per_pallet_kg: null,
          net_auto: false,
          gross_auto: false,
        }));
      } else if (
        status === "product_no_match" ||
        status === "product_ambiguous" ||
        status === "country_no_match"
      ) {
        setHint({ status });
        // Не трогаем form / resolver_* / auto-флаги.
      } else {
        setHint(null);
      }
    } catch {
      if (seq === resolverSeqRef.current) setHint(null);
    }
  }, [readOnly, form.product_name, form.origin_country]);

  const handleResolverBlur = (e: FocusEvent<HTMLElement>) => {
    // Only fire when focus leaves this cell entirely (not when moving between child elements)
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    void runResolver();
  };


  const remove = async () => {
    if (readOnly) {
      toast.error("Можна редагувати лише власні товари");
      return;
    }
    const { error } = await supabase.from("shipment_items").delete().eq("id", item.id);
    if (error) return toast.error(error.message);
    setConfirmOpen(false);
    await syncVehicleStateForShipment(shipmentId);
    qc.invalidateQueries({ queryKey: ["shipment-products"] }); qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
    invalidateVehicleAndShipmentCaches(qc);
  };


  const { setFocused } = useContext(FocusedColContext);
  return (
    <>
    <tr
      className="border-b border-border/40"
      onFocusCapture={(e) => {
        const td = (e.target as HTMLElement).closest("td");
        if (td?.dataset.col) setFocused(Number(td.dataset.col));
      }}
      onBlurCapture={() => setFocused(null)}
    >
      <td data-col="0" onBlur={handleResolverBlur} className={cn("relative px-0.5 py-0.5", pulse && (invalidProduct || unknownProduct) && "field-invalid")}>
        <AutocompleteCell
          value={form.product_name}
          onChange={(v) => {
            if (readOnly) return;
            touchedRef.current.product = true;
            dirtyRef.current = true;
            setForm((f) => ({ ...f, product_name: v }));
          }}
          options={knownProductNames}
          placeholder={invalidProduct || unknownProduct ? "Товар*" : "Товар"}
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
      <td data-col="1" className="relative px-0.5 py-0.5">
        <VarietyCell value={form.variety} onChange={(v) => set("variety", v)} productName={form.product_name} readOnly={readOnly} />
      </td>
      <td data-col="2" onBlur={handleResolverBlur} className={cn("relative px-0.5 py-0.5", pulse && invalidCountry && "field-invalid")}>
        <AutocompleteCell
          value={form.origin_country}
          onChange={(v) => {
            if (readOnly) return;
            touchedRef.current.country = true;
            dirtyRef.current = true;
            setForm((f) => ({ ...f, origin_country: v }));
          }}
          options={COUNTRY_OPTIONS}
          aliases={countryAliases}
          placeholder={invalidCountry ? "Країна*" : "Країна"}
          className={cn(invalidCountry && "border-destructive/70 ring-1 ring-destructive/40 placeholder:text-destructive/80")}
          expandedMinWidth={180}
          readOnly={readOnly}
        />
      </td>
      <td data-col="3" className="relative px-0.5 py-0.5">
        <CellInput value={form.caliber} placeholder="—" onChange={(v) => set("caliber", v)} expandedMinWidth={120} readOnly={readOnly} />
      </td>
      <td data-col="4" className="relative px-0.5 py-0.5">
        <CellInput value={form.sku} placeholder="—" onChange={(v) => set("sku", v)} expandedMinWidth={120} readOnly={readOnly} />
      </td>
      <td data-col="5" className="relative px-0.5 py-0.5">
        <CellInput value={form.package_used} placeholder="—" onChange={(v) => set("package_used", v)} expandedMinWidth={140} readOnly={readOnly} />
      </td>
      <td data-col="6" className={cn("relative px-0.5 py-0.5", pulse && invalidPallets && "field-invalid")}>
        <NumCell
          value={form.pallet_count}
          readOnly={readOnly}
          invalid={invalidPallets}
          onChange={(v) => {
            if (readOnly) return;
            // 9F Phase B — capacity warning; reuse compat-derived per-pallet weight (net/pc).
            const avgPerPallet = palletCountNum > 0 ? netNum / palletCountNum : 0;
            const maxByPallets = Math.max(0, MAX_PALLETS - otherPallets);
            const maxByWeight = avgPerPallet > 0 ? Math.floor(Math.max(0, MAX_WEIGHT_KG - otherKg) / avgPerPallet) : Infinity;
            const max = Math.max(0, Math.min(maxByPallets, maxByWeight));
            if (v > max) {
              toast.error(`Перевищено ліміт: макс ${MAX_PALLETS} палет / ${MAX_WEIGHT_KG} кг на машину`);
            }
            dirtyRef.current = true;
            setForm((f) => {
              const next = { ...f, pallet_count: v };
              if (f.net_auto && f.resolver_net_per_pallet_kg != null) {
                next.net_weight_kg = f.resolver_net_per_pallet_kg * v;
              }
              if (f.gross_auto && f.resolver_gross_per_pallet_kg != null) {
                next.gross_weight_kg = f.resolver_gross_per_pallet_kg * v;
              }
              return next;
            });
          }}
        />
      </td>
      <td data-col="7" className={cn("relative px-0.5 py-0.5", pulse && invalidNet && "field-invalid")}>
        <NumCell
          value={Math.round(netNum)}
          readOnly={readOnly}
          step="1"
          invalid={invalidNet}
          onChange={(v) => {
            if (readOnly) return;
            const safe = Math.max(0, v);
            dirtyRef.current = true;
            // Manual override: фиксируем итог строки, resolver base НЕ трогаем,
            // обратной математики нет.
            setForm((f) => ({ ...f, net_weight_kg: safe, net_auto: false }));
          }}
        />
      </td>
      <td data-col="8" className={cn("relative px-0.5 py-0.5", pulse && invalidGross && "field-invalid")}>
        <NumCell
          value={Math.round(grossNum)}
          readOnly={readOnly}
          step="1"
          invalid={invalidGross}
          onChange={(v) => {
            if (readOnly) return;
            const safe = Math.max(0, v);
            dirtyRef.current = true;
            setForm((f) => ({ ...f, gross_weight_kg: safe, gross_auto: false }));
          }}
        />
      </td>
      <td data-col="9" className={cn("relative px-0.5 py-0.5 min-w-[96px]", pulse && invalidPrice && "field-invalid")}>
        <PriceCell
          value={form.unit_price}
          currency={form.price_currency}
          readOnly={readOnly}
          onValueChange={(v) => set("unit_price", v)}
          onCurrencyChange={(c) => set("price_currency", c)}
        />
      </td>
      <td className="sticky right-0 z-30 w-12 min-w-[3rem] bg-card px-1 py-0.5 shadow-[-6px_0_10px_-6px_rgba(0,0,0,0.22)]">
        <div className="flex justify-center">
          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <button
              type="button"
              onClick={() => {
                if (readOnly) {
                  toast.error("Можна редагувати лише власні товари");
                  return;
                }
                setConfirmOpen(true);
              }}
              disabled={readOnly}
              aria-label="Видалити рядок"
              className="relative z-10 inline-flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive active:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-5 w-5" />
            </button>
            <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-lg">
              <AlertDialogHeader>
                <AlertDialogTitle>Видалити позицію?</AlertDialogTitle>
                <AlertDialogDescription>
                  Рядок товару буде видалено з поставки без можливості швидкого відновлення.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Скасувати</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    void remove();
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Видалити
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </td>
    </tr>
    <tr className="border-b border-border">
      <td colSpan={9} className="bg-muted/30 px-3 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Собівартість $/кг
          </span>
          <div className="flex items-center gap-2">
            <ItemCustomsChip item={item} />
            <CostPair indicative={item.final_cost_indicative} invoice={item.final_cost_invoice} size="sm" />
          </div>
        </div>
        <ItemCustomsOverride item={item} shipmentId={shipmentId} readOnly={readOnly} />
        {resolver && (
          <div className="mt-1 text-[10px] leading-snug text-muted-foreground">
            {resolver.status === "matched" && (
              <div className="space-y-0.5">
                <div>
                  Упаковка: <span className="font-medium text-foreground">{resolver.package_used ?? "—"}</span>
                </div>
                <div>
                  Нетто база: <span className="font-medium text-foreground">{resolver.pallet_net_kg ?? "—"}</span> кг/пал
                  {" · "}
                  Брутто база: <span className="font-medium text-foreground">{resolver.pallet_gross_kg ?? "—"}</span> кг/пал
                </div>
                <div>
                  Нетто всього:{" "}
                  <span className="font-medium text-foreground">
                    {resolver.pallet_net_kg != null && palletCountNum > 0
                      ? Math.round(resolver.pallet_net_kg * palletCountNum)
                      : "—"}
                  </span>{" "}
                  кг
                  {" · "}
                  Брутто всього:{" "}
                  <span className="font-medium text-foreground">
                    {resolver.pallet_gross_kg != null && palletCountNum > 0
                      ? Math.round(resolver.pallet_gross_kg * palletCountNum)
                      : "—"}
                  </span>{" "}
                  кг
                </div>
              </div>
            )}
            {resolver.status === "pallet_no_match" && (
              <div className="text-amber-600 dark:text-amber-400">
                Стандарт палети не знайдено — введіть вагу вручну
              </div>
            )}
            {resolver.status === "product_no_match" && (
              <div className="text-destructive">Товар не розпізнано</div>
            )}
            {resolver.status === "product_ambiguous" && (
              <div className="text-destructive">Уточніть назву товару</div>
            )}
            {resolver.status === "country_no_match" && (
              <div className="text-destructive">Країну не розпізнано</div>
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

function ItemCustomsOverride({ item, shipmentId, readOnly }: { item: ItemRow; shipmentId: string; readOnly: boolean }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [pending, setPending] = useState(false);
  if (item.customs_match_id) return null;
  if (!isValidShipmentItem(item)) return null;
  const confirmedDuty =
    item.customs_override_confirmed_at && item.customs_override_duty_usd != null
      ? Number(item.customs_override_duty_usd)
      : null;
  const onConfirm = async (duty: number) => {
    setPending(true);
    try {
      const { error } = await supabase.rpc("confirm_shipment_item_customs_override", {
        p_item_id: item.id,
        p_duty: duty,
      });
      if (error) throw error;
      toast.success("Митний збір підтверджено");
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
      value={value}
      readOnly={readOnly}
      list={list}
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
      }}
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

function VarietyCell({ value, onChange, productName, readOnly }: { value: string; onChange: (v: string) => void; productName: string; readOnly: boolean }) {
  const varieties = useVarietiesFor(productName);
  return (
    <VarietyAutocomplete
      value={value}
      onChange={onChange}
      varieties={varieties}
      placeholder="—"
      inputClassName={cn(
        "h-8 w-full border-transparent bg-transparent px-1.5 text-[12px] focus:border-input focus:bg-background",
        readOnly && "cursor-default",
      )}
      disabled={readOnly}
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
      readOnly={readOnly}
      inputMode="decimal"
      step={step ?? "1"}
      value={text}
      placeholder={focused ? "" : "—"}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      onFocus={(e) => {
        if (readOnly) return;
        setFocused(true);
        e.currentTarget.select();
      }}
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
        readOnly={readOnly}
        inputMode="decimal"
        value={text}
        placeholder={focused ? "" : (isEmpty ? "Ціна*" : "—")}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={(e) => { if (readOnly) return; setFocused(true); e.currentTarget.select(); }}
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
