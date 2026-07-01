import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useRef, useState, useEffect } from "react";
import { Plus, MoreVertical, Trash2, X, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cancelShipment } from "@/lib/shipments.functions";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";

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
import { cn } from "@/lib/utils";
import { toUaCountry } from "@/lib/countries";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { useFocusHighlight } from "@/lib/use-focus-highlight";
import { useStableQueryData } from "@/lib/query-stability";
import { useRealtimeInvalidate } from "@/hooks/useRealtimeInvalidate";
import {
  fetchActiveReservesByVehicle,
  releaseVehicleReserve,
  closeVehicleReserves,
  type ActiveReserve,
} from "@/lib/vehicle-reserves";

import { StaffOnly } from "@/components/StaffOnly";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CompactFilterSelect } from "@/components/CompactFilterSelect";
import { ShipmentQuickView } from "@/components/ShipmentQuickView";

type ShipmentsSearch = { tab?: "shipments" | "vehicles" };

export const Route = createFileRoute("/_authenticated/shipments/")({
  validateSearch: (search: Record<string, unknown>): ShipmentsSearch => ({
    tab: search.tab === "vehicles" || search.tab === "shipments" ? search.tab : undefined,
  }),
  component: () => <StaffOnly><ShipmentsList /></StaffOnly>,
});

function isOwnedShipment(
  shipment: { import_manager_id: string | null; created_by?: string | null },
  userId?: string,
  currentManagerId?: string | null,
) {
  if (!userId) return false;
  return (
    shipment.created_by === userId
    || (!!currentManagerId && shipment.import_manager_id === currentManagerId)
    || shipment.import_manager_id === userId
  );
}

// Short ETA formatter mirrored from branch ("Вільно" / "Головна").
const fmtEtaShort = (eta: string | null | undefined): string => {
  if (!eta) return "—";
  const d = new Date(eta);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mo = d.toLocaleDateString("uk-UA", { month: "short" }).replace(/\.$/, "");
  return `${day}\u202F${mo}.`;
};

type BucketView = "active" | "unloaded";

// Local sliding segmented toggle, embedded in the top control card.
// Visual pattern mirrored from branch-offers BucketToggle; kept local
// (no shared extraction in this stage).
function BucketToggle({
  value,
  onChange,
}: {
  value: BucketView;
  onChange: (v: BucketView) => void;
}) {
  return (
    <div
      className={cn(
        "relative grid h-9 grid-cols-2 rounded-full border-2 bg-muted p-1 text-sm transition-colors",
        value === "active" ? "border-emerald-600" : "border-destructive",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-0.25rem)] rounded-full bg-background shadow-sm transition-transform duration-200 ease-out",
          value === "unloaded" && "translate-x-full",
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
        onClick={() => onChange("unloaded")}
        className={cn(
          "relative z-10 rounded-full text-center transition-colors",
          value === "unloaded" ? "font-semibold text-foreground" : "text-muted-foreground",
        )}
      >
        Розвантажено
      </button>
    </div>
  );
}

