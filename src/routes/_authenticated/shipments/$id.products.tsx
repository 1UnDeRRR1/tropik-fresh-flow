import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toUaCountry } from "@/lib/countries";
import { AutocompleteCell } from "@/components/AutocompleteCell";
import { useCountryOptions } from "@/hooks/useCountryOptions";
import { CostPair } from "@/components/CostPair";
import { deleteShipmentIfEmpty } from "@/lib/cleanup-empty-shipment";
import { countPositions, formatPositions } from "@/lib/positions";

import { StaffOnly } from "@/components/StaffOnly";

export const Route = createFileRoute("/_authenticated/shipments/$id/products")({
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

function ProductsFullscreen() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, loading, hasRole } = useAuth();
  const isAdmin = hasRole(["super_admin", "admin"]);

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
  
  const incompleteItems = items.filter((i) => Number(i.pallet_count ?? 0) > 0 && getMissingFields(i).length > 0);
  const incompleteCount = incompleteItems.length;
  const hasRealPallets = validItems.length > 0;
  const currentShipmentOwnerId = sh ? sh.import_manager_id ?? sh.created_by ?? null : null;
  const currentShipmentEditable = !!user?.id && (!!isAdmin || currentShipmentOwnerId === user.id);
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

  useEffect(() => {
    const onUnload = () => {
      void deleteShipmentIfEmpty(id);
    };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, [id]);

  const leaveProducts = async () => {
    const deleted = await deleteShipmentIfEmpty(id);
    if (deleted) {
      navigate({ to: "/shipments" });
      return;
    }
    navigate({ to: "/shipments/$id", params: { id } });
  };

  const blockExit = (e: React.MouseEvent) => {
    if (incompleteCount > 0) {
      e.preventDefault();
      toast.error(`Заповніть всі обов'язкові поля (${incompleteCount} поз.)`);
      return;
    }
    if (!hasRealPallets) {
      e.preventDefault();
      toast.error("Додайте хоча б 1 товар з палетами або поставку буде видалено");
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
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
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
            <thead className="sticky top-0 z-10 bg-card text-muted-foreground shadow-sm">
              <tr className="border-b border-border">
                <th className="px-1.5 py-2 text-left font-medium">Товар</th>
                <th className="px-1.5 py-2 text-left font-medium">Сорт</th>
                <th className="px-1.5 py-2 text-left font-medium">Країна</th>
                <th className="px-1.5 py-2 text-left font-medium">Калібр</th>
                <th className="px-1.5 py-2 text-left font-medium">Спец.</th>
                <th className="px-1.5 py-2 text-right font-medium">Пал.</th>
                <th className="px-1.5 py-2 text-right font-medium">Вага, кг</th>
                <th className="px-1.5 py-2 text-right font-medium min-w-[92px]">Ціна</th>
                <th className="sticky right-0 z-20 bg-card px-1.5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const capacitySource = vehicleContext?.loadedItems ?? items;
                const otherPallets = capacitySource.reduce((a, x) => a + (x.id === it.id ? 0 : Number(x.pallet_count ?? 0)), 0);
                const otherKg = capacitySource.reduce((a, x) => a + (x.id === it.id ? 0 : Number(x.pallet_count ?? 0) * Number(x.pallet_weight ?? 0)), 0);
                return <ProductRowEditor key={it.id} item={it} shipmentId={id} products={products} otherPallets={otherPallets} otherKg={otherKg} readOnly={!currentShipmentEditable} />;
              })}
            </tbody>
          </table>
        )}
      </div>

      <footer className="border-t border-border bg-card px-3 py-2 pb-safe">
        <Link to="/shipments/$id" params={{ id }} className="block" onClick={(e) => {
          if (!hasRealPallets) {
            e.preventDefault();
            toast.error("Додайте хоча б 1 товар з палетами або поставку буде видалено");
            return;
          }
          e.preventDefault();
          void leaveProducts();
        }}>
          <Button
            className={cn(
              "w-full",
              incompleteCount > 0
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-brand text-brand-foreground hover:bg-brand/90",
            )}
          >
            {incompleteCount > 0 ? `Заповніть обов'язкові поля (${incompleteCount})` : "Готово"}
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
}: {
  shipment: ShipmentRow;
  currentUserId: string | null;
  vehicleContext: VehicleContext | null;
  canEditTransport: boolean;
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
      "flex items-center gap-2 border-b px-3 py-1.5 transition-colors",
      isEmpty ? "border-destructive bg-destructive/10" : "border-border bg-muted/40",
    )}>
      <span className={cn(
        "text-[11px] font-semibold uppercase tracking-wide",
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
        onBlur={(e) => {
          if (isEmpty) {
            e.preventDefault();
            toast.error("Вкажіть вартість перевезення");
            setTimeout(() => inputRef.current?.focus(), 0);
          }
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

function ProductRowEditor({ item, shipmentId, products, otherPallets, otherKg, readOnly }: { item: ItemRow; shipmentId: string; products: ProductRef[]; otherPallets: number; otherKg: number; readOnly: boolean }) {
  const qc = useQueryClient();
  const dbCountries = useCountryOptions();
  const COUNTRY_OPTIONS = dbCountries;
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
      const palletCount = Number(form.pallet_count);
      const totalKg = palletCount * palletWeight;
      const { error } = await supabase
        .from("shipment_items")
        .update({
          product_name: trimmedProductName,
          variety: form.variety || null,
          origin_country: form.origin_country || null,
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
        qc.invalidateQueries({ queryKey: ["shipment-products"] }); qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
      }
    }, 600);
    return () => clearTimeout(t);
  }, [form, palletWeight, item.id, qc, readOnly]);

  const remove = async () => {
    if (readOnly) {
      toast.error("Можна редагувати лише власні товари");
      return;
    }
    if (!confirm("Видалити позицію?")) return;
    const { error } = await supabase.from("shipment_items").delete().eq("id", item.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["shipment-products"] }); qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
  };

  const totalWeight = (Number(form.pallet_count) || 0) * palletWeight;

  return (
    <>
    <tr className="border-b border-border/40">
      <td className="relative px-0.5 py-0.5">
        <AutocompleteCell
          value={form.product_name}
          onChange={(v) => set("product_name", v)}
          options={products.map((p) => p.name)}
          placeholder={invalidProduct ? "Товар*" : "Товар"}
          className={cn("font-medium", invalidProduct && "border-destructive/70 ring-1 ring-destructive/40 placeholder:text-destructive/80")}
          expandedMinWidth={200}
          required={false}
          readOnly={readOnly}
        />
      </td>
      <td className="relative px-0.5 py-0.5">
        <CellInput value={form.variety} placeholder="—" onChange={(v) => set("variety", v)} expandedMinWidth={160} readOnly={readOnly} />
      </td>
      <td className="relative px-0.5 py-0.5">
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
      <td className="relative px-0.5 py-0.5">
        <NumCell
          value={form.pallet_count}
          readOnly={readOnly}
          invalid={invalidPallets}
          onChange={(v) => {
            const maxByPallets = Math.max(0, MAX_PALLETS - otherPallets);
            const maxByWeight = palletWeight > 0 ? Math.floor((MAX_WEIGHT_KG - otherKg) / palletWeight) : Infinity;
            const max = Math.max(0, Math.min(maxByPallets, maxByWeight));
            const nextCount = v > max ? max : v;
            if (v > max) {
              toast.error(`Перевищено ліміт: макс ${MAX_PALLETS} палет / ${MAX_WEIGHT_KG} кг на машину`);
            }
            // Keep TOTAL weight constant: recompute per-pallet weight
            const currentTotal = (Number(form.pallet_count) || 0) * palletWeight;
            const newPerPallet = nextCount > 0 ? currentTotal / nextCount : 0;
            if (readOnly) return;
            dirtyRef.current = true;
            setForm((f) => ({ ...f, pallet_count: nextCount, pallet_weight: newPerPallet }));
          }}
        />
      </td>
      <td className="relative px-0.5 py-0.5">
        <NumCell
          value={Math.round(totalWeight)}
          readOnly={readOnly}
          step="1"
          invalid={invalidWeight}
          onChange={(totalKgInput) => {
            const palletCount = Number(form.pallet_count) || 0;
            if (otherKg + totalKgInput > MAX_WEIGHT_KG) {
              toast.error(`Перевищено ліміт: макс ${MAX_WEIGHT_KG} кг на машину`);
            }
            const newPerPallet = palletCount > 0 ? totalKgInput / palletCount : totalKgInput;
            set("pallet_weight", newPerPallet);
          }}
        />
      </td>
      <td className="relative px-0.5 py-0.5 min-w-[96px]">
        <PriceCell
          value={form.unit_price}
          currency={form.price_currency}
          readOnly={readOnly}
          onValueChange={(v) => set("unit_price", v)}
          onCurrencyChange={(c) => set("price_currency", c)}
        />
      </td>
      <td className="sticky right-0 z-20 bg-card px-0.5 py-0.5 shadow-[-4px_0_6px_-4px_rgba(0,0,0,0.15)]">
        <button
          type="button"
          onClick={remove}
          disabled={readOnly}
          aria-label="Видалити рядок"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-40 touch-manipulation"
        >
          <Trash2 className="h-5 w-5" />
        </button>
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

const EXPANDED = "absolute left-0 top-[calc(100%+10px)] z-40 h-10 min-w-[160px] w-max max-w-[85vw] rounded-md border border-border bg-card text-sm shadow-xl ring-2 ring-brand/50";
const EXPANDED_RIGHT = "absolute right-0 left-auto top-[calc(100%+10px)] z-40 h-10 min-w-[120px] w-max max-w-[85vw] rounded-md border border-border bg-card text-sm shadow-xl ring-2 ring-brand/50";

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
        "h-8 border-transparent bg-transparent px-1.5 text-[12px] focus:border-input focus:bg-background",
        focused && EXPANDED,
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
        "h-8 border-transparent bg-transparent px-1.5 text-right text-[12px] tabular-nums focus:border-input focus:bg-background",
        focused && EXPANDED_RIGHT + " text-right",
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
          focused && EXPANDED_RIGHT + " text-right",
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
