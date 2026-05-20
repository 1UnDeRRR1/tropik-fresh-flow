import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, createContext, useContext, useCallback } from "react";
import { ArrowLeft, ChevronDown, Plus, Trash2 } from "lucide-react";
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
import { countPositions, formatPositions } from "@/lib/positions";

import { StaffOnly } from "@/components/StaffOnly";

export const Route = createFileRoute("/_authenticated/shipments/$id/products")({
  validateSearch: (search: Record<string, unknown>): { fromOffer?: string } => ({
    fromOffer: typeof search.fromOffer === "string" ? search.fromOffer : undefined,
  }),
  component: () => <StaffOnly><ProductsFullscreen /></StaffOnly>,
});

import { COUNTRY_ALIASES } from "@/lib/country-search";

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
};

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
  return (value ?? "").trim().toLowerCase();
}

function isKnownProductName(value: string | null | undefined, products: ProductRef[]) {
  const normalized = normalizeProductValue(value);
  if (!normalized) return false;
  return products.some((product) => normalizeProductValue(product.name) === normalized);
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
  // Авто закривається автоматично лише якщо досягнуто межі по палетах (≥26)
  // АБО вага потрапила в діапазон 21000–21500 кг включно. Інакше залишається відкритим.
  const shouldBeClosed =
    totalPallets >= MAX_PALLETS ||
    (totalWeight >= MIN_AUTOCLOSE_WEIGHT_KG && totalWeight <= MAX_WEIGHT_KG);
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
  qc.invalidateQueries({ queryKey: ["shipments-list"] });
  qc.invalidateQueries({ queryKey: ["open-vehicles"] });
  qc.invalidateQueries({ queryKey: ["vehicles-list"] });
  qc.invalidateQueries({ queryKey: ["vehicles-open"] });
  qc.invalidateQueries({ queryKey: ["distribution-list"] });
  qc.invalidateQueries({ queryKey: ["shipment-products"] });
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
        supabase.from("shipment_items").select("id,product_name,variety,origin_country,caliber,sku,pallet_count,pallet_weight,unit_price,price_currency,final_cost_indicative,final_cost_invoice,customs_match_id").eq("shipment_id", id).order("created_at"),
        supabase.from("products").select("name,default_pallet_weight").eq("is_active", true),
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
      return {
        shipment: sh ? ({ ...sh, vehicle_owner_id: vehicleOwnerId, supplier_name: sh.suppliers?.name ?? null } as ShipmentRow) : null,
        items: (items.data ?? []) as ItemRow[],
        products: (prods.data ?? []) as ProductRef[],
        vehicleContext,
      };
    },
  });

  const sh = data?.shipment;
  const items = data?.items ?? [];
  const validItems = items.filter(isValidShipmentItem);
  const products = data?.products ?? [];
  const vehicleContext = data?.vehicleContext ?? null;
  const country = toUaCountry(sh?.country) || "—";
  
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
            "id,product_name,origin_country,caliber,variety,pallet_weight,price_per_kg,price_currency,freight_amount,freight_currency,linked_shipment_id,status",
          )
          .eq("id", fromOfferId)
          .maybeSingle();
        if (offerErr || !offer) return;

        // Check if other shipments are already linked to this offer
        // (manager is creating an additional shipment to absorb leftover pallets).
        const { data: existingItems } = await supabase
          .from("shipment_items")
          .select("pallet_count, shipment_id")
          .eq("linked_offer_id", offer.id)
          .neq("shipment_id", id);

        let palletCount: number;
        const palletWeight = Number(offer.pallet_weight ?? 0);

        if (existingItems && existingItems.length > 0) {
          // Compute pending: total approved - already linked elsewhere
          const { data: responses } = await supabase
            .from("manager_offer_responses")
            .select("approved_pallets, requested_pallets, linked_pallets")
            .eq("offer_id", offer.id);
          const totalApproved = (responses ?? []).reduce(
            (s, r) => s + Number((r as { approved_pallets: number | null; requested_pallets: number }).approved_pallets ?? r.requested_pallets ?? 0),
            0,
          );
          const totalLinked = (responses ?? []).reduce(
            (s, r) => s + Number((r as { linked_pallets: number | null }).linked_pallets ?? 0),
            0,
          );
          const pending = Math.max(totalApproved - totalLinked, 0);
          palletCount = Math.min(MAX_PALLETS, Math.max(1, pending || 1));
        } else {
          // Target: fill the truck near the 21000 kg / 26 pallet limits.
          const TARGET_KG = 21000;
          palletCount = palletWeight > 0
            ? Math.min(MAX_PALLETS, Math.max(1, Math.floor(TARGET_KG / palletWeight)))
            : 0;
        }
        const totalKg = palletCount * palletWeight;

        const { error: insErr } = await supabase.from("shipment_items").insert({
          shipment_id: id,
          product_name: offer.product_name,
          origin_country: offer.origin_country
            ? normalizeCountry(offer.origin_country)
            : null,
          caliber: offer.caliber ?? null,
          variety: offer.variety ?? null,
          pallet_count: palletCount,
          pallet_weight: palletWeight,
          unit_price: Number(offer.price_per_kg ?? 0),
          price_currency: offer.price_currency ?? "EUR",
          qty: totalKg,
          unit: "kg",
          linked_offer_id: offer.id,
        });
        if (insErr) {
          prefillRunRef.current = false;
          toast.error(insErr.message);
          return;
        }

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

        // Link the offer to this shipment so the FIFO auto-distribution
        // runs (the manager_offers trigger fires sync_manager_offer_distribution).
        if (offer.linked_shipment_id !== id || offer.status !== "linked") {
          await supabase
            .from("manager_offers")
            .update({ status: "linked", linked_shipment_id: id })
            .eq("id", offer.id);
        }

        qc.invalidateQueries({ queryKey: ["shipment-products", user?.id, id] });
        qc.invalidateQueries({ queryKey: ["shipment", id] });
        invalidateVehicleAndShipmentCaches(qc);
      } catch {
        prefillRunRef.current = false;
      }
    })();
  }, [fromOfferId, sh, items.length, currentShipmentEditable, id, qc, user?.id]);



  const leaveProducts = async () => {
    const hasDraftRows = items.some(
      (item) => !(item.product_name ?? "").trim() || item.product_name === "Новий товар" || Number(item.pallet_count ?? 0) <= 0,
    );
    const deleted = hasDraftRows ? false : await deleteShipmentIfEmpty(id);
    if (deleted) {
      navigate({ to: "/shipments" });
      return;
    }
    await syncVehicleStateForShipment(id);
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

  return (
    <div className={cn("fixed inset-0 z-50 flex flex-col bg-background", shake && "animate-shake")}>
      <header className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 pt-safe">
        <button
          type="button"
          onClick={() => { void leaveProducts(); }}
          className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-sm font-semibold">{sh?.code ?? "…"}</div>
          <div className={cn("truncate text-[10px] uppercase tracking-wide", incompleteCount > 0 ? "text-destructive" : "text-muted-foreground")}>
            {country} · {formatPositions(countPositions(items, (i) => i.product_name))} поз.{incompleteCount > 0 && ` · ${incompleteCount} незаповн.`}
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
        />
      )}

      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">Позицій ще немає</p>
            <Button onClick={addItem} className="bg-brand text-brand-foreground hover:bg-brand/90">
              <Plus className="mr-1 h-4 w-4" /> Додати товар
            </Button>
          </div>
        ) : (
          <table className="w-full min-w-[860px] text-[12px] tabular-nums">
            <thead className="sticky top-0 z-10 text-muted-foreground shadow-sm [&_th]:bg-table-head [&_th]:font-bold">
              <tr className="border-b border-border">
                <th className="px-1.5 py-2 text-left font-medium">Товар</th>
                <th className="px-1.5 py-2 text-left font-medium">Сорт</th>
                <th className="px-1.5 py-2 text-left font-medium">Країна</th>
                <th className="px-1.5 py-2 text-left font-medium">Калібр</th>
                <th className="px-1.5 py-2 text-left font-medium">Спец.</th>
                <th className="px-1.5 py-2 text-right font-medium">Пал.</th>
                <th className="px-1.5 py-2 text-right font-medium">Вага, кг</th>
                <th className="px-1.5 py-2 text-right font-medium min-w-[92px]">Ціна</th>
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
        )}
      </div>

      <footer className="border-t border-border bg-card px-3 py-2 pb-safe">
        <Link to="/shipments/$id" params={{ id }} className="block" onClick={(e) => {
          if (incompleteCount > 0 || !hasRealPallets || transportMissing) {
            e.preventDefault();
            triggerShake(transportMissing);
            return;
          }
          e.preventDefault();
          void leaveProducts();
        }}>
          <Button
            className={cn(
              "w-full",
              (incompleteCount > 0 || transportMissing)
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-brand text-brand-foreground hover:bg-brand/90",
            )}
          >
            {transportMissing
              ? "Вкажіть вартість перевезення"
              : incompleteCount > 0
                ? `Заповніть обов'язкові поля (${incompleteCount})`
                : "Готово"}
          </Button>
        </Link>
      </footer>
    </div>
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