function ShipmentsList() {
  const search = Route.useSearch();
  const [tab, setTab] = useState<"shipments" | "vehicles">(
    () => search.tab ?? "shipments",
  );
  const [board, setBoard] = useState<BucketView>("active");
  const [supplierFilter, setSupplierFilter] = useState<string>("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const { hasRole, user } = useAuth();
  const isStaff = hasRole(["super_admin", "admin", "import_manager"]);
  const isAdmin = hasRole(["super_admin", "admin"]);
  const qc = useQueryClient();

  useEffect(() => {
    if (search.tab) setTab(search.tab);
  }, [search.tab]);

  // Realtime: keep both tabs in sync without page reload after create/close.
  useRealtimeInvalidate(
    "shipments-list-rt",
    [
      "shipments",
      "vehicles",
      "shipment_items",
      "distributions",
      "distribution_items",
      // Build 2E-B — pick up reserve create/release/close in the list.
      "vehicle_reserves",
    ],
    [
      ["shipments-list"],
      ["open-vehicles-list"],
      ["vehicle-reserves-open"],
    ],
  );

  const { data: currentManagerId } = useQuery({
    queryKey: ["current-import-manager-id", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("current_import_manager_id");
      if (error) throw error;
      return data ?? null;
    },
  });

  const shipmentsQuery = useQuery({
    queryKey: ["shipments-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select(`
          id, code, status, pipeline_status, eta, loading_date, country, import_manager_id, created_by, unloaded_at, archived_at, cancelled_at, updated_at,
          loading_address, loading_reference, tractor_plate, vehicle_plate, driver_name, temperature_mode,
          vehicle:vehicles(status),
          suppliers(name, country),
          import_managers(full_name),
          shipment_items(product_name,pallet_count,pallet_weight,net_weight_kg,final_cost_indicative,final_cost_invoice),
          distributions(distribution_items(pallets))
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data } = useStableQueryData({
    data: shipmentsQuery.data,
    isSuccess: shipmentsQuery.isSuccess,
    isFetching: shipmentsQuery.isFetching,
    isError: shipmentsQuery.isError,
    module: "shipments-list",
    countRows: (rows) => rows.length,
  });

  const rows = useMemo(() => {
    return (data ?? []).map((s) => {
      const items = (s.shipment_items ?? []) as Array<{
        pallet_count: number | null;
        pallet_weight: number | null;
        net_weight_kg: number | null;
      }>;
      const fact = items.reduce((a, it) => a + Number(it.pallet_count ?? 0), 0);
      const netKg = items.reduce((a, it) => a + Number(it.net_weight_kg ?? 0), 0);
      const dist = (s.distributions ?? []).reduce(
        (a: number, d: { distribution_items: { pallets: number | null }[] | null }) =>
          a + (d.distribution_items ?? []).reduce((aa, di) => aa + Number(di.pallets ?? 0), 0),
        0,
      );
      return { ...s, fact, dist, remaining: fact - dist, netKg };
    });
  }, [data]);

  const supplierOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const name = (r as { suppliers?: { name?: string | null } | null }).suppliers?.name;
      if (name) set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk")).map((n) => ({ value: n, label: n }));
  }, [rows]);
  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const c = (r as { suppliers?: { country?: string | null } | null }).suppliers?.country;
      if (c && c.trim()) {
        const ua = toUaCountry(c) || c;
        set.add(ua);
      }
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b, "uk"))
      .map((n) => ({ value: n, label: n }));
  }, [rows]);

  const filtered = rows
    .filter((r) => {
      // Cancelled shipments leave the normal active/unloaded working list.
      // They remain readable in DB for audit and surface in branch Archive
      // (event_type='cancelled') via archive_write_cancelled_for_shipment.
      if ((r as { status?: string | null }).status === "cancelled") return false;
      const u = (r as { unloaded_at?: string | null }).unloaded_at;
      const arch = (r as { archived_at?: string | null }).archived_at;
      if (arch) return false;
      if (board === "unloaded") return !!u;
      const vehicleStatus = (r as { vehicle?: { status?: string | null } | null }).vehicle?.status;
      if (vehicleStatus === "open") return false;
      return !u;
    })
    .filter((r) => r.fact > 0)
    .filter((r) => {
      if (!isAdmin || supplierFilter === "all") return true;
      return (r as { suppliers?: { name?: string | null } | null }).suppliers?.name === supplierFilter;
    })
    .filter((r) => {
      if (!isAdmin || countryFilter === "all") return true;
      const raw = (r as { suppliers?: { country?: string | null } | null }).suppliers?.country ?? "";
      const ua = toUaCountry(raw) || raw;
      return ua === countryFilter;
    })
    // Default sort: ETA ascending, nulls last.
    .sort((a, b) => {
      if (!a.eta && !b.eta) return 0;
      if (!a.eta) return 1;
      if (!b.eta) return -1;
      return a.eta.localeCompare(b.eta);
    });

  useFocusHighlight([filtered]);

  return (
    <div className="space-y-4">
      {/* Title */}
      <PageHeader title="Поставки" />

      {/* Top dual-action block: Нова поставка (red) | Відкриті авто (green).
          Sized to visually match the BucketToggle below. */}
      {isStaff ? (
        <div className="grid grid-cols-2 gap-2">
          <Link to="/shipments/new" className="block">
            <Button
              type="button"
              onClick={() => setTab("shipments")}
              className="w-full min-h-11 rounded-xl bg-brand text-brand-foreground hover:bg-brand/90 font-semibold text-sm shadow-sm"
            >
              <Plus className="mr-1 h-4 w-4" /> Нова поставка
            </Button>
          </Link>
          <Button
            type="button"
            onClick={() => setTab(tab === "vehicles" ? "shipments" : "vehicles")}
            aria-pressed={tab === "vehicles"}
            className={cn(
              "w-full min-h-11 rounded-xl font-semibold text-sm shadow-sm",
              "bg-emerald-600 text-white hover:bg-emerald-700",
              tab === "vehicles" && "ring-2 ring-emerald-300",
            )}
          >
            Відкриті авто
          </Button>
        </div>
      ) : (
        <Link to="/shipments/new" className="block">
          <Button className="w-full min-h-11 rounded-xl bg-brand text-brand-foreground hover:bg-brand/90 font-semibold text-sm shadow-sm">
            <Plus className="mr-1 h-4 w-4" /> Нова поставка
          </Button>
        </Link>
      )}

      {tab === "vehicles" && isStaff ? (
        <OpenVehiclesBlock currentManagerId={currentManagerId} />
      ) : (
        <>
          {/* Control card: supplier + supplier-country filters (admin), Active/Unloaded toggle. */}
          <div className="rounded-2xl border border-border bg-card p-3 space-y-3 shadow-sm">
            {isAdmin && (
              <div className="grid grid-cols-2 gap-2">
                <CompactFilterSelect
                  value={supplierFilter}
                  onChange={setSupplierFilter}
                  options={supplierOptions}
                  allValue="all"
                  allLabel="Усі постачальники"
                  placeholder="Постачальник"
                />
                <CompactFilterSelect
                  value={countryFilter}
                  onChange={setCountryFilter}
                  options={countryOptions}
                  allValue="all"
                  allLabel="Усі країни"
                  placeholder="Країна постачальника"
                />
              </div>
            )}
            <BucketToggle value={board} onChange={setBoard} />
          </div>

          {!filtered.length ? (
            shipmentsQuery.isFetching || !shipmentsQuery.isSuccess ? (
              <p className="text-sm text-muted-foreground">Оновлення даних…</p>
            ) : (
              <EmptyState title="Поставок немає" />
            )
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-border bg-card divide-y divide-border shadow-sm">
              {filtered.map((s) => {
                const isOwner = isOwnedShipment(s, user?.id, currentManagerId);
                const supplierName = (s as { suppliers?: { name?: string | null } | null }).suppliers?.name ?? "—";
                const supplierCountry =
                  toUaCountry((s as { suppliers?: { country?: string | null } | null }).suppliers?.country ?? "") || "—";
                return (
                  <ShipmentRow
                    key={s.id}
                    shipmentId={s.id}
                    code={s.code}
                    status={s.status}
                    eta={s.eta}
                    etd={(s as { loading_date?: string | null }).loading_date ?? null}
                    pallets={s.fact}
                    netKg={s.netKg}
                    dist={s.dist}
                    remaining={s.remaining}
                    supplierName={supplierName}
                    supplierCountry={supplierCountry}
                    vehicle={s.tractor_plate ?? s.vehicle_plate ?? null}
                    driver={s.driver_name ?? null}
                    address={s.loading_address ?? null}
                    reference={s.loading_reference ?? null}
                    temperature={(s as { temperature_mode?: string | null }).temperature_mode ?? null}
                    showAdminMenu={isOwner}
                    onChanged={() => qc.invalidateQueries({ queryKey: ["shipments-list"] })}
                    importManagerId={(s as { import_manager_id?: string | null }).import_manager_id ?? null}
                  />
                );
              })}
            </ul>
          )}
        </>
      )}

    </div>
  );
}

