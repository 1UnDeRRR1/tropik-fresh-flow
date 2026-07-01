// Build 2A — single-screen Create Shipment shell (local state only).
//
// Hard rules for this build:
//   - ZERO operational DB writes before final "Створити" (which is disabled
//     in Build 2A). No vehicle/shipment/items/positions/offer links/FIFO.
//   - DraftRow[] in local state is the only source of truth for products.
//   - Reads are allowed: suppliers, countries, products dictionary,
//     manager_offers (for fromOffer prefill), customs/FX/open vehicles via
//     existing hooks, sequence-number preview.
//   - Назад just navigates back; cleanup is intentionally NOT invoked here
//     because nothing was written.
//
// Header form (mode toggle / supplier / country / vehicle / dates / code
// preview) is preserved verbatim from the previous flow. Only the
// submit/insert path was replaced with local card state + sticky capacity
// bar. /shipments/$id/products is not touched.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Plus, Lock, ArrowLeft, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { StrictAutocompleteCard } from "@/components/shipments/StrictAutocompleteCard";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import {
  COUNTRIES as FALLBACK_COUNTRIES,
  COUNTRY_DAYS,
  calcArrivalDate,
  toDateInputValue,
} from "@/lib/arrival";
import { useCountryOptions } from "@/hooks/useCountryOptions";
import { useCountryAliases } from "@/hooks/useCountryAliases";
import { useCustomsCountries } from "@/hooks/useCustomsCountries";
import { toUaCountry, normalizeCountry } from "@/lib/countries";
import {
  getSupplierAlias,
  fetchNextVehicleSequence,
  fetchNextSupplierSequence,
  formatShipmentCode,
  formatVehicleCode,
  getCountryCode,
} from "@/lib/shipment-code";
import { StaffOnly } from "@/components/StaffOnly";
import { matchesWordStart } from "@/lib/compact-search";
import { resolveCountry } from "@/lib/country-search";
import { NewShipmentProductCard } from "@/components/shipments/NewShipmentProductCard";
import { StrictDatePicker } from "@/components/shipments/StrictDatePicker";
import { CreateScenarioDialog } from "@/components/shipments/CreateScenarioDialog";
import { ReserveInputDialog, type ReserveInput } from "@/components/shipments/ReserveInputDialog";
import { createVehicleReserve } from "@/lib/vehicle-reserves";
import { PickOpenVehicleDialog } from "@/components/shipments/PickOpenVehicleDialog";
import { triggerInvalidFeedback } from "@/lib/invalid-feedback";
import {
  emptyDraftRow,
  isKnownProductName,
  type DraftRow,
  type ProductRef,
} from "@/lib/shipment-row-engine";
import {
  createShipmentFlow,
  type CreateShipmentScenario,
} from "@/lib/create-shipment-orchestrator";

const VEHICLE_MAX_PALLETS = 26;
const VEHICLE_MAX_KG = 21500;

export const Route = createFileRoute("/_authenticated/shipments/new")({
  validateSearch: (search: Record<string, unknown>): { vehicleId?: string; fromOffer?: string } => ({
    vehicleId: typeof search.vehicleId === "string" ? search.vehicleId : undefined,
    fromOffer: typeof search.fromOffer === "string" ? search.fromOffer : undefined,
  }),
  component: () => <StaffOnly><NewShipment /></StaffOnly>,
});

type Mode = "new" | "existing";

type OpenVehicle = {
  id: string;
  code: string;
  country: string;
  country_code: string;
  loading_date: string | null;
  eta: string | null;
  total_pallets: number;
  total_weight_kg: number;
  created_by: string | null;
  shipments: {
    id: string;
    code: string | null;
    logistics_cost: number | null;
    logistics_cost_currency: string | null;
    logistics_cost_usd: number | null;
    created_by: string | null;
    suppliers: { name: string | null } | null;
    shipment_items: {
      id: string;
      product_name: string | null;
      variety: string | null;
      caliber: string | null;
      pallet_count: number | null;
      pallet_weight: number | null;
      net_weight_kg: number | null;
      gross_weight_kg: number | null;
    }[] | null;
  }[] | null;
};

// Build 2A.5 — cost/customs/FX/transport preview is rendered inside
// NewShipmentProductCard as a placeholder; full wiring lands in Build 2B.