function SharedVehicleSummary({ vehicleContext, currentShipmentId: _currentShipmentId }: { vehicleContext: VehicleContext; currentShipmentId: string }) {
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
        <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
          {count} поз.
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
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

const MAX_PALLETS = 26;
const MAX_WEIGHT_KG = 21500;
const MIN_AUTOCLOSE_WEIGHT_KG = 21000;

function ProductRowEditor({ item, shipmentId, products, otherPallets, otherKg, readOnly, pulse = false }: { item: ItemRow; shipmentId: string; products: ProductRef[]; otherPallets: number; otherKg: number; readOnly: boolean; pulse?: boolean }) {
  const qc = useQueryClient();
  const dbCountries = useCountryOptions();
  const COUNTRY_OPTIONS = dbCountries;
  const knownProductNames = products.map((product) => product.name);
  const normalizedProductName = item.product_name === "Новий товар" ? "" : (item.product_name ?? "");
  const [form, setForm] = useState({
    product_name: normalizedProductName,
    variety: item.variety ?? "",
    origin_country: item.origin_country ?? "",
    caliber: item.caliber ?? "",
    sku: item.sku ?? "",
    pallet_count: item.pallet_count ?? 0,
    pallet_weight: Number(item.pallet_weight ?? 0),
    unit_price: item.unit_price ?? 0,
    price_currency: (item.price_currency ?? "EUR") as "EUR" | "USD",
  });
  const dirtyRef = useRef(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    if (readOnly) return;
    dirtyRef.current = true;
    setForm((f) => ({ ...f, [k]: v }));
  };

  // Field-level validation
  const palletCountNum = Number(form.pallet_count) || 0;
  const palletWeightNum = Number(form.pallet_weight) || 0;
  const totalWeightNum = palletCountNum * palletWeightNum;
  const invalidProduct = !form.product_name.trim();
  const unknownProduct = !!form.product_name.trim() && !isKnownProductName(form.product_name, products);
  const invalidCountry = !form.origin_country.trim();
  const invalidPallets = palletCountNum <= 0;
  const invalidWeight = totalWeightNum <= 0;
  const invalidPrice = !form.unit_price || Number(form.unit_price) <= 0;

  const palletWeight = Number(form.pallet_weight) || 0;

  // Debounced autosave + refresh to pull in trigger-computed final_cost_indicative
  useEffect(() => {
    if (readOnly) return;
    if (!dirtyRef.current) return;
    const t = setTimeout(async () => {
      const trimmedProductName = form.product_name.trim();
      if (!trimmedProductName || !isKnownProductName(trimmedProductName, products)) {
        return;
      }
      const palletCount = Number(form.pallet_count);
      const totalKg = palletCount * palletWeight;
      const { error } = await supabase
        .from("shipment_items")
        .update({
          product_name: trimmedProductName,
          variety: form.variety || null,
          origin_country: normalizeCountry(form.origin_country) || null,
          caliber: form.caliber || null,
          sku: form.sku || null,
          pallet_count: palletCount,
          pallet_weight: palletWeight,
          unit_price: Number(form.unit_price),
          price_currency: form.price_currency,
          qty: totalKg,
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
  }, [form, palletWeight, item.id, products, qc, readOnly, shipmentId]);

  const [confirmOpen, setConfirmOpen] = useState(false);

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

  const totalWeight = (Number(form.pallet_count) || 0) * palletWeight;

  return (
    <>
    <tr className="border-b border-border/40">
      <td className={cn("relative px-0.5 py-0.5", pulse && (invalidProduct || unknownProduct) && "field-invalid")}>
        <AutocompleteCell
          value={form.product_name}
          onChange={(v) => set("product_name", v)}
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
      <td className="relative px-0.5 py-0.5">
        <CellInput value={form.variety} placeholder="—" onChange={(v) => set("variety", v)} expandedMinWidth={160} readOnly={readOnly} />
      </td>
      <td className={cn("relative px-0.5 py-0.5", pulse && invalidCountry && "field-invalid")}>
        <AutocompleteCell
          value={form.origin_country}
          onChange={(v) => set("origin_country", v)}
          options={COUNTRY_OPTIONS}
          aliases={COUNTRY_ALIASES}
          placeholder={invalidCountry ? "Країна*" : "Країна"}
          className={cn(invalidCountry && "border-destructive/70 ring-1 ring-destructive/40 placeholder:text-destructive/80")}
          expandedMinWidth={180}
          readOnly={readOnly}
        />
      </td>
      <td className="relative px-0.5 py-0.5">
        <CellInput value={form.caliber} placeholder="—" onChange={(v) => set("caliber", v)} expandedMinWidth={120} readOnly={readOnly} />
      </td>
      <td className="relative px-0.5 py-0.5">
        <CellInput value={form.sku} placeholder="—" onChange={(v) => set("sku", v)} expandedMinWidth={120} readOnly={readOnly} />
      </td>
      <td className={cn("relative px-0.5 py-0.5", pulse && invalidPallets && "field-invalid")}>
        <NumCell
          value={form.pallet_count}
          readOnly={readOnly}
          invalid={invalidPallets}
          onChange={(v) => {
            const maxByPallets = Math.max(0, MAX_PALLETS - otherPallets);
            const maxByWeight = palletWeight > 0 ? Math.floor(Math.max(0, MAX_WEIGHT_KG - otherKg) / palletWeight) : Infinity;
            const max = Math.max(0, Math.min(maxByPallets, maxByWeight));
            const nextCount = v > max ? max : v;
            if (v > max) {
              toast.error(`Перевищено ліміт: макс ${MAX_PALLETS} палет / ${MAX_WEIGHT_KG} кг на машину`);
            }
            if (readOnly) return;
            dirtyRef.current = true;
            setForm((f) => ({ ...f, pallet_count: nextCount }));
          }}
        />
      </td>
      <td className={cn("relative px-0.5 py-0.5", pulse && invalidWeight && "field-invalid")}>
        <NumCell
          value={Math.round(totalWeight)}
          readOnly={readOnly}
          step="1"
          invalid={invalidWeight}
          onChange={(totalKgInput) => {
            const palletCount = Number(form.pallet_count) || 0;
            const safeTotalKg = Math.max(0, totalKgInput);
            if (otherKg + safeTotalKg > MAX_WEIGHT_KG) {
              toast.error(`Перевищено ліміт: макс ${MAX_WEIGHT_KG} кг на машину`);
              return;
            }
            const newPerPallet = palletCount > 0 ? safeTotalKg / palletCount : safeTotalKg;
            set("pallet_weight", newPerPallet);
          }}
        />
      </td>
      <td className={cn("relative px-0.5 py-0.5 min-w-[96px]", pulse && invalidPrice && "field-invalid")}>
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
            {!(item as any).customs_match_id ? (
              <span
                title="Митна ставка не знайдена для цього товару/країни — мито = 0"
                className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600"
              >
                ⚠ без мита
              </span>
            ) : null}
            <CostPair indicative={item.final_cost_indicative} invoice={item.final_cost_invoice} size="sm" />
          </div>
        </div>
      </td>
    </tr>
    </>
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