function ShipmentRow({
  shipmentId,
  code,
  status,
  eta,
  etd,
  pallets,
  netKg,
  dist,
  remaining,
  supplierName,
  supplierCountry,
  vehicle,
  driver,
  address,
  reference,
  temperature,
  showAdminMenu,
  onChanged,
  importManagerId,
}: {
  shipmentId: string;
  code: string;
  status: string;
  eta: string | null;
  etd: string | null;
  pallets: number;
  netKg: number;
  dist: number;
  remaining: number;
  supplierName: string;
  supplierCountry: string;
  vehicle: string | null;
  driver: string | null;
  address: string | null;
  reference: string | null;
  temperature: string | null;
  showAdminMenu: boolean;
  onChanged: () => void;
  importManagerId: string | null;
}) {
  // Hidden ShipmentQuickView trigger — its <button> opens the existing
  // dialog. We forward outer row clicks to it so the whole card is
  // tappable without modifying the shared ShipmentQuickView component.
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const openQuickView = () => {
    const btn = triggerRef.current?.querySelector("button");
    btn?.click();
  };

  // Distribution marker (red / amber / green) — uses already-computed fact/dist/remaining.
  let distTone: "muted" | "destructive" | "warning" | "success" = "muted";
  let distLabel = "—";
  if (pallets > 0 && remaining === 0 && dist > 0) {
    distTone = "success";
    distLabel = "Розподілено";
  } else if (dist > 0 && remaining > 0) {
    distTone = "warning";
    distLabel = "Дорозподіл";
  } else if (pallets > 0 && dist === 0) {
    distTone = "destructive";
    distLabel = "Не розпод.";
  }
  const distToneClass = {
    success: "bg-success/15 text-success border-success/30",
    warning: "bg-warning/15 text-warning border-warning/30",
    destructive: "bg-destructive/15 text-destructive border-destructive/30",
    muted: "bg-muted text-muted-foreground border-border",
  }[distTone];

  const etaStr = fmtEtaShort(eta);
  const etdStr = etd ? fmtEtaShort(etd) : "—";

  return (
    <li data-focus-id={`ship:${shipmentId} mgr:${importManagerId ?? ""}`} className="relative">
      <div ref={triggerRef} className="hidden">
        <ShipmentQuickView shipmentId={shipmentId} code={code} />
      </div>

      <button
        type="button"
        onClick={openQuickView}
        className="block w-full text-left p-3 transition-colors hover:bg-accent/30 active:bg-accent/40"
      >
        {/* Line 1: code · supplier · supplier country  |  pallets [+ admin menu] */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 text-sm leading-snug">
            <span className="font-bold text-foreground">{code}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="text-foreground">{supplierName}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="text-muted-foreground">{supplierCountry}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1 pl-2">
            <span className="text-sm font-bold tabular-nums text-foreground">{pallets}п</span>
            {showAdminMenu && (
              <RowActions
                shipmentId={shipmentId}
                code={code}
                onChanged={onChanged}
              />
            )}
          </div>
        </div>

        {/* Line 2: ETD / ETA — labels blue, dates dark. Net/gross deferred. */}
        <div className="mt-1 text-xs tabular-nums">
          <span className="font-semibold text-sky-600 dark:text-sky-300">ETD</span>
          <span className="text-foreground"> {etdStr}</span>
          <span className="text-foreground"> / </span>
          <span className="font-semibold text-sky-600 dark:text-sky-300">ETA</span>
          <span className="text-foreground"> {etaStr}</span>
        </div>

        {/* Line 3: distribution marker + logistics/documents marker */}
        <div className="mt-2 flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
              distToneClass,
            )}
          >
            {distLabel}
          </span>
          <LogisticsIndicator
            vehicle={vehicle}
            driver={driver}
            address={address}
            reference={reference}
            temperature={temperature}
          />
        </div>
      </button>
    </li>
  );
}