function NewShipment() {
  const navigate = useNavigate();
  const { user, hasRole, loading } = useAuth();
  const isStaff = hasRole(["super_admin", "admin", "import_manager"]);
  const search = Route.useSearch();

  // Redirect non-staff to their dashboard
  useEffect(() => {
    if (!loading && !isStaff) {
      navigate({ to: "/dashboard/branch" });
    }
  }, [loading, isStaff, navigate]);

  // Tag <body> while the create screen is mounted so scoped CSS in
  // src/styles.css can re-skin portaled popovers/selects/calendars without
  // affecting any other screen. Pure visual scoping, no behavior change.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.classList.add("shipment-create-active");
    return () => { document.body.classList.remove("shipment-create-active"); };
  }, []);


  const [mode, setMode] = useState<Mode>(search.vehicleId ? "existing" : "new");
  const [vehicleId, setVehicleId] = useState<string>(search.vehicleId ?? "");
  const [country, setCountry] = useState<string>("");
  const [countryTouched, setCountryTouched] = useState(false);
  const [loadingDate, setLoadingDate] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [etaOverride, setEtaOverride] = useState<string>("");
  const [etaTouched, setEtaTouched] = useState(false);

  const [supplierInput, setSupplierInput] = useState("");
  const [countryInput, setCountryInput] = useState("");
  const countryOptions = useCountryOptions();
  const countryAliases = useCountryAliases();
  const [vehicleInput, setVehicleInput] = useState("");
  const [invalid, setInvalid] = useState<Set<string>>(() => new Set());
  const clearInvalid = (key: string) =>
    setInvalid((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });

  // ---------------------------------------------------------------------------
  // Build 2A — local draft state.
  // ---------------------------------------------------------------------------
  const [drafts, setDrafts] = useState<DraftRow[]>(() => [emptyDraftRow()]);
  // Build 2A.1 — local-only transport. NOT persisted in Build 2A.1; wired
  // into the commit payload in Build 2B.
  const [transportAmount, setTransportAmount] = useState<string>("");
  const [transportCurrency, setTransportCurrency] = useState<"EUR" | "USD">("EUR");

  // Build 2B-B-2 — scenario dialog + submit lock. No DB writes until the
  // user confirms a scenario in the dialog.
  const [scenarioOpen, setScenarioOpen] = useState(false);
  // Build 2D — picker dialog for "Створити та довантажити" from standalone
  // form. Opens when the user chooses the "and_topup" scenario tile.
  const [pickOpen, setPickOpen] = useState(false);
  // Build 2E-B — reserve dialog for "Створити з резервом" (standalone only).
  const [reserveOpen, setReserveOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const qc = useQueryClient();

  const resetLocalDraft = useCallback(() => {
    setMode(search.vehicleId ? "existing" : "new");
    setVehicleId(search.vehicleId ?? "");
    setCountry("");
    setCountryTouched(false);
    setLoadingDate("");
    setSupplierId("");
    setCode("");
    setEtaOverride("");
    setEtaTouched(false);
    setSupplierInput("");
    setCountryInput("");
    setVehicleInput("");
    setInvalid(new Set());
    setDrafts([emptyDraftRow()]);
    setTransportAmount("");
    setTransportCurrency("EUR");
    setScenarioOpen(false);
  }, [search.vehicleId]);

  const refreshShipmentLists = useCallback(async () => {
    // Force network refetch (not just invalidate) because the global
    // QueryClient sets refetchOnMount:false. Plain invalidate would only
    // mark inactive queries stale; after navigation /shipments would still
    // render the previous cache until realtime or a manual reload kicks in.
    await Promise.all([
      qc.refetchQueries({ queryKey: ["shipments-list"] }),
      qc.refetchQueries({ queryKey: ["open-vehicles-list"] }),
      qc.refetchQueries({ queryKey: ["shipments"] }),
      qc.refetchQueries({ queryKey: ["open-vehicles"] }),
      qc.refetchQueries({ queryKey: ["logistics-board"] }),
      // Build 2E-B — refresh reserve-aware lists.
      qc.refetchQueries({ queryKey: ["vehicle-reserves-open"] }),
      qc.refetchQueries({ queryKey: ["pick-open-vehicles"] }),
      qc.refetchQueries({ queryKey: ["pick-open-vehicles-reserves"] }),
    ]);
  }, [qc]);


  const leaveCreateFormAfterSuccess = useCallback(
    async (target: { closed: boolean }) => {
      await refreshShipmentLists();
      resetLocalDraft();
      navigate({
        to: "/shipments",
        search: target.closed ? { tab: "shipments" } : { tab: "vehicles" },
        replace: true,
      });
    },
    [navigate, refreshShipmentLists, resetLocalDraft],
  );

  const patchDraft = useCallback((localId: string, patch: Partial<DraftRow>) => {
    setDrafts((prev) => prev.map((d) => (d.localId === localId ? { ...d, ...patch } : d)));
  }, []);
  const removeDraft = useCallback((localId: string) => {
    setDrafts((prev) => {
      const next = prev.filter((d) => d.localId !== localId);
      return next.length ? next : [emptyDraftRow()];
    });
  }, []);
  const addManualDraft = () => setDrafts((prev) => [...prev, emptyDraftRow()]);
  const cloneLastDraft = () => {
    setDrafts((prev) => {
      if (prev.length === 0) return [emptyDraftRow()];
      const last = prev[prev.length - 1];
      const fresh = emptyDraftRow();
      const copy: DraftRow = {
        ...last,
        localId: fresh.localId,
        dbId: null,
        source_offer_id: null,
        source_position_id: null,
        source_offer_freight_amount: null,
        source_offer_freight_currency: null,
      };
      return [...prev, copy];
    });
  };

  const { data: managerProfiles } = useQuery({
    queryKey: ["manager-profiles", user?.id],
    enabled: !loading && !!user && isStaff,
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id,full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-select", user?.id],
    enabled: !loading && !!user && isStaff,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("suppliers")
        .select("id,name,country,code_base,alias,iso3,import_manager_id")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Products dictionary — needed by ShipmentProductCard's product autocomplete.
  const { data: productsList } = useQuery({
    queryKey: ["products-dict-new-shipment"],
    enabled: !loading && !!user && isStaff,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [dict, varieties] = await Promise.all([
        supabase.from("product_dictionary").select("product_name_ua").order("product_name_ua"),
        supabase.from("product_varieties").select("product_name_ua").range(0, 1999),
      ]);
      const merged = new Map<string, ProductRef>();
      const collect = (rows: { product_name_ua: string | null }[] | null | undefined) => {
        (rows ?? []).forEach((r) => {
          const name = (r.product_name_ua ?? "").trim();
          if (!name) return;
          const key = name.toLowerCase();
          if (!merged.has(key)) merged.set(key, { name });
        });
      };
      collect(dict.data as { product_name_ua: string | null }[] | null);
      collect(varieties.data as { product_name_ua: string | null }[] | null);
      return Array.from(merged.values());
    },
  });
  const products: ProductRef[] = productsList ?? [];

  const { data: openVehicles } = useQuery({
    queryKey: ["open-vehicles", user?.id, country],
    enabled: !loading && !!user && isStaff,
    refetchOnMount: "always",
    staleTime: 0,
    queryFn: async () => {
      let q = supabase
        .from("vehicles" as never)
        .select(
          "id,code,country,country_code,loading_date,eta,total_pallets,total_weight_kg,created_by,shipments(id,code,logistics_cost,logistics_cost_currency,logistics_cost_usd,created_by,suppliers(name),shipment_items(id,product_name,variety,caliber,pallet_count,pallet_weight,net_weight_kg,gross_weight_kg))",
        )
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (country) q = q.eq("country", country);
      const { data, error } = await q;
      if (error) return [] as OpenVehicle[];
      return (data ?? []) as unknown as OpenVehicle[];
    },
  });

  // Realtime: refresh open-vehicles list when vehicles or shipments change.
  useEffect(() => {
    if (!user || !isStaff) return;
    const channel = supabase
      .channel("open-vehicles-watch")
      .on("postgres_changes", { event: "*", schema: "public", table: "vehicles" }, () => {
        qc.invalidateQueries({ queryKey: ["open-vehicles"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "shipment_items" }, () => {
        qc.invalidateQueries({ queryKey: ["open-vehicles"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "shipments" }, () => {
        qc.invalidateQueries({ queryKey: ["open-vehicles"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, isStaff, qc]);

  const selectedSupplier = useMemo(
    () => suppliers?.find((s) => s.id === supplierId) ?? null,
    [suppliers, supplierId],
  );

  const selectedVehicle = useMemo(
    () => openVehicles?.find((v) => v.id === vehicleId) ?? null,
    [openVehicles, vehicleId],
  );

  const profileNameById = useMemo(
    () => new Map((managerProfiles ?? []).map((profile) => [profile.id, profile.full_name || "Менеджер"])),
    [managerProfiles],
  );
  const selectedVehicleOwnerName = selectedVehicle?.created_by
    ? profileNameById.get(selectedVehicle.created_by) ?? "Власник авто"
    : "Власник авто";

  // Build 2A.10 — Країна завантаження must use the SAME source as the
  // product Походження field: countries that exist in customs_reference
  // (intersected with canonical countries.name + aliases). The supplier
  // country source is intentionally NOT used here so the loading-country
  // assortment matches the product-origin list 1:1.
  const customsCountriesRaw = useCustomsCountries();
  const countryChoices = useMemo(() => {
    const base = (countryOptions.length ? countryOptions : FALLBACK_COUNTRIES).filter(Boolean);
    const byLc = new Map(base.map((c) => [c.toLowerCase(), c]));
    const out = new Set<string>();
    for (const raw of customsCountriesRaw) {
      const lc = raw.trim().toLowerCase();
      if (!lc) continue;
      const direct = byLc.get(lc);
      if (direct) { out.add(direct); continue; }
      const aliased = countryAliases[lc];
      if (aliased) {
        const hit = byLc.get(aliased.toLowerCase());
        if (hit) out.add(hit);
      }
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b, "uk"));
  }, [countryOptions, customsCountriesRaw, countryAliases]);
  const supplierItems = useMemo(
    () =>
      (suppliers ?? []).map((supplier) => ({
        ...supplier,
        label: supplier.name,
        searchStrings: [supplier.name, supplier.alias ?? "", toUaCountry(supplier.country ?? "")].filter(Boolean),
      })),
    [suppliers],
  );
  const countryItems = useMemo(
    () =>
      countryChoices.map((item) => ({
        label: item,
        searchStrings: [
          item,
          ...Object.entries(countryAliases)
            .filter(([, canonical]) => canonical.toLowerCase() === item.toLowerCase())
            .map(([alias]) => alias),
        ].filter(Boolean),
      })),
    [countryAliases, countryChoices],
  );
  const vehicleItems = useMemo(
    () =>
      (openVehicles ?? []).map((vehicle) => {
        const suppliersText = (vehicle.shipments ?? [])
          .map((shipment) => shipment.suppliers?.name ?? "")
          .filter(Boolean)
          .join(", ");
        return {
          ...vehicle,
          label: `${vehicle.code} · ${vehicle.country}`,
          suppliersText,
          searchStrings: [vehicle.code, vehicle.country, suppliersText].filter(Boolean),
        };
      }),
    [openVehicles],
  );

  const blurActiveElement = useCallback(() => {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }, []);

  useEffect(() => {
    setSupplierInput(selectedSupplier?.name ?? "");
  }, [selectedSupplier?.id, selectedSupplier?.name]);

  useEffect(() => {
    setCountryInput(country);
  }, [country]);

  useEffect(() => {
    setVehicleInput(selectedVehicle ? `${selectedVehicle.code} · ${selectedVehicle.country}` : "");
  }, [selectedVehicle?.id, selectedVehicle?.code, selectedVehicle?.country]);

  const resolveSupplierFromInput = useCallback(
    (raw: string) => {
      const q = raw.trim().toLowerCase();
      if (!q) return null;
      const direct = supplierItems.find((item) => item.name.trim().toLowerCase() === q);
      if (direct) return direct;
      const alias = supplierItems.find((item) => (item.alias ?? "").trim().toLowerCase() === q);
      if (alias) return alias;
      const prefix = supplierItems.filter((item) =>
        item.searchStrings.some((candidate) => matchesWordStart(candidate, q)),
      );
      return prefix.length === 1 ? prefix[0] : null;
    },
    [supplierItems],
  );

  const resolveVehicleFromInput = useCallback(
    (raw: string) => {
      const q = raw.trim().toLowerCase();
      if (!q) return null;
      const direct = vehicleItems.find(
        (item) => item.label.toLowerCase() === q || item.code.toLowerCase() === q,
      );
      if (direct) return direct;
      const prefix = vehicleItems.filter((item) =>
        item.searchStrings.some((candidate) => matchesWordStart(candidate, q)),
      );
      return prefix.length === 1 ? prefix[0] : null;
    },
    [vehicleItems],
  );

  // When supplier picked: auto-fill country if user hasn't touched it (new vehicle only).
  useEffect(() => {
    if (mode !== "new") return;
    if (countryTouched) return;
    if (!selectedSupplier?.country) return;
    const ua = toUaCountry(selectedSupplier.country);
    if (ua && ua !== country) setCountry(ua);
  }, [selectedSupplier, mode, countryTouched, country]);

  const days = country ? COUNTRY_DAYS[country] ?? 0 : 0;
  const autoEta = useMemo(() => {
    if (mode === "existing" && selectedVehicle?.eta) return selectedVehicle.eta;
    if (!loadingDate || !country || !days) return "";
    return toDateInputValue(calcArrivalDate(loadingDate, days));
  }, [mode, selectedVehicle, loadingDate, country, days]);

  const computedEta = etaTouched && etaOverride ? etaOverride : autoEta;

  // Reset manual ETA override when mode/vehicle changes substantially.
  useEffect(() => {
    setEtaOverride("");
    setEtaTouched(false);
  }, [mode, selectedVehicle?.id]);

  // fromOffer prefill — local-only. Reads manager_offers + responses +
  // allocation_parts and seeds ONE draft card with source_position_id (so
  // identity-lock kicks in inside ShipmentProductCard). No writes happen.
  // Mirrors the logic in /shipments/$id/products.tsx so Build 2B can later
  // commit identical payloads atomically.
  const [fromOfferState, setFromOfferState] = useState<"idle" | "loading" | "applied" | "blocked" | "failed">(
    search.fromOffer ? "loading" : "idle",
  );
  useEffect(() => {
    if (!search.fromOffer || !user || !isStaff) return;
    if (fromOfferState !== "loading") return;
    let cancelled = false;
    (async () => {
      try {
        const { data: offer, error } = await supabase
          .from("manager_offers")
          .select(
            "id,product_name,origin_country,caliber,variety,pallet_net_kg,pallet_gross_kg,price_per_kg,price_currency,freight_amount,freight_currency,position_id,linked_shipment_id",
          )
          .eq("id", search.fromOffer!)
          .maybeSingle();
        if (cancelled) return;
        if (error || !offer) {
          toast.error("Не вдалося завантажити пропозицію");
          setFromOfferState("failed");
          return;
        }
        const offerPositionId = (offer as { position_id?: string | null }).position_id ?? null;
        if (!offerPositionId) {
          toast.error("Пропозиція без position_id (legacy). Створення поставки за пропозицією заблоковано.");
          setFromOfferState("blocked");
          return;
        }
        const offerNet = Number(offer.pallet_net_kg ?? NaN);
        const offerGross = Number(offer.pallet_gross_kg ?? NaN);
        if (!(Number.isFinite(offerNet) && Number.isFinite(offerGross) && offerNet > 0 && offerGross > offerNet)) {
          toast.error("У пропозиції не заповнено коректні нетто та брутто. Спочатку відредагуйте пропозицію.");
          setFromOfferState("blocked");
          return;
        }
        // Pending pallets = approved - ordered - cancelled.
        const [{ data: responses }, { data: allocParts }] = await Promise.all([
          supabase.from("manager_offer_responses").select("approved_pallets").eq("offer_id", offer.id),
          supabase.from("manager_offer_allocation_parts").select("pallets,status").eq("offer_id", offer.id),
        ]);
        if (cancelled) return;
        const approvedTotal = (responses ?? []).reduce(
          (s, r) => s + Number((r as { approved_pallets: number | null }).approved_pallets ?? 0),
          0,
        );
        const orderedTotal = (allocParts ?? [])
          .filter((p) => (p as { status: string }).status === "ordered")
          .reduce((s, p) => s + Number((p as { pallets: number | null }).pallets ?? 0), 0);
        const cancelledTotal = (allocParts ?? [])
          .filter((p) => (p as { status: string }).status === "cancelled")
          .reduce((s, p) => s + Number((p as { pallets: number | null }).pallets ?? 0), 0);
        const pending = approvedTotal - orderedTotal - cancelledTotal;
        const TARGET_KG = 21000;
        const desiredPalletCount = Math.min(VEHICLE_MAX_PALLETS, Math.max(1, Math.floor(TARGET_KG / offerGross)));
        const safePalletCount = Math.min(desiredPalletCount, pending);
        if (safePalletCount <= 0) {
          toast.error("Немає вільних палет за цією пропозицією");
          setFromOfferState("blocked");
          return;
        }
        const netKg = safePalletCount * offerNet;
        const grossKg = safePalletCount * offerGross;
        const seeded: DraftRow = {
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
        };
        // Also auto-fill loading country from linked shipment if available
        // and not yet touched.
        if (offer.linked_shipment_id) {
          const { data: linkedShip } = await supabase
            .from("shipments")
            .select("country")
            .eq("id", offer.linked_shipment_id)
            .maybeSingle();
          if (!cancelled && linkedShip?.country) {
            const ua = toUaCountry(linkedShip.country) || linkedShip.country || "";
            setCountry((prev) => (prev ? prev : ua));
          }
        }
        if (cancelled) return;
        setDrafts([seeded]);
        setFromOfferState("applied");
      } catch (e) {
        if (cancelled) return;
        toast.error(e instanceof Error ? e.message : "Не вдалося завантажити пропозицію");
        setFromOfferState("failed");
      }
    })();
    return () => { cancelled = true; };
  }, [search.fromOffer, user, isStaff, fromOfferState]);

  // Preview next per-country vehicle sequence
  const previewCc = mode === "new" && country ? getCountryCode(country) : "";
  const { data: previewSeq } = useQuery({
    queryKey: ["next-vehicle-seq", user?.id, previewCc],
    queryFn: () => fetchNextVehicleSequence(previewCc),
    enabled: !loading && !!user && isStaff && !!previewCc,
  });

  // Preview next per-supplier sequence
  const { data: previewSupSeq } = useQuery({
    queryKey: ["next-supplier-seq", user?.id, supplierId],
    queryFn: () => fetchNextSupplierSequence(supplierId),
    enabled: !loading && !!user && isStaff && !!supplierId,
  });

  // Auto-generate code preview: ALIAS-XXX-VVV-YYY.
  useEffect(() => {
    if (!selectedSupplier) {
      setCode("");
      return;
    }
    const alias = getSupplierAlias(selectedSupplier);
    const supSeqStr = previewSupSeq ? String(previewSupSeq).padStart(3, "0") : "···";
    if (mode === "existing" && selectedVehicle) {
      setCode(formatShipmentCode({ alias, supplierSeq: previewSupSeq ?? 0, vehicleCode: selectedVehicle.code }).replace(/-0+$/, supSeqStr === "···" ? `-${supSeqStr}` : ""));
      // Fallback to manual build when previewSupSeq is missing.
      setCode(`${alias}-${supSeqStr}-${selectedVehicle.code}`.toUpperCase());
    } else if (mode === "new" && country) {
      const cc = getCountryCode(country);
      const vehSeqStr = previewSeq ? String(previewSeq).padStart(3, "0") : "···";
      setCode(`${alias}-${supSeqStr}-${cc}-${vehSeqStr}`.toUpperCase());
    } else {
      setCode("");
    }
  }, [mode, selectedVehicle, selectedSupplier, country, previewSeq, previewSupSeq]);

  // ETA cannot be earlier than ETD + 1 day.
  const minLoadingDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();
  const minEta = (() => {
    const base = loadingDate || minLoadingDate;
    if (!base) return "";
    const d = new Date(base);
    if (Number.isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + 1);
    return toDateInputValue(d);
  })();

  // ---------------------------------------------------------------------------
  // Sticky capacity bar totals.
  // ---------------------------------------------------------------------------
  const draftTotals = useMemo(() => {
    let pallets = 0;
    let kg = 0;
    for (const d of drafts) {
      pallets += Number(d.pallet_count) || 0;
      const g = Number(d.gross_weight_kg) || 0;
      const n = Number(d.net_weight_kg) || 0;
      kg += g > 0 ? g : n;
    }
    return { pallets, kg };
  }, [drafts]);

  // For existing vehicle mode we add the already-loaded counters.
  const loadedExisting = useMemo(() => {
    if (mode !== "existing" || !selectedVehicle) return { pallets: 0, kg: 0 };
    return {
      pallets: Number(selectedVehicle.total_pallets ?? 0),
      kg: Number(selectedVehicle.total_weight_kg ?? 0),
    };
  }, [mode, selectedVehicle]);

  // ───────── Build 2D — child-mode wiring ────────────────────────────────
  // True when the form is locked to a parent vehicle (entry via "Додати"
  // from open vehicles, OR after the user picked one in the topup dialog).
  const isChildMode = mode === "existing" && !!selectedVehicle;

  // Build 2D §6 — preview must use inherited freight from the parent
  // vehicle, NOT zero. Sum logistics_cost_usd across every shipment
  // already attached to the chosen vehicle. EUR-only shipments without a
  // computed USD value (NULL) are skipped — same convention the DB triggers
  // use for the per-position transport allocation.
  const inheritedFreightUsd = useMemo(() => {
    if (!isChildMode || !selectedVehicle?.shipments) return 0;
    let pool = 0;
    for (const s of selectedVehicle.shipments) {
      const v = Number(s.logistics_cost_usd ?? 0);
      if (Number.isFinite(v) && v > 0) pool += v;
    }
    return pool;
  }, [isChildMode, selectedVehicle]);

  // Build 2D §1 — keep `country` state in sync with the locked parent
  // vehicle so country-derived queries / preview calls behave identically
  // to standalone mode. UI fields remain hidden in child mode.
  useEffect(() => {
    if (mode !== "existing") return;
    const c = selectedVehicle?.country;
    if (c && c !== country) setCountry(c);
    const ld = selectedVehicle?.loading_date;
    if (ld && ld !== loadingDate) setLoadingDate(ld);
  }, [mode, selectedVehicle?.country, selectedVehicle?.loading_date, country, loadingDate]);

  const totalPallets = draftTotals.pallets + loadedExisting.pallets;
  const totalKg = draftTotals.kg + loadedExisting.kg;
  const remainPallets = Math.max(0, VEHICLE_MAX_PALLETS - totalPallets);
  const remainKg = Math.max(0, VEHICLE_MAX_KG - totalKg);
  const overPallets = totalPallets > VEHICLE_MAX_PALLETS;
  const overKg = totalKg > VEHICLE_MAX_KG;
  const overLimit = overPallets || overKg;

  // Build 2A.2 — capacity summary is a compact sticky top line; no shake/pulse.

  // Build 2A.7 — measure the real AppShell <header> height (mobile uses a
  // fixed banner header that is much taller than the desktop 56px default).
  // We do not modify AppShell; we just read the rendered element height so
  // the sticky capacity bar parks exactly below it on every viewport.
  const [stickyTop, setStickyTop] = useState<number>(56);
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const measure = () => {
      const el = document.querySelector("header");
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // If the header is fixed at top (mobile banner), its bottom = its height.
      // If sticky/static at top of doc, rect.top is ~0 and bottom is height too.
      const next = Math.max(0, Math.round(rect.bottom));
      setStickyTop((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    const el = document.querySelector("header");
    if (el) ro.observe(el);
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    const t = window.setTimeout(measure, 250);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      window.clearTimeout(t);
    };
  }, []);


  if (loading || !isStaff) {
    return <p className="text-sm text-muted-foreground">Завантаження…</p>;
  }


  // Inline label style matching ShipmentProductCard's FieldLabel.
  const fieldLabelCls = "mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";
  const inlineInputCls = "h-9 w-full bg-background text-[13px]";

  // Build 2A.8 — required-empty styling (matches product card pattern).
  const invalidSupplier = !supplierId;
  const invalidCountry = !country.trim();
  const invalidLoadingDate = !loadingDate;
  const invalidEta = !(computedEta && computedEta.length > 0);

  const supplierWrapRef = useRef<HTMLDivElement>(null);
  const countryWrapRef = useRef<HTMLDivElement>(null);
  const vehicleWrapRef = useRef<HTMLDivElement>(null);

  const supplierField = (
    <div ref={supplierWrapRef}>
      <div className={fieldLabelCls}>Постачальник</div>
      <StrictAutocompleteCard
        value={supplierInput}
        onValueChange={(next) => {
          setSupplierInput(next);
          if (!next.trim()) setSupplierId("");
        }}
        items={supplierItems}
        getKey={(item) => item.id}
        getLabel={(item) => item.label}
        getSearchStrings={(item) => item.searchStrings}
        onSelect={(item) => {
          setSupplierId(item.id);
          setSupplierInput(item.name);
          clearInvalid("supplier");
          blurActiveElement();
        }}
        onInputBlur={(raw) => {
          const resolved = resolveSupplierFromInput(raw);
          if (resolved) {
            setSupplierId(resolved.id);
            setSupplierInput(resolved.name);
            clearInvalid("supplier");
            return;
          }
          if (!raw.trim()) { setSupplierId(""); return; }
          // Unrecognized: clear, flash, shake, vibrate.
          triggerInvalidFeedback(supplierWrapRef.current);
          window.setTimeout(() => { setSupplierInput(""); setSupplierId(""); }, 700);
        }}
        placeholder="Постачальник"
        browseLimit={5}
        searchLimit={5}
        minSearchLength={2}
        className="w-full"
        inputClassName={cn(
          inlineInputCls,
          (invalid.has("supplier") || invalidSupplier) && "border-destructive/70 ring-1 ring-destructive/40",
        )}
        inputProps={{ "data-mobile-edit-label": "Постачальник" }}
        renderItem={(item) => (
          <div className="flex flex-col">
            <span className="truncate">{item.name}</span>
            {item.country ? (
              <span className="text-[11px] text-muted-foreground">{toUaCountry(item.country)}</span>
            ) : null}
          </div>
        )}
      />
    </div>
  );

  const countryField = (
    <div ref={countryWrapRef}>
      <div className={fieldLabelCls}>Країна завантаження</div>
      <StrictAutocompleteCard
        value={countryInput}
        onValueChange={setCountryInput}
        items={countryItems}
        getKey={(item) => item.label}
        getLabel={(item) => item.label}
        getSearchStrings={(item) => item.searchStrings}
        onSelect={(item) => {
          setCountry(item.label);
          setCountryInput(item.label);
          setCountryTouched(true);
          setVehicleId("");
          clearInvalid("country");
          blurActiveElement();
        }}
        onInputBlur={(raw) => {
          const resolved = resolveCountry(raw, countryChoices, countryAliases);
          if (resolved) {
            setCountry(resolved);
            setCountryInput(resolved);
            setCountryTouched(true);
            setVehicleId("");
            clearInvalid("country");
            return;
          }
          if (!raw.trim()) { setCountry(""); return; }
          triggerInvalidFeedback(countryWrapRef.current);
          window.setTimeout(() => { setCountryInput(""); setCountry(""); }, 700);
        }}
        placeholder="Країна"
        browseLimit={5}
        searchLimit={5}
        minSearchLength={2}
        className="w-full"
        inputClassName={cn(
          inlineInputCls,
          (invalid.has("country") || invalidCountry) && "border-destructive/70 ring-1 ring-destructive/40",
        )}
        inputProps={{ "data-mobile-edit-label": "Країна завантаження" }}
        renderItem={(item) => <span className="block truncate">{item.label}</span>}
      />
    </div>
  );

  const codeField = null;

  // Build 2A.11 — Транспорт/фрахт is a REQUIRED preliminary estimate.
  // Validation rules:
  //   - allow only digits, dot, comma while typing;
  //   - on blur, must parse to a finite positive number;
  //   - empty or invalid value triggers flash + shake + haptic + clear;
  //   - field shows red invalid style whenever empty or invalid;
  //   - included in the local "missing fields" set that gates Create.
  // No DB writes happen in this build; the wired Create in Build 2B must
  // refuse to commit while transport is empty or invalid.
  const transportWrapRef = useRef<HTMLDivElement>(null);
  const parseTransport = (raw: string): number | null => {
    const cleaned = raw.trim().replace(",", ".");
    if (!cleaned) return null;
    if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const transportValue = parseTransport(transportAmount);
  // Build 2D — in child mode the transport field is hidden + readonly and
  // freight is inherited from the parent vehicle. It is NEVER required.
  const invalidTransport = isChildMode ? false : transportValue == null;

  const transportField = isChildMode ? (
    <div>
      <div className={fieldLabelCls}>
        <Lock className="mr-1 inline h-3 w-3" /> Транспорт (успадковано від авто)
      </div>
      <div className="flex h-9 items-center justify-between rounded-md border border-input bg-secondary/30 px-2 text-[13px]">
        <span className="text-muted-foreground">Фрахт авто (USD)</span>
        <span className="font-semibold tabular-nums">
          {inheritedFreightUsd > 0 ? inheritedFreightUsd.toFixed(2) : "—"} $
        </span>
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">
        Для цієї поставки фрахт = 0. Преві’ю собівартості рахується за фрахтом авто.
      </div>
    </div>
  ) : (
    <div ref={transportWrapRef}>
      <div className={fieldLabelCls}>Транспорт (фрахт)</div>
      <div
        className={cn(
          "flex items-center gap-1 rounded-md border border-input bg-background",
          invalidTransport && "border-destructive/70 ring-1 ring-destructive/40",
        )}
      >
        <Input
          inputMode="decimal"
          value={transportAmount}
          aria-label="Транспорт (фрахт)"
          onChange={(e) => {
            const cleaned = e.target.value.replace(/[^\d.,]/g, "");
            setTransportAmount(cleaned);
            if (parseTransport(cleaned) != null) clearInvalid("transport");
          }}
          onBlur={() => {
            if (!transportAmount.trim()) {
              return;
            }
            if (parseTransport(transportAmount) == null) {
              triggerInvalidFeedback(transportWrapRef.current);
              window.setTimeout(() => setTransportAmount(""), 700);
            }
          }}
          placeholder="—"
          className="h-9 flex-1 border-transparent bg-transparent px-2 text-right text-[13px] tabular-nums focus-visible:ring-0"
        />
        <select
          value={transportCurrency}
          onChange={(e) => setTransportCurrency(e.target.value as "EUR" | "USD")}
          className="h-9 rounded border-transparent bg-transparent px-2 text-[13px]"
        >
          <option value="EUR">€</option>
          <option value="USD">$</option>
        </select>
      </div>
    </div>
  );

  const minLoadingDateObj = useMemo(() => {
    const d = new Date(minLoadingDate);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }, [minLoadingDate]);
  const minEtaObj = useMemo(() => {
    if (!minEta) return undefined;
    const d = new Date(minEta);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }, [minEta]);

  const loadingDateField = (
    <div className="min-w-0">
      <div className={fieldLabelCls}>Дата завантаження</div>
      <StrictDatePicker
        value={loadingDate}
        onChange={(v) => {
          setLoadingDate(v);
          if (v) clearInvalid("loadingDate");
        }}
        minDate={minLoadingDateObj}
        invalid={invalid.has("loadingDate") || invalidLoadingDate}
        ariaLabel="Дата завантаження"
      />
    </div>
  );

  const etaField = (
    <div className="min-w-0">
      <div className={fieldLabelCls}>ETA (прибуття)</div>
      <StrictDatePicker
        value={computedEta}
        onChange={(v) => {
          setEtaOverride(v);
          setEtaTouched(true);
          if (v) clearInvalid("eta");
        }}
        minDate={minEtaObj}
        invalid={invalid.has("eta") || invalidEta}
        ariaLabel="ETA"
      />
    </div>
  );

  const vehicleField = (
    <div ref={vehicleWrapRef} className={cn(invalid.has("vehicle") && "field-invalid")}>
      <div className={fieldLabelCls}>Відкрите авто</div>
      <StrictAutocompleteCard
        value={vehicleInput}
        onValueChange={setVehicleInput}
        items={vehicleItems}
        getKey={(item) => item.id}
        getLabel={(item) => item.label}
        getSearchStrings={(item) => item.searchStrings}
        onSelect={(item) => {
          setVehicleId(item.id);
          setVehicleInput(item.label);
          setCountry(item.country);
          setCountryTouched(true);
          clearInvalid("vehicle");
          blurActiveElement();
        }}
        onInputBlur={(raw) => {
          const resolved = resolveVehicleFromInput(raw);
          if (resolved) {
            setVehicleId(resolved.id);
            setVehicleInput(resolved.label);
            setCountry(resolved.country);
            setCountryTouched(true);
            clearInvalid("vehicle");
            return;
          }
          if (!raw.trim()) { setVehicleId(""); return; }
          triggerInvalidFeedback(vehicleWrapRef.current);
          window.setTimeout(() => { setVehicleInput(""); setVehicleId(""); }, 700);
        }}
        placeholder="Авто"
        browseLimit={5}
        searchLimit={5}
        minSearchLength={2}
        className="w-full"
        inputClassName={inlineInputCls}
        inputProps={{ "data-mobile-edit-label": "Відкрите авто" }}
        renderItem={(item) => (
          <div className="flex flex-col">
            <span className="font-semibold truncate">
              {item.code} · {item.country}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {Number(item.total_pallets ?? 0)}/26 пал · {Math.round(Number(item.total_weight_kg ?? 0))}/21500 кг
              {item.suppliersText ? ` · ${item.suppliersText}` : ""}
            </span>
          </div>
        )}
      />
    </div>
  );


  const onBack = () => {
    // Build 2A: nothing is persisted in DB, so back is a pure navigation.
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
      return;
    }
    navigate({ to: "/shipments" });
  };

  // Build 2B-B-2 — scenario confirm handler. Validation is already enforced
  // by the gate on the "Створити" button; this function performs the
  // orchestrated DB writes and navigates to the new shipment on success.
  async function handleConfirmScenario(
    scenario: CreateShipmentScenario,
    override?: { parentVehicleId?: string; reserve?: ReserveInput },
  ) {
    if (submitLockRef.current) return;
    if (!user) {
      toast.error("Сесія не активна");
      return;
    }
    if (!selectedSupplier) {
      toast.error("Постачальник не вибраний");
      return;
    }
    // Build 2D fix — child mode is decided by an EXPLICIT parentVehicleId
    // passed by the caller (topup picker), OR by the current form state
    // (entry via "Додати" from open vehicles, or ?vehicleId= search param).
    // We must NOT rely on React state that was set in the same tick as this
    // call, because setState is async and the closure would read stale values.
    const explicitParentId = override?.parentVehicleId;
    const effectiveChildMode = explicitParentId ? true : isChildMode;
    const effectiveParentVehicleId = explicitParentId ?? (isChildMode ? vehicleId : undefined);

    if (!effectiveChildMode) {
      if (!country || !loadingDate || !computedEta) {
        toast.error("Заповніть постачальника, країну та дати");
        return;
      }
      if (transportValue == null) {
        toast.error("Вкажіть транспорт (фрахт)");
        return;
      }
    } else {
      if (!effectiveParentVehicleId) {
        toast.error("Авто для довантаження не вибране");
        return;
      }
      // Defensive: child mode must never run "create_and_close".
      if (scenario === "create_and_close") {
        toast.error("У режимі довантаження не можна закривати авто");
        return;
      }
    }

    const drafstToCommit = drafts.filter(
      (d) =>
        d.product_name.trim() !== "" ||
        d.origin_country.trim() !== "" ||
        Number(d.pallet_count) > 0 ||
        Number(d.net_weight_kg) > 0 ||
        Number(d.gross_weight_kg) > 0 ||
        Number(d.unit_price) > 0,
    );
    if (drafstToCommit.length === 0) {
      toast.error("Немає позицій для збереження");
      return;
    }

    submitLockRef.current = true;
    setIsSubmitting(true);
    try {
      const res = await createShipmentFlow({
        scenario,
        userId: user.id,
        supplier: {
          id: selectedSupplier.id,
          name: selectedSupplier.name,
          alias: selectedSupplier.alias ?? null,
          code_base: selectedSupplier.code_base ?? null,
          import_manager_id:
            (selectedSupplier as { import_manager_id?: string | null }).import_manager_id ?? null,
        },
        country,
        loadingDate,
        eta: computedEta,
        transportAmount: effectiveChildMode ? 0 : (transportValue ?? 0),
        transportCurrency,
        drafts: drafstToCommit,
        products,
        // Build 2D fix — pass explicit parentVehicleId so the write path
        // never depends on possibly-stale React state.
        mode: effectiveChildMode ? "child" : "standalone",
        parentVehicleId: effectiveChildMode ? effectiveParentVehicleId : undefined,
      });

      if (!res.ok) {
        if (res.partialSuccess && res.artefacts?.shipmentId) {
          // Vehicle did not actually close, but shipment + items + vehicle exist.
          // Treat as warning, not error: refresh lists, clear local draft and
          // navigate to the created shipment so user cannot resubmit this form.
          toast.warning(
            `Поставку створено, але авто не закрите: ${res.reason}. Закрийте авто вручну пізніше.`,
            { duration: 12_000 },
          );
          await leaveCreateFormAfterSuccess({ closed: false });
          return;
        }
        const artefacts = res.artefacts;
        if (artefacts) {
          const parts: string[] = [];
          if (artefacts.vehicleId) parts.push(`vehicle=${artefacts.vehicleId}`);
          if (artefacts.shipmentId) parts.push(`shipment=${artefacts.shipmentId}`);
          if (artefacts.itemIds?.length) parts.push(`items=${artefacts.itemIds.length}`);
          toast.error(
            `Помилка створення (${res.stage}): ${res.reason}. Не видалено: ${parts.join(", ")}`,
            { duration: 12_000 },
          );
        } else {
          toast.error(`Помилка створення (${res.stage}): ${res.reason}`);
        }
        return;
      }
      // Success: refresh lists and navigate to the table that now owns the saved shipment.
      toast.success(
        res.closed
          ? `Поставку ${res.shipmentCode} створено, авто закрите`
          : `Поставку ${res.shipmentCode} створено`,
      );
      await leaveCreateFormAfterSuccess({ closed: res.closed });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Невідома помилка створення");
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  }


  return (
    <div
      className="shipment-create-screen space-y-3 pb-[calc(var(--keyboard-inset,0px)+5rem)]"
      style={{ paddingTop: 48 }}
    >
      {/* Sticky capacity summary. position:fixed pins it below the AppShell
          header. data-kb-anchor-top opts into the keyboard-open transform
          in styles.css, which translates this element (and the AppShell
          header) by visualViewport.offsetTop so iOS does not scroll the
          top chrome out of view while the keyboard is up. */}
      <div
        data-kb-anchor-top="true"
        style={{ top: stickyTop, left: 0, right: 0 }}
        className="fixed z-30 border-b border-border bg-background/95 px-3 py-1.5 backdrop-blur"
      >
        <div className="flex items-center gap-x-3 gap-y-0.5 text-[11px] tabular-nums">
          <span className={cn("font-semibold", overPallets && "text-destructive")}>
            Палети {totalPallets}/{VEHICLE_MAX_PALLETS}
          </span>
          <span className={cn("font-semibold", overKg && "text-destructive")}>
            Брутто {Math.round(totalKg)}/{VEHICLE_MAX_KG}
          </span>
          <span className="text-muted-foreground">Залишок пал {remainPallets}</span>
          <span className="text-muted-foreground">Залишок кг {Math.round(remainKg)}</span>
        </div>
        {overLimit && (
          <div className="mt-1 text-[10px] font-semibold leading-snug text-destructive">
            {overPallets
              ? `Перевищено ліміт авто: ${totalPallets}/${VEHICLE_MAX_PALLETS} палет. `
              : ""}
            {overKg
              ? `Перевищено ліміт ваги: ${Math.round(totalKg)}/${VEHICLE_MAX_KG} кг. `
              : ""}
          </div>
        )}
      </div>


      {/* Header form — unified compact card style. Mode toggle removed:
          default flow is new vehicle; existing-vehicle mode is engaged
          only when route has ?vehicleId=. */}
      <div
        className="shipment-header-card space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm"
        onSubmit={(e) => e.preventDefault()}
      >
        {mode === "new" ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              {supplierField}
              {countryField}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {loadingDateField}
              {etaField}
            </div>
            <div className="grid grid-cols-1 gap-2">
              {transportField}
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {supplierField}
              {selectedVehicle ? (
                <div>
                  <div className={fieldLabelCls}>
                    <Lock className="mr-1 inline h-3 w-3" /> Країна (зафіксовано)
                  </div>
                  <div className="flex h-9 items-center rounded-md border border-input bg-secondary/30 px-2 text-[13px] font-semibold">
                    {selectedVehicle.country}
                  </div>
                </div>
              ) : (
                countryField
              )}
            </div>
            <div className="grid grid-cols-1 gap-2">
              {transportField}
            </div>
            {selectedVehicle ? (
              <div className="rounded-md border border-border bg-secondary/30 px-2 py-1.5 text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">{selectedVehicle.code}</span> ·{" "}
                {selectedVehicle.country} · ETD {selectedVehicle.loading_date ?? "—"} · ETA{" "}
                {selectedVehicle.eta ?? "—"} · {Number(selectedVehicle.total_pallets ?? 0)}/26 пал ·{" "}
                {Math.round(Number(selectedVehicle.total_weight_kg ?? 0))}/21500 кг · власник{" "}
                {selectedVehicleOwnerName}
              </div>
            ) : (
              vehicleField
            )}
          </>
        )}
      </div>


      {/* Products section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-foreground">Товари в поставці</div>
          <div className="text-[11px] text-muted-foreground">
            {drafts.length} {drafts.length === 1 ? "позиція" : "позицій"}
          </div>
        </div>

        {drafts.map((d, idx) => {
          let otherPallets = loadedExisting.pallets;
          let otherKg = loadedExisting.kg;
          for (const o of drafts) {
            if (o.localId === d.localId) continue;
            otherPallets += Number(o.pallet_count) || 0;
            const g = Number(o.gross_weight_kg) || 0;
            const n = Number(o.net_weight_kg) || 0;
            otherKg += g > 0 ? g : n;
          }
          const locked = Boolean(d.source_position_id);
          return (
            <NewShipmentProductCard
              key={d.localId}
              draft={d}
              products={products}
              otherPallets={otherPallets}
              otherKg={otherKg}
              productOriginLocked={locked}
              index={idx}
              transportAmount={isChildMode ? inheritedFreightUsd : transportValue}
              transportCurrency={isChildMode ? "USD" : transportCurrency}
              onPatch={(patch) => patchDraft(d.localId, patch)}
              onRemove={() => removeDraft(d.localId)}
            />

          );
        })}
      </div>

      {/* Build 2A.2 — action buttons in normal page flow, after the last
          product card. No fixed/sticky/floating. */}
      <div className="space-y-2 pt-1">
        {(() => {
          // Build 2B-B-1 — validation gate. No DB writes here or in the
          // submit handler. Required: header fields (supplier / country /
          // dates / transport), ETA >= loading date, at least one row, and
          // for each non-empty row product+origin recognized, pallets > 0,
          // net > 0, gross > 0, gross > net. caliber/class/brand/variety/
          // package_used are NOT required.
          const missing: string[] = [];
          if (invalidSupplier) missing.push("Постачальник");
          if (mode === "new" && invalidCountry) missing.push("Країна завантаження");
          if (invalidLoadingDate) missing.push("Дата завантаження");
          if (invalidEta) missing.push("ETA");
          if (
            !invalidLoadingDate &&
            !invalidEta &&
            computedEta &&
            loadingDate &&
            computedEta < loadingDate
          ) {
            missing.push("ETA раніше дати завантаження");
          }
          if (mode === "existing" && !vehicleId) missing.push("Авто");
          if (invalidTransport) missing.push("Транспорт (фрахт)");

          const nonEmptyRows = drafts.filter(
            (d) =>
              d.product_name.trim() !== "" ||
              d.origin_country.trim() !== "" ||
              Number(d.pallet_count) > 0 ||
              Number(d.net_weight_kg) > 0 ||
              Number(d.gross_weight_kg) > 0 ||
              Number(d.unit_price) > 0,
          );
          if (nonEmptyRows.length === 0) missing.push("Хоча б одна позиція");

          const rowIssues: string[] = [];
          nonEmptyRows.forEach((d, i) => {
            const label = `Позиція ${drafts.indexOf(d) + 1}`;
            const local: string[] = [];
            if (!d.product_name.trim() || !isKnownProductName(d.product_name, products)) {
              local.push("товар");
            }
            if (!d.origin_country.trim()) local.push("походження");
            const p = Number(d.pallet_count) || 0;
            const n = Number(d.net_weight_kg) || 0;
            const g = Number(d.gross_weight_kg) || 0;
            if (!(p > 0)) local.push("палети");
            if (!(n > 0)) local.push("нетто");
            if (!(g > 0)) local.push("брутто");
            if (n > 0 && g > 0 && !(g > n)) local.push("брутто ≤ нетто");
            if (local.length > 0) rowIssues.push(`${label}: ${local.join(", ")}`);
            void i;
          });

          if (overLimit) missing.push("Ліміт авто перевищено");

          const all = [...missing, ...rowIssues];
          return all.length > 0 ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
              Не заповнено / некоректно: {all.join(", ")}
            </div>
          ) : null;
        })()}
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={addManualDraft} className="h-10 w-full">
            <Plus className="mr-1 h-4 w-4" /> Додати товар
          </Button>
          <Button type="button" variant="outline" onClick={cloneLastDraft} className="h-10 w-full">
            <Copy className="mr-1 h-4 w-4" /> Аналогічний
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={onBack} className="h-10 w-full">
            <ArrowLeft className="mr-1 h-4 w-4" /> Назад
          </Button>
          {(() => {
            // Build 2B-B-1 — compute final form validity. Mirrors the rules
            // surfaced in the summary above. NO DB writes on click.
            const etaBeforeLoading =
              !!computedEta && !!loadingDate && computedEta < loadingDate;
            const nonEmptyRows = drafts.filter(
              (d) =>
                d.product_name.trim() !== "" ||
                d.origin_country.trim() !== "" ||
                Number(d.pallet_count) > 0 ||
                Number(d.net_weight_kg) > 0 ||
                Number(d.gross_weight_kg) > 0 ||
                Number(d.unit_price) > 0,
            );
            const rowsValid =
              nonEmptyRows.length > 0 &&
              nonEmptyRows.every((d) => {
                if (!d.product_name.trim() || !isKnownProductName(d.product_name, products)) return false;
                if (!d.origin_country.trim()) return false;
                const p = Number(d.pallet_count) || 0;
                const n = Number(d.net_weight_kg) || 0;
                const g = Number(d.gross_weight_kg) || 0;
                if (!(p > 0) || !(n > 0) || !(g > 0)) return false;
                if (!(g > n)) return false;
                return true;
              });
            const headerValid =
              !invalidSupplier &&
              !(mode === "new" && invalidCountry) &&
              !invalidLoadingDate &&
              !invalidEta &&
              !etaBeforeLoading &&
              !(mode === "existing" && !vehicleId) &&
              !invalidTransport &&
              !overLimit;
            const canSubmit = headerValid && rowsValid;
            return (
              <Button
                type="button"
                disabled={!canSubmit || isSubmitting}
                onClick={() => {
                  // Build 2B-B-2 — open scenario dialog. No DB writes yet.
                  if (!canSubmit || isSubmitting) return;
                  setScenarioOpen(true);
                }}
                className="h-10 w-full bg-brand text-brand-foreground hover:bg-brand/90"
              >
                {isSubmitting ? "Створення…" : "Створити"}
              </Button>
            );
          })()}
        </div>
      </div>

      <CreateScenarioDialog
        open={scenarioOpen}
        isSubmitting={isSubmitting}
        onClose={() => setScenarioOpen(false)}
        onConfirm={(scenario) => void handleConfirmScenario(scenario)}
        childMode={isChildMode}
        onTopUp={() => {
          // Build 2D — user picked "Створити та довантажити" from the
          // standalone form. Close the scenario tile and open the picker.
          // Zero DB writes here; orchestrator runs only after pick.
          setScenarioOpen(false);
          setPickOpen(true);
        }}
      />

      {/* Build 2D — picker for "Створити та довантажити". The dialog is a
          pure read query; selecting a vehicle flips the form into child
          mode (mode='existing' + vehicleId) and immediately triggers the
          orchestrator. No writes happen until the orchestrator runs. */}
      <PickOpenVehicleDialog
        open={pickOpen}
        country={country}
        draftPallets={draftTotals.pallets}
        draftGrossKg={draftTotals.kg}
        onClose={() => setPickOpen(false)}
        onPick={(v) => {
          setPickOpen(false);
          // Reflect the pick in local state for UI consistency (readonly
          // parent-derived fields, capacity bar), but DO NOT rely on it for
          // the write path — pass parentVehicleId explicitly instead so a
          // stale-closure read of `isChildMode`/`vehicleId` cannot degrade
          // the flow into a new standalone vehicle create.
          setMode("existing");
          setVehicleId(v.id);
          void handleConfirmScenario("create", { parentVehicleId: v.id });
        }}

      />
    </div>
  );
}


// Unused export markers (kept for backwards compatibility with any direct
// imports) — none currently. Intentionally omitted.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _formatShipmentCode = formatShipmentCode;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _formatVehicleCode = formatVehicleCode;