function LogisticsIndicator({
  vehicle,
  driver,
  address,
  reference,
  temperature,
}: {
  vehicle: string | null;
  driver: string | null;
  address: string | null;
  reference: string | null;
  temperature: string | null;
}) {
  const items = [
    { label: "Авто", value: vehicle },
    { label: "Водій", value: driver },
    { label: "Адреса завантаження", value: address },
    { label: "Номер завантаження", value: reference },
    { label: "Температура", value: temperature },
  ];
  const done = items.filter((i) => !!i.value && String(i.value).trim() !== "").length;
  const total = items.length;
  const missing = total - done;
  const tone =
    done === total
      ? "bg-success/15 text-success border-success/30"
      : done === 0
        ? "bg-destructive/15 text-destructive border-destructive/30"
        : "bg-warning/15 text-warning border-warning/30";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold tabular-nums",
            tone,
          )}
        >
          <span>Логістика</span>
          <span className="tabular-nums">{done}/{missing}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" className="w-56 p-2">
        <ul className="space-y-1 text-xs">
          {items.map((i) => {
            const ok = !!i.value && String(i.value).trim() !== "";
            return (
              <li key={i.label} className="flex items-center gap-2">
                {ok ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <X className="h-3.5 w-3.5 text-destructive" />
                )}
                <span className={cn(ok ? "text-foreground" : "text-muted-foreground")}>
                  {i.label}
                </span>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function RowActions({ shipmentId, code, onChanged }: { shipmentId: string; code: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const cancelShipmentFn = useServerFn(cancelShipment);
  const qc = useQueryClient();
  const onDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    if (!confirm(`Скасувати поставку ${code}? Поставка зникне з активних і пов'язані обіцянки потраплять в Архів.`)) return;
    try {
      const res = await cancelShipmentFn({ data: { shipmentId } });
      toast.success(
        res.alreadyCancelled
          ? "Поставку вже було скасовано"
          : `Поставку скасовано${res.archived > 0 ? ` (в архів: ${res.archived})` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["shipments-list"] });
      qc.invalidateQueries({ queryKey: ["open-vehicles-list"] });
      qc.invalidateQueries({ queryKey: ["manager-offers"] });
      qc.invalidateQueries({ queryKey: ["tropik-archive"] });
      qc.invalidateQueries({ queryKey: ["shipment-quickview", shipmentId] });
      onChanged();
    } catch (err) {
      const msg = err instanceof Response ? await err.text() : (err as Error)?.message ?? "Помилка";
      toast.error(msg || "Не вдалося скасувати поставку");
    }
  };

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Дії"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-36 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
          <button
            type="button"
            onClick={onDelete}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> Видалити
          </button>
        </div>
      )}
    </div>
  );
}

type OpenVehicleRow = {
  id: string;
  code: string;
  country: string;
  loading_date: string | null;
  eta: string | null;
  total_pallets: number;
  total_weight_kg: number;
  created_by: string | null;
  shipments: {
    id: string;
    import_manager_id: string | null;
    created_by?: string | null;
    suppliers: { name: string | null } | null;
    shipment_items?: Array<{
      pallet_count: number | null;
      pallet_weight: number | null;
      net_weight_kg: number | null;
      gross_weight_kg: number | null;
    }> | null;
  }[] | null;
};

// P-Fix — derive vehicle pallets/gross from shipment_items so the open-vehicles
// card reflects the same gross-based numbers the products editor uses. The DB
// column vehicles.total_weight_kg is updated by recompute_vehicle_totals_for()
// as SUM(pallet_count * pallet_weight) (legacy net-ish) and otherwise mis-renders
// e.g. 19000/21500 + залиш 2500 for a 19п/20710кг gross load.
function aggregateVehicleFromItems(v: OpenVehicleRow): { pallets: number; gross: number } {
  let pallets = 0;
  let gross = 0;
  let sawAny = false;
  for (const s of v.shipments ?? []) {
    for (const it of s.shipment_items ?? []) {
      sawAny = true;
      const pc = Number(it.pallet_count ?? 0);
      pallets += pc;
      const g = Number(it.gross_weight_kg ?? 0);
      if (g > 0) {
        gross += g;
      } else {
        const net = Number(it.net_weight_kg ?? 0);
        const pw = Number(it.pallet_weight ?? 0);
        gross += net > 0 ? net : pc * pw;
      }
    }
  }
  if (!sawAny) {
    return { pallets: Number(v.total_pallets ?? 0), gross: Number(v.total_weight_kg ?? 0) };
  }
  return { pallets, gross };
}

function OpenVehiclesBlock({ currentManagerId }: { currentManagerId?: string | null }) {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole(["super_admin", "admin"]);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ["open-vehicles-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles" as never)
        .select("id,code,country,loading_date,eta,total_pallets,total_weight_kg,created_by, shipments(id,import_manager_id,created_by,suppliers(name),shipment_items(pallet_count,pallet_weight,net_weight_kg,gross_weight_kg))")
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (error) return [] as OpenVehicleRow[];
      return (data ?? []) as unknown as OpenVehicleRow[];
    },
  });

  // Build 2E-B — active reserves for the currently listed open vehicles.
  // Keyed by the vehicle id set so realtime + list refetch keeps them
  // in sync. Read-only; writes go through RPC wrappers.
  const openVehicleIds = (data ?? []).map((v) => v.id);
  const reservesKey = openVehicleIds.slice().sort().join(",");
  const { data: reserves, refetch: refetchReserves } = useQuery({
    queryKey: ["vehicle-reserves-open", reservesKey],
    enabled: openVehicleIds.length > 0,
    queryFn: () => fetchActiveReservesByVehicle(openVehicleIds),
  });
  const reservesByVehicle = new Map<string, ActiveReserve[]>();
  for (const r of reserves ?? []) {
    const arr = reservesByVehicle.get(r.vehicle_id) ?? [];
    arr.push(r);
    reservesByVehicle.set(r.vehicle_id, arr);
  }

  const closeVehicle = async (id: string) => {
    // Validate all shipment items in this vehicle have required fields
    const { data: ships } = await supabase
      .from("shipments" as never)
      .select("id")
      .eq("vehicle_id", id);
    const shipIds = ((ships ?? []) as { id: string }[]).map((s) => s.id);
    if (shipIds.length > 0) {
      const { data: items } = await supabase
        .from("shipment_items" as never)
        .select("product_name,origin_country,pallet_count,pallet_weight,net_weight_kg,unit_price")
        .in("shipment_id", shipIds);
      const rows = (items ?? []) as Array<{ product_name: string | null; origin_country: string | null; pallet_count: number | null; pallet_weight: number | null; net_weight_kg: number | null; unit_price: number | null }>;
      const bad = rows.filter((r) => {
        const pc = Number(r.pallet_count ?? 0);
        const pw = Number(r.pallet_weight ?? 0);
        const net = Number(r.net_weight_kg ?? 0);
        const lineWeight = net > 0 ? net : pc * pw; // net first, legacy fallback
        return pc > 0 && (
          !(r.product_name ?? "").trim() ||
          (r.product_name ?? "") === "Новий товар" ||
          !(r.origin_country ?? "").trim() ||
          lineWeight <= 0 ||
          !r.unit_price || Number(r.unit_price) <= 0
        );
      }).length;
      if (bad > 0) {
        toast.error(`Не можна закрити: ${bad} поз. з незаповн. полями (товар / країна / палети / вага / ціна)`);
        return;
      }
    }
    const { error } = await supabase
      .from("vehicles" as never)
      .update({ status: "closed", closed_at: new Date().toISOString() } as never)
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Авто закрите");

    // Build 2E-B — after successful vehicle close, close any lingering
    // active reserves on this vehicle. RPC uses SECURITY DEFINER and
    // requires vehicle.status='closed', which is now guaranteed. Failure
    // is a warning only — we do NOT roll back the vehicle close.
    try {
      const rr = await closeVehicleReserves(id);
      if (!rr.ok) {
        toast.warning(`Авто закрите, але резерви не закриті: ${rr.reason}`);
      }
    } catch (e) {
      toast.warning(
        `Авто закрите, але резерви не закриті: ${e instanceof Error ? e.message : "невідома помилка"}`,
      );
    }

    // Vehicle-level action: invalidate all views that depend on vehicle
    // status so the shared vehicle (parent + child shipments) leaves
    // "Не закриті авто" and appears on the shipments board in one refresh.
    await Promise.all([
      qc.refetchQueries({ queryKey: ["open-vehicles-list"], type: "all" }),
      qc.refetchQueries({ queryKey: ["shipments-list"], type: "all" }),
      qc.refetchQueries({ queryKey: ["open-vehicles"], type: "all" }),
      qc.refetchQueries({ queryKey: ["vehicles-open"], type: "all" }),
      qc.refetchQueries({ queryKey: ["vehicles-list"], type: "all" }),
      qc.refetchQueries({ queryKey: ["logistics-board"], type: "all" }),
      qc.refetchQueries({ queryKey: ["vehicle-reserves-open"], type: "all" }),
    ]);
    refetch();
  };

  useFocusHighlight([data]);

  // Capacity constants (kept in sync with products editor MAX_PALLETS / MAX_WEIGHT_KG).
  const CAP_PALLETS = 26;
  const CAP_GROSS_KG = 21500;
  const MIN_FREE_GROSS_KG = 500;

  // Top-up availability rule for OTHER managers (own vehicles always visible / clickable).
  // Closed for top-up if any: freePallets<=0, freeGross<500, or freeGross<avgLoadedPalletGross.
  const computeTopUp = (pallets: number, weight: number) => {
    const freePallets = Math.max(0, CAP_PALLETS - pallets);
    const freeGross = Math.max(0, CAP_GROSS_KG - weight);
    const avgPalletGross = pallets > 0 ? weight / pallets : null;
    const available =
      freePallets > 0 &&
      freeGross >= MIN_FREE_GROSS_KG &&
      (avgPalletGross == null || freeGross >= avgPalletGross);
    return { freePallets, freeGross, avgPalletGross, available };
  };

  // For non-admin managers:
  //  - hide zero-shipment orphans created by others (own zero-shipment still shown for cleanup);
  //  - hide other managers' vehicles with no usable free capacity for top-up.
  const visible = (data ?? []).filter((v) => {
    if (isAdmin) return true;
    const hasShipments = (v.shipments ?? []).length > 0;
    const ownShipment = (v.shipments ?? []).find((s) => isOwnedShipment(s, user?.id, currentManagerId));
    const isOwnVehicle = !!ownShipment || v.created_by === user?.id;
    // Build 2E-B — surface any vehicle where this user owns an active
    // reserve so they can release it, even without their own shipment.
    const hasOwnReserve = (reservesByVehicle.get(v.id) ?? []).some(
      (r) => r.owner_user_id === user?.id,
    );
    if (isOwnVehicle || hasOwnReserve) return true;
    if (!hasShipments) return false;
    const agg = aggregateVehicleFromItems(v);
    const rs = reservesByVehicle.get(v.id) ?? [];
    const resPal = rs.reduce((a, r) => a + Number(r.pallets ?? 0), 0);
    const resGross = rs.reduce((a, r) => a + Number(r.gross_kg ?? 0), 0);
    const { available } = computeTopUp(agg.pallets + resPal, agg.gross + resGross);
    return available;
  });

  return (
    <SectionCard title={`🚛 Відкриті авто (${visible.length})`}>
      {!visible.length ? (
        <EmptyState title="Відкритих авто немає" />
      ) : (
      <div className="grid gap-2 sm:grid-cols-2">
        {visible.map((v) => {
          const ownShipment = (v.shipments ?? []).find((s) => isOwnedShipment(s, user?.id, currentManagerId));
          const isOwnVehicle = !!ownShipment || v.created_by === user?.id;
          const redactCommercial = !isAdmin && !isOwnVehicle;
          const sups = redactCommercial
            ? []
            : ((v.shipments ?? []).map((s) => s.suppliers?.name).filter(Boolean) as string[]);
          // P-Fix — gross-based aggregation from items, see aggregateVehicleFromItems().
          const _agg = aggregateVehicleFromItems(v);
          const pallets = _agg.pallets;
          const weight = _agg.gross;
          const palletsPct = Math.min(100, (pallets / CAP_PALLETS) * 100);
          const weightPct = Math.min(100, (weight / CAP_GROSS_KG) * 100);
          const { available: topUpAvailable } = computeTopUp(pallets, weight);
          // Own vehicle: owner can always add. Other manager's: only if top-up rule passes.
          const hasFreeCapacity = isOwnVehicle ? pallets < CAP_PALLETS && weight < CAP_GROSS_KG : topUpAvailable;
          const handleCardClick = () => {
            if (ownShipment) {
              navigate({ to: "/shipments/$id/products", params: { id: ownShipment.id } });
            } else {
              if (!hasFreeCapacity && !isAdmin) return;
              navigate({ to: "/shipments/new", search: { vehicleId: v.id } });
            }
          };
          return (
            <VehicleCard
              key={v.id}
              v={v}
              sups={sups}
              pallets={pallets}
              weight={weight}
              palletsPct={palletsPct}
              weightPct={weightPct}
              ownShipment={ownShipment}
              isAdmin={isAdmin}
              redactCommercial={redactCommercial}
              hasFreeCapacity={hasFreeCapacity}
              onCardClick={handleCardClick}
              onAddSupplier={() => navigate({ to: "/shipments/new", search: { vehicleId: v.id } })}
              onClose={() => closeVehicle(v.id)}
              onDeleted={() => refetch()}
            />
          );
        })}
      </div>
      )}
    </SectionCard>
  );
}

function VehicleCard({
  v, sups, pallets, weight, palletsPct, weightPct, ownShipment, isAdmin,
  redactCommercial, hasFreeCapacity,
  onCardClick, onAddSupplier, onClose, onDeleted,
}: {
  v: OpenVehicleRow;
  sups: string[];
  pallets: number;
  weight: number;
  palletsPct: number;
  weightPct: number;
  ownShipment: { id: string; import_manager_id: string | null } | undefined;
  isAdmin: boolean;
  redactCommercial: boolean;
  hasFreeCapacity: boolean;
  onCardClick: () => void;
  onAddSupplier: () => void;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const DELETE_REVEAL = 144;
  const SWIPE_ACTIVATION = 6;
  const SWIPE_OPEN_THRESHOLD = 36;
  const SWIPE_CLOSE_THRESHOLD = 18;
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const swipeOffsetRef = useRef(0);
  const gesture = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    startOffset: number;
    dragging: boolean;
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    startOffset: 0,
    dragging: false,
  });
  const suppressClick = useRef(false);

  const setSwipePosition = (nextOffset: number) => {
    swipeOffsetRef.current = nextOffset;
    setSwipeOffset(nextOffset);
  };

  const closeDelete = () => {
    setDeleteOpen(false);
    setSwipePosition(0);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ownShipment) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select")) return;
    gesture.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startOffset: deleteOpen ? -DELETE_REVEAL : 0,
      dragging: false,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const resetGesture = () => {
    gesture.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      startOffset: 0,
      dragging: false,
    };
    setDragging(false);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!ownShipment) return;
    if (gesture.current.pointerId !== e.pointerId) return;

    const dx = e.clientX - gesture.current.startX;
    const dy = e.clientY - gesture.current.startY;

    if (!gesture.current.dragging) {
      if (Math.abs(dx) < SWIPE_ACTIVATION && Math.abs(dy) < SWIPE_ACTIVATION) return;
      if (Math.abs(dy) > Math.abs(dx) * 1.15) {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        resetGesture();
        return;
      }
      gesture.current.dragging = true;
      setDragging(true);
      suppressClick.current = true;
    }

    e.preventDefault();
    const nextOffset = Math.max(-DELETE_REVEAL, Math.min(0, gesture.current.startOffset + dx));
    setSwipePosition(nextOffset);
  };

  const handlePointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (gesture.current.pointerId !== e.pointerId) return;

    e.currentTarget.releasePointerCapture?.(e.pointerId);

    if (gesture.current.dragging) {
      const finalOffset = swipeOffsetRef.current;
      const shouldOpen = deleteOpen
        ? finalOffset <= -SWIPE_CLOSE_THRESHOLD
        : finalOffset <= -SWIPE_OPEN_THRESHOLD;
      setDeleteOpen(shouldOpen);
      setSwipePosition(shouldOpen ? -DELETE_REVEAL : 0);
      suppressClick.current = true;
    }

    resetGesture();
  };

  const handleCardClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (deleteOpen) {
      closeDelete();
      return;
    }
    onCardClick();
  };

  const cancelShipmentFn = useServerFn(cancelShipment);
  const qc = useQueryClient();
  const doDelete = async () => {
    if (!ownShipment) return;
    setConfirmOpen(false);
    closeDelete();
    try {
      const res = await cancelShipmentFn({ data: { shipmentId: ownShipment.id } });
      toast.success(
        res.alreadyCancelled
          ? "Поставку вже було скасовано"
          : `Поставку скасовано${res.archived > 0 ? ` (в архів: ${res.archived})` : ""}`,
      );
      qc.invalidateQueries({ queryKey: ["shipments-list"] });
      qc.invalidateQueries({ queryKey: ["open-vehicles-list"] });
      qc.invalidateQueries({ queryKey: ["manager-offers"] });
      qc.invalidateQueries({ queryKey: ["tropik-archive"] });
      qc.invalidateQueries({ queryKey: ["shipment-quickview", ownShipment.id] });
      onDeleted();
    } catch (err) {
      const msg = err instanceof Response ? await err.text() : (err as Error)?.message ?? "Помилка";
      toast.error(msg || "Не вдалося скасувати поставку");
    }
  };

  return (
    <>
      <div
        data-focus-id={`v:${v.id} ${(v.shipments ?? []).map((s) => `mgr:${s.import_manager_id ?? ""}`).join(" ")}`}
        className="relative overflow-hidden rounded-xl border border-border bg-card hover:border-brand/40"
      >
        {ownShipment && (
          <div className="absolute inset-y-0 right-0 z-0 flex w-36 items-stretch justify-end">
            <div className="flex w-36 items-stretch">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeDelete();
                }}
                className="flex w-11 items-center justify-center bg-secondary text-secondary-foreground transition-opacity hover:bg-secondary/80"
                aria-label="Скасувати свайп"
              >
                <X className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmOpen(true);
                }}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1 bg-destructive text-destructive-foreground transition-opacity",
                  deleteOpen ? "opacity-100" : "opacity-80",
                )}
                aria-label="Видалити поставку"
              >
                <Trash2 className="h-5 w-5" />
                <span className="text-[11px] font-semibold">Видалити</span>
              </button>
            </div>
          </div>
        )}

        <div
          role="button"
          tabIndex={0}
          onClick={handleCardClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              if (deleteOpen) {
                closeDelete();
                return;
              }
              onCardClick();
            }
            if (e.key === "Escape" && deleteOpen) {
              e.preventDefault();
              closeDelete();
            }
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          style={{ transform: `translateX(${swipeOffset}px)`, touchAction: ownShipment ? "pan-y" : "auto" }}
          className={cn(
            "relative z-10 cursor-pointer select-none rounded-xl bg-card p-2 active:scale-[0.99]",
            dragging ? "transition-none" : "transition-transform duration-[260ms] ease-out",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <div className="text-sm font-bold text-brand leading-tight">{v.code}</div>
                {redactCommercial && (
                  <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground">
                    довантаж.
                  </span>
                )}
              </div>
              <div className="truncate text-[10px] text-muted-foreground leading-tight">{toUaCountry(v.country)} · ETA {v.eta ?? "—"}</div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 px-2 text-[11px]"
                disabled={redactCommercial && !hasFreeCapacity}
                title={redactCommercial && !hasFreeCapacity ? "Авто заповнене — довантаження неможливе" : undefined}
                onClick={(e) => { e.stopPropagation(); onAddSupplier(); }}
              >
                + Додати
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-[11px]"
                disabled={!isAdmin && !ownShipment}
                title={!isAdmin && !ownShipment ? "Закрити може лише адмін або менеджер, що додав свій товар" : undefined}
                onClick={(e) => { e.stopPropagation(); onClose(); }}
              >
                Закрити
              </Button>
            </div>
          </div>
          {sups.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {sups.map((s, i) => (
                <span key={i} className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px]">{s}</span>
              ))}
            </div>
          )}
          <div className="mt-1.5 space-y-1 text-[10px]">
            <div className="flex items-center justify-between">
              <span>Палети {pallets}/26</span>
              <span className="text-muted-foreground">залиш. {Math.max(0, 26 - pallets)}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-brand" style={{ width: `${palletsPct}%` }} />
            </div>
            <div className="flex items-center justify-between">
              <span>Вага {Math.round(weight)}/21500 кг</span>
              <span className="text-muted-foreground">залиш. {Math.max(0, 21500 - Math.round(weight))} кг</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-secondary">
              <div className="h-full bg-brand" style={{ width: `${weightPct}%` }} />
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Видалити поставку?</AlertDialogTitle>
            <AlertDialogDescription>
              Поставка з авто {v.code} буде видалена без можливості відновлення.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Ні</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void doDelete();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Так
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

