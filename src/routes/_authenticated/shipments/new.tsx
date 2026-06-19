import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useCallback, type FormEvent } from "react";
import { Truck, Plus, Lock, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CostPair } from "@/components/CostPair";
import {
  activeCustomsRefsQuery,
  latestEurUsdQuery,
  vehicleContextQuery,
} from "@/lib/shipment-row-service";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineAutocomplete } from "@/components/InlineAutocomplete";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { COUNTRIES as FALLBACK_COUNTRIES, COUNTRY_DAYS, calcArrivalDate, toDateInputValue } from "@/lib/arrival";
import { useCountryOptions } from "@/hooks/useCountryOptions";
import { useCountryAliases } from "@/hooks/useCountryAliases";
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
import { commitNewShipmentItem } from "@/lib/commit-shipment-row";
import { rollbackBirthPosition } from "@/lib/position-attach";
import { canonicalizeProductName } from "@/lib/product-aliases";
import { AutocompleteCell } from "@/components/AutocompleteCell";
import { VarietyAutocomplete } from "@/components/VarietyAutocomplete";
import { useProductAliases } from "@/hooks/useProductAliases";
import { useVarietiesFor } from "@/hooks/useProductVarieties";
import { usePalletResolver, type PackageOption } from "@/hooks/usePackageOptions";
import { VelvetCosmicCreateButton } from "@/components/VelvetCosmicCreateButton";
import {
  type DraftRow as EngineDraftRow,
  type ProductRef,
  type RowComponents,
  computeRowPreview,
  getMissingDraftFields,
  isNetGreaterThanGross,
  sumCapacity,
} from "@/lib/shipment-row-engine";

type DraftPreview = {
  value: { indicative: number; invoice: number } | null;
  components: RowComponents;
  reason: string | null;
};

const MAX_PALLETS_PER_OFFER_DRAFT = 26;
const TARGET_KG_PER_OFFER_DRAFT = 21000;
const VEHICLE_MAX_PALLETS = 26;
const VEHICLE_MAX_KG = 21500;

// Build B.2 — route-specific extension of the shared engine DraftRow.
// brand/class/offerLocked are required at this route; engine treats brand/class
// as optional and never touches offerLocked.
type NewShipmentDraftRow = EngineDraftRow & {
  brand: string;
  class: string;
  offerLocked: boolean;
};

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

function NewShipment() {
  const navigate = useNavigate();
  const { user, hasRole, loading } = useAuth();
  const isStaff = hasRole(["super_admin", "admin", "import_manager"]);
  const search = Route.useSearch();
  const { data: currentManagerId } = useQuery({
    queryKey: ["current-import-manager-id", user?.id],
    enabled: !loading && !!user && isStaff,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("current_import_manager_id");
      if (error) throw error;
      return data ?? null;
    },
  });

  // Redirect non-staff to their dashboard
  useEffect(() => {
    if (!loading && !isStaff) {
      navigate({ to: "/dashboard/branch" });
    }
  }, [loading, isStaff, navigate]);

  const [mode, setMode] = useState<Mode>(search.vehicleId ? "existing" : "new");
  const [vehicleId, setVehicleId] = useState<string>(search.vehicleId ?? "");
  const [country, setCountry] = useState<string>("");
  const [countryTouched, setCountryTouched] = useState(false);
  const [loadingDate, setLoadingDate] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [etaOverride, setEtaOverride] = useState<string>("");
  const [etaTouched, setEtaTouched] = useState(false);
  // Transport (new vehicle only). Persisted to shipments on final save.
  const [logisticsCostText, setLogisticsCostText] = useState<string>("");
  const [logisticsCurrency, setLogisticsCurrency] = useState<string>("EUR");

  const [supplierInput, setSupplierInput] = useState("");
  const [countryInput, setCountryInput] = useState("");
  const countryOptions = useCountryOptions();
  const countryAliases = useCountryAliases();
  const productAliases = useProductAliases();
  const { data: productOptions = [] } = useQuery({
    queryKey: ["product-dictionary-options-new-draft"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from("product_dictionary")
        .select("product_name_ua")
        .order("product_name_ua");
      return ((data ?? []).map((r) => r.product_name_ua).filter(Boolean) as string[]);
    },
  });
  const [vehicleInput, setVehicleInput] = useState("");
  const [mobileEditingLabel, setMobileEditingLabel] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(() => new Set());
  const [shake, setShake] = useState(false);
  const clearInvalid = (key: string) => setInvalid((prev) => {
    if (!prev.has(key)) return prev;
    const next = new Set(prev);
    next.delete(key);
    return next;
  });
  const triggerShake = (missing: string[]) => {
    setInvalid(new Set(missing));
    setShake(false);
    requestAnimationFrame(() => setShake(true));
    window.setTimeout(() => setShake(false), 600);
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
      // RLS already restricts managers to their own suppliers; admins see all.
      const { data, error } = await supabase
        .from("suppliers")
        .select("id,name,country,code_base,alias,iso3,import_manager_id")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const qc = useQueryClient();

  const { data: openVehicles } = useQuery({
    queryKey: ["open-vehicles", user?.id, country],
    enabled: !loading && !!user && isStaff,
    refetchOnMount: "always",
    staleTime: 0,
    queryFn: async () => {
      let q = supabase
        .from("vehicles" as never)
        .select("id,code,country,country_code,loading_date,eta,total_pallets,total_weight_kg,created_by,shipments(id,code,logistics_cost,logistics_cost_currency,created_by,suppliers(name),shipment_items(id,product_name,variety,caliber,pallet_count,pallet_weight,net_weight_kg,gross_weight_kg))")
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (country) q = q.eq("country", country);
      const { data, error } = await q;
      if (error) return [] as OpenVehicle[];
      return (data ?? []) as unknown as OpenVehicle[];
    },
  });

  // Realtime: refresh open vehicles list when vehicles or shipment_items change
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

  // Existing committed load on the selected vehicle, aggregated gross-first
  // from shipment_items (matches shipments/index.tsx aggregateVehicleFromItems);
  // falls back to vehicles.total_* only when no item rows exist. Reused by
  // both the sticky capacity strip and the finalSave hard-block.
  const existingVehicleLoad = useMemo(() => {
    if (mode !== "existing" || !selectedVehicle) return { pallets: 0, gross: 0 };
    let pallets = 0;
    let gross = 0;
    let sawAny = false;
    for (const s of selectedVehicle.shipments ?? []) {
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
      pallets = Number(selectedVehicle.total_pallets ?? 0);
      gross = Number(selectedVehicle.total_weight_kg ?? 0);
    }
    return { pallets, gross };
  }, [mode, selectedVehicle]);

  const profileNameById = useMemo(
    () => new Map((managerProfiles ?? []).map((profile) => [profile.id, profile.full_name || "Менеджер"])),
    [managerProfiles],
  );
  const selectedVehicleOwnerName = selectedVehicle?.created_by
    ? profileNameById.get(selectedVehicle.created_by) ?? "Власник авто"
    : "Власник авто";
  const countryChoices = useMemo(
    () => Array.from(new Set((countryOptions.length ? countryOptions : FALLBACK_COUNTRIES).filter(Boolean))),
    [countryOptions],
  );
  const supplierItems = useMemo(
    () => (suppliers ?? []).map((supplier) => ({
      ...supplier,
      label: supplier.name,
      searchStrings: [supplier.name, supplier.alias ?? "", toUaCountry(supplier.country ?? "")].filter(Boolean),
    })),
    [suppliers],
  );
  const countryItems = useMemo(
    () => countryChoices.map((item) => ({
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
    () => (openVehicles ?? []).map((vehicle) => {
      const suppliersText = (vehicle.shipments ?? []).map((shipment) => shipment.suppliers?.name ?? "").filter(Boolean).join(", ");
      return {
        ...vehicle,
        label: `${vehicle.code} · ${vehicle.country}`,
        suppliersText,
        searchStrings: [vehicle.code, vehicle.country, suppliersText].filter(Boolean),
      };
    }),
    [openVehicles],
  );

  const blurAndCloseEditors = useCallback(() => {
    if (typeof document !== "undefined") {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    }
    setMobileEditingLabel(null);
  }, []);

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

  const resolveSupplierFromInput = useCallback((raw: string) => {
    const q = raw.trim().toLowerCase();
    if (!q) return null;
    const direct = supplierItems.find((item) => item.name.trim().toLowerCase() === q);
    if (direct) return direct;
    const alias = supplierItems.find((item) => (item.alias ?? "").trim().toLowerCase() === q);
    if (alias) return alias;
    const prefix = supplierItems.filter((item) => item.searchStrings.some((candidate) => matchesWordStart(candidate, q)));
    return prefix.length === 1 ? prefix[0] : null;
  }, [supplierItems]);

  const resolveVehicleFromInput = useCallback((raw: string) => {
    const q = raw.trim().toLowerCase();
    if (!q) return null;
    const direct = vehicleItems.find((item) => item.label.toLowerCase() === q || item.code.toLowerCase() === q);
    if (direct) return direct;
    const prefix = vehicleItems.filter((item) => item.searchStrings.some((candidate) => matchesWordStart(candidate, q)));
    return prefix.length === 1 ? prefix[0] : null;
  }, [vehicleItems]);

  useEffect(() => {
    const labelOf = (target: EventTarget | null) => {
      const el = target instanceof HTMLElement ? target : null;
      if (!el) return null;
      if (el.closest("[data-mobile-edit-label='Постачальник']")) return "Постачальник";
      if (el.closest("[data-mobile-edit-label='Країна завантаження']")) return "Країна завантаження";
      if (el.closest("[data-mobile-edit-label='Відкрите авто']")) return "Відкрите авто";
      if (el.id === "code") return "Номер поставки";
      if (el.id === "ld") return "Дата завантаження";
      if (el.id === "eta-new") return "Дата прибуття";
      return null;
    };
    const onFocusIn = (event: Event) => {
      setMobileEditingLabel(labelOf(event.target));
    };
    const onFocusOut = () => {
      window.setTimeout(() => {
        setMobileEditingLabel(labelOf(document.activeElement));
      }, 0);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // When supplier picked: auto-fill country if user hasn't touched it (and we're creating new vehicle)
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

  // Reset manual override if mode/vehicle changes substantially
  useEffect(() => {
    setEtaOverride("");
    setEtaTouched(false);
  }, [mode, selectedVehicle?.id]);

  const { data: fromOfferPrefill } = useQuery({
    queryKey: ["new-shipment-from-offer", search.fromOffer],
    enabled: !!search.fromOffer,
    queryFn: async () => {
      const { data: offer, error } = await supabase
        .from("manager_offers")
        .select("linked_shipment_id,import_manager_id,position_id")
        .eq("id", search.fromOffer!)
        .maybeSingle();
      if (error) throw error;
      if (!offer) return null;

      let linkedShipment: { supplier_id: string | null; country: string | null } | null = null;
      if (offer.linked_shipment_id) {
        const { data: shipment, error: shipmentError } = await supabase
          .from("shipments")
          .select("supplier_id,country")
          .eq("id", offer.linked_shipment_id)
          .maybeSingle();
        if (shipmentError) throw shipmentError;
        linkedShipment = shipment;
      }

      return {
        supplierId: linkedShipment?.supplier_id ?? null,
        // Country separation: shipment/loading country may ONLY come from a
        // linked shipment. NEVER fall back to offer.origin_country — that is
        // product origin only and must not leak into shipment/vehicle/supplier.
        country: linkedShipment?.country ?? null,
        offerManagerId: offer.import_manager_id ?? null,
        // Phase 2 audit: surface offer.position_id even though products page
        // re-fetches it. NULL signals legacy offer (no anchor) → products
        // page will block the prefill.
        offerPositionId: (offer as { position_id?: string | null }).position_id ?? null,
      };
    },
  });
  useEffect(() => {
    if (!fromOfferPrefill?.country) return;
    if (countryTouched || country) return;
    const uaCountry = toUaCountry(fromOfferPrefill.country) || fromOfferPrefill.country;
    if (uaCountry) setCountry(uaCountry);
  }, [fromOfferPrefill?.country, countryTouched, country]);

  // Supplier is NEVER auto-selected from offer. Manager must pick supplier
  // explicitly. Origin country (product origin) must never drive supplier
  // selection, and even a linked shipment's supplier is not used to prefill
  // here — that caused values to be restored after manual clearing.

  // Build 2A — full offer product prefill for inline draft commit.
  // Mirrors the prefill block in $id.products.tsx (lines 1257-1380) but
  // stays LOCAL: nothing is written to the DB until the user clicks the
  // final "Створити поставку" button. Pressing Back creates nothing.
  const { data: offerProductPrefill, isLoading: offerProductPrefillLoading } = useQuery({
    queryKey: ["new-shipment-offer-product-prefill", search.fromOffer],
    enabled: !!search.fromOffer,
    queryFn: async () => {
      const offerId = search.fromOffer!;
      const { data: offer, error: offerErr } = await supabase
        .from("manager_offers")
        .select(
          "id,product_name,origin_country,caliber,variety,pallet_weight,price_per_kg,price_currency,freight_amount,freight_currency,position_id,import_manager_id",
        )
        .eq("id", offerId)
        .maybeSingle();
      if (offerErr) throw offerErr;
      if (!offer) return null;
      const positionId = (offer as { position_id?: string | null }).position_id ?? null;
      if (!positionId) {
        return { blocked: "no_position" as const, offer };
      }
      const [{ data: responses }, { data: allocParts }] = await Promise.all([
        supabase.from("manager_offer_responses").select("approved_pallets").eq("offer_id", offerId),
        supabase.from("manager_offer_allocation_parts").select("pallets, status").eq("offer_id", offerId),
      ]);
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
      const pending = Math.max(0, approvedTotal - orderedTotal - cancelledTotal);
      const palletWeight = Number(offer.pallet_weight ?? 0);
      const desired = palletWeight > 0
        ? Math.min(MAX_PALLETS_PER_OFFER_DRAFT, Math.max(1, Math.floor(TARGET_KG_PER_OFFER_DRAFT / palletWeight)))
        : 0;
      const safePalletCount = Math.min(desired, pending);
      return {
        blocked: false as const,
        offer,
        positionId,
        pending,
        safePalletCount,
        palletWeight,
      };
    },
  });

  // Build B.2 — local draft state. NO DB writes until "Готово".
  // Type lives at module scope (NewShipmentDraftRow) so DraftRowCard can reuse it.
  const [step, setStep] = useState<"header" | "products">("header");
  const [draftRows, setDraftRows] = useState<NewShipmentDraftRow[]>([]);

  // Build B.2 — ProductRef list for engine validation (canonical product names).
  const productRefs = useMemo<ProductRef[]>(
    () => productOptions.map((name) => ({ name })),
    [productOptions],
  );

  const isOfferFlow = !!search.fromOffer;
  const isOfferDraftMode = isOfferFlow && !!offerProductPrefill && !offerProductPrefill.blocked;
  const offerFlowBlocked = isOfferFlow && !!offerProductPrefill && !!offerProductPrefill.blocked;

  // Seed one prefilled draft row from the offer the first time prefill arrives.
  useEffect(() => {
    if (!offerProductPrefill || offerProductPrefill.blocked) return;
    if (draftRows.length > 0) return;
    const o = offerProductPrefill.offer;
    const palWeight = Number(offerProductPrefill.palletWeight ?? 0);
    const pallets = offerProductPrefill.safePalletCount > 0 ? offerProductPrefill.safePalletCount : 1;
    const seedTotal = palWeight * pallets;
    setDraftRows([{
      localId: `tmp_${crypto.randomUUID()}`,
      dbId: null,
      source_offer_id: o.id,
      source_position_id: offerProductPrefill.positionId,
      source_offer_freight_amount: null,
      source_offer_freight_currency: null,
      product_name: canonicalizeProductName(o.product_name ?? "") || (o.product_name ?? ""),
      variety: o.variety ?? "",
      origin_country: normalizeCountry(o.origin_country ?? "") || (o.origin_country ?? ""),
      caliber: o.caliber ?? "",
      sku: "",
      brand: "",
      class: "",
      package_used: "",
      pallet_count: pallets,
      net_weight_kg: seedTotal,
      gross_weight_kg: seedTotal,
      resolver_net_per_pallet_kg: palWeight > 0 ? palWeight : null,
      resolver_gross_per_pallet_kg: palWeight > 0 ? palWeight : null,
      net_auto: true,
      gross_auto: true,
      unit_price: Number(o.price_per_kg ?? 0),
      price_currency: ((o.price_currency ?? "EUR") as "EUR" | "USD"),
      offerLocked: true,
    }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerProductPrefill]);




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

  // Auto-generate code preview: ALIAS-XXX-VVV-YYY (always automatic, no manual override).
  useEffect(() => {
    if (!selectedSupplier) { setCode(""); return; }
    const alias = getSupplierAlias(selectedSupplier);
    const supSeqStr = previewSupSeq ? String(previewSupSeq).padStart(3, "0") : "···";
    if (mode === "existing" && selectedVehicle) {
      // selectedVehicle.code is already in `VVV-YYY` form (or legacy form)
      setCode(`${alias}-${supSeqStr}-${selectedVehicle.code}`.toUpperCase());
    } else if (mode === "new" && country) {
      const cc = getCountryCode(country);
      const vehSeqStr = previewSeq ? String(previewSeq).padStart(3, "0") : "···";
      setCode(`${alias}-${supSeqStr}-${cc}-${vehSeqStr}`.toUpperCase());
    } else {
      setCode("");
    }
  }, [mode, selectedVehicle, selectedSupplier, country, previewSeq, previewSupSeq]);

  // Build 3 — header step does NO DB writes. Just validates the header form
  // and advances to the product-draft step. The single save boundary is
  // finalSave() invoked by "Готово" on the draft step.
  // Build B.3.2B — parses the transport input the same way finalSave does.
  // Returns the parsed number when valid, or a reason code otherwise.
  const parseLogisticsCost = ():
    | { ok: true; value: number }
    | { ok: false; reason: "empty" | "invalid" | "non_positive" } => {
    const t = logisticsCostText.trim().replace(",", ".");
    if (!t) return { ok: false, reason: "empty" };
    const n = Number(t);
    if (!Number.isFinite(n)) return { ok: false, reason: "invalid" };
    if (n <= 0) return { ok: false, reason: "non_positive" };
    return { ok: true, value: n };
  };

  // B.3.2C.1 — live preview wiring. Existing engine + service only. No new
  // queries, no formulas, no DB writes. Reuses computeRowPreview verbatim.
  const customsRefsQ = useQuery(activeCustomsRefsQuery());
  const fxQ = useQuery(latestEurUsdQuery());
  const vehicleContextQ = useQuery(
    vehicleContextQuery(mode === "existing" ? (vehicleId || null) : null),
  );
  const fx = fxQ.data ?? null;
  const fxFailed = !!fxQ.error || fx == null;

  // Vehicle transport → USD (new vehicle only). USD: passthrough. EUR: needs FX.
  const transportUsd = useMemo<number | null>(() => {
    if (mode !== "new") return null;
    const t = logisticsCostText.trim().replace(",", ".");
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (logisticsCurrency === "USD") return n;
    if (logisticsCurrency === "EUR") {
      if (!fx) return null;
      return n * fx;
    }
    return null;
  }, [mode, logisticsCostText, logisticsCurrency, fx]);

  // Preview shipment context (LOCAL only — never persisted before +Створити).
  const previewSh = useMemo(() => {
    if (mode === "new") {
      if (transportUsd == null) return null;
      return { eur_usd_rate: fx, vehicle_id: null, logistics_cost_usd: transportUsd };
    }
    // existing: vehicle freight comes from vehicleContext.shipments; new
    // shipment row's own logistics is null and stays null until +Створити.
    return { eur_usd_rate: fx, vehicle_id: vehicleId || null, logistics_cost_usd: null };
  }, [mode, transportUsd, fx, vehicleId]);

  const previewByLocalId = useMemo(() => {
    const map = new Map<string, DraftPreview>();
    const refs = customsRefsQ.data ?? null;
    const vctx = vehicleContextQ.data ?? null;
    for (const r of draftRows) {
      const { value, components } = computeRowPreview(
        r,
        null,
        previewSh,
        vctx,
        refs,
        fx,
        productRefs,
        false,
        null,
      );
      let reason: string | null = null;
      if (customsRefsQ.error) {
        reason = "Митні дані недоступні.";
      } else if (r.price_currency === "EUR" && r.unit_price > 0 && !fx) {
        reason = "Курс EUR/USD недоступний. Введіть значення вручну в USD";
      } else if (mode === "new" && logisticsCurrency === "EUR" && logisticsCostText.trim() && !fx) {
        reason = "Курс EUR/USD недоступний. Введіть значення вручну в USD";
      } else if (!value) {
        reason = "Заповніть обов'язкові поля";
      }
      map.set(r.localId, { value, components, reason });
    }
    return map;
  }, [
    draftRows,
    previewSh,
    vehicleContextQ.data,
    customsRefsQ.data,
    customsRefsQ.error,
    fx,
    productRefs,
    mode,
    logisticsCurrency,
    logisticsCostText,
  ]);

  // Used by Details to show the whole-vehicle transport line.
  const vehicleTransportLabel = mode === "new" && logisticsCostText.trim()
    ? `${logisticsCostText.trim()} ${logisticsCurrency}`
    : null;


  const onHeaderNext = (e: FormEvent) => {
    e.preventDefault();
    const missing: string[] = [];
    if (!supplierId || !selectedSupplier) missing.push("supplier");
    if (mode === "new") {
      if (!country) missing.push("country");
      if (!loadingDate) missing.push("loadingDate");
      // ETA is mandatory for a new vehicle and must be >= ETD + 1 day.
      // Re-check at submit time — covers the case where ETD was moved
      // forward AFTER a valid ETA was chosen.
      if (!computedEta) {
        missing.push("eta");
      } else if (minEta && computedEta < minEta) {
        missing.push("eta");
      }
      // Build B.3.2B — transport is MANDATORY for a new vehicle.
      // Empty / 0 / negative / non-finite all block the transition.
      const tp = parseLogisticsCost();
      if (!tp.ok) missing.push("logisticsCost");
    } else {
      if (!selectedVehicle) missing.push("vehicle");
    }
    if (missing.length) {
      if (missing.includes("eta") && mode === "new") {
        if (!computedEta) toast.error("Вкажіть дату прибуття (ETA)");
        else toast.error("ETA не може бути раніше за ETD + 1 день");
      }
      if (missing.includes("logisticsCost") && mode === "new") {
        const tp = parseLogisticsCost();
        if (!tp.ok) {
          toast.error(
            tp.reason === "empty"
              ? "Вкажіть вартість перевезення"
              : tp.reason === "non_positive"
                ? "Вартість перевезення має бути більше 0"
                : "Вартість перевезення: некоректне число",
          );
        }
      }
      triggerShake(missing);
      return;
    }
    if (isOfferFlow && offerProductPrefillLoading) {
      toast.error("Дані пропозиції ще завантажуються");
      return;
    }
    if (isOfferFlow && !isOfferDraftMode) {
      toast.error(
        offerFlowBlocked
          ? "Пропозиція недоступна для створення поставки"
          : "Не вдалося завантажити товар з пропозиції",
      );
      return;
    }
    setInvalid(new Set());
    setStep("products");
  };

  // Final save boundary. Inserts vehicle (if new), shipment, all draft items,
  // attaches positions and runs FIFO offer link. Rolls back everything
  // created in THIS attempt on any failure.
  const finalSave = async () => {
    if (draftRows.length === 0) {
      toast.error("Додайте хоча б один товар");
      return;
    }
    // Build B.2 — per-row required-field validation via shared engine helpers.
    // product_name "known" check is intentionally NOT used here so unknown
    // names still reach the rpc_resolve_offer_line_defaults gate below.
    for (const r of draftRows) {
      if (!r.product_name.trim()) {
        toast.error("Заповніть назву товару");
        return;
      }
      const missing = getMissingDraftFields(r, productRefs).filter((k) => k !== "product_name");
      if (missing.includes("pallet_count")) {
        toast.error(`«${r.product_name || "Товар"}»: кількість палет > 0`);
        return;
      }
      if (missing.includes("total_weight")) {
        if (!(r.net_weight_kg > 0)) {
          toast.error(`«${r.product_name}»: нетто > 0`);
          return;
        }
        if (!(r.gross_weight_kg > 0)) {
          toast.error(`«${r.product_name}»: брутто > 0`);
          return;
        }
      }
      if (isNetGreaterThanGross(r)) {
        toast.error(`«${r.product_name}»: нетто не може бути більше брутто`);
        return;
      }
      if (missing.includes("unit_price")) {
        toast.error(`«${r.product_name}»: ціна > 0`);
        return;
      }
      if (missing.includes("origin_country")) {
        toast.error(`«${r.product_name}»: країна походження`);
        return;
      }
      if (r.source_offer_id && offerProductPrefill && !offerProductPrefill.blocked) {
        if (r.pallet_count > offerProductPrefill.pending) {
          toast.error(`Більше за залишок пропозиції (${offerProductPrefill.pending} пал)`);
          return;
        }
      }
    }

    // Capacity hard-block BEFORE any DB writes (incl. existing vehicle load).
    // Build B.2 — draft capacity via shared sumCapacity; existingVehicleLoad
    // keeps its legacy gross→net→pallet*pallet_weight fallback unchanged.
    const existingP = existingVehicleLoad.pallets;
    const existingKg = existingVehicleLoad.gross;
    const draftCap = sumCapacity(draftRows);
    const draftP = draftCap.pallets;
    const draftKg = draftCap.grossKg;
    if (existingP + draftP > VEHICLE_MAX_PALLETS) {
      toast.error(`Перевищено палети авто: ${existingP + draftP} > ${VEHICLE_MAX_PALLETS}`);
      return;
    }
    if (existingKg + draftKg > VEHICLE_MAX_KG) {
      toast.error(`Перевищено вагу авто: ${Math.round(existingKg + draftKg)} > ${VEHICLE_MAX_KG} кг`);
      return;
    }

    // Recognition gate BEFORE any DB writes (vehicle/shipment/items).
    const BLOCKING = new Set(["product_no_match", "product_ambiguous", "country_no_match"]);
    for (const r of draftRows) {
      const product = r.product_name.trim();
      const ctry = r.origin_country.trim();
      if (!product || !ctry) continue;
      try {
        const { data, error } = await supabase.rpc(
          "rpc_resolve_offer_line_defaults" as never,
          {
            p_product_query: product,
            p_country_query: ctry,
            p_package_used: r.package_used.trim() || null,
            p_include_reserve: false,
          } as never,
        );
        if (error) {
          toast.error("Не вдалося перевірити товар. Спробуйте ще раз.");
          return;
        }
        const row = Array.isArray(data) ? (data as unknown[])[0] : data;
        const status = row && typeof row === "object"
          ? ((row as Record<string, unknown>).status as string | undefined)
          : undefined;
        if (status && BLOCKING.has(status)) {
          toast.error(
            status === "country_no_match"
              ? `«${product}»: країну не розпізнано`
              : `«${product}»: товар не розпізнано`,
          );
          return;
        }
      } catch {
        toast.error("Не вдалося перевірити товар. Спробуйте ще раз.");
        return;
      }
    }

    // Parse transport (new vehicle only).
    // Build B.3.2B — defensive gate. Transport is MANDATORY for a new
    // vehicle: empty / 0 / negative / non-finite all block the save and
    // create NO vehicle / shipment / items / positions / FIFO parts.
    let logisticsCostNum: number | null = null;
    if (mode === "new") {
      const tp = parseLogisticsCost();
      if (!tp.ok) {
        toast.error(
          tp.reason === "empty"
            ? "Вкажіть вартість перевезення"
            : tp.reason === "non_positive"
              ? "Вартість перевезення має бути більше 0"
              : "Вартість перевезення: некоректне число",
        );
        setInvalid((prev) => {
          const next = new Set(prev);
          next.add("logisticsCost");
          return next;
        });
        return;
      }
      logisticsCostNum = tp.value;
    }


    setSubmitting(true);
    let createdVehicleId: string | null = null;
    let createdShipmentId: string | null = null;
    const createdItemIds: string[] = [];
    const createdPositionIds: string[] = [];

    const rollback = async () => {
      for (const itemId of createdItemIds) {
        try { await supabase.from("shipment_items").delete().eq("id", itemId); } catch { /* ignore */ }
      }
      for (const pid of createdPositionIds) {
        try { await rollbackBirthPosition(pid); } catch { /* ignore */ }
      }
      if (createdShipmentId) {
        try { await supabase.from("shipments").delete().eq("id", createdShipmentId); } catch { /* ignore */ }
      }
      if (createdVehicleId) {
        try { await supabase.from("vehicles" as never).delete().eq("id", createdVehicleId); } catch { /* ignore */ }
      }
    };

    try {
      let vId = vehicleId;
      let vCode = selectedVehicle?.code ?? "";
      let useCountry = country;
      let useLoadingDate = loadingDate;
      let useEta = computedEta;
      let useDays = days;

      if (mode === "new") {
        const cc = getCountryCode(country);
        const seq = await fetchNextVehicleSequence(cc);
        vCode = formatVehicleCode(cc, seq);
        const { data: vRow, error: vErr } = await supabase
          .from("vehicles" as never)
          .insert({
            code: vCode,
            country,
            country_code: cc,
            sequence_no: seq,
            loading_date: loadingDate,
            eta: computedEta || null,
            logistics_days: days,
            created_by: user?.id ?? null,
          } as never)
          .select("id")
          .single();
        if (vErr) throw vErr;
        vId = (vRow as { id: string }).id;
        createdVehicleId = vId;
      } else {
        if (!selectedVehicle) throw new Error("Виберіть відкрите авто");
        useCountry = selectedVehicle.country;
        useLoadingDate = selectedVehicle.loading_date ?? "";
        useEta = selectedVehicle.eta ?? "";
        useDays = selectedVehicle.eta && selectedVehicle.loading_date
          ? Math.max(0, Math.round((+new Date(selectedVehicle.eta) - +new Date(selectedVehicle.loading_date)) / 86400000))
          : (COUNTRY_DAYS[selectedVehicle.country] ?? 0);
      }

      const alias = getSupplierAlias(selectedSupplier!);
      const supplierSeq = await fetchNextSupplierSequence(supplierId);
      const autoCode = formatShipmentCode({ alias, supplierSeq, vehicleCode: vCode });
      const finalCode = autoCode;

      const shipmentId = crypto.randomUUID();

      const isAdminActor = hasRole(["super_admin", "admin"]);
      const supplierManagerId = selectedSupplier?.import_manager_id ?? null;
      let assignedManagerId: string | null = supplierManagerId;
      if (!assignedManagerId && !isAdminActor) {
        assignedManagerId = currentManagerId ?? null;
      }
      if (!assignedManagerId) {
        await rollback();
        toast.error(
          isAdminActor
            ? "Постачальнику не призначено імпорт-менеджера. Призначте менеджера й повторіть."
            : "Не вдалось визначити імпорт-менеджера для поставки",
        );
        setSubmitting(false);
        return;
      }

      const { error: shipErr } = await supabase
        .from("shipments")
        .insert({
          id: shipmentId,
          code: finalCode,
          supplier_id: supplierId,
          supplier_seq: supplierSeq,
          country: normalizeCountry(useCountry),
          loading_date: useLoadingDate || null,
          logistics_days: useDays,
          eta: useEta || null,
          import_manager_id: assignedManagerId,
          created_by: user?.id ?? null,
          vehicle_id: vId,
          // Transport: only the new-vehicle owner enters logistics.
          logistics_cost: mode === "new" ? logisticsCostNum : null,
          // NOT NULL with DEFAULT 'EUR' — never send null. Pass selected/default currency.
          logistics_cost_currency: logisticsCurrency || "EUR",
        } as never);
      if (shipErr) {
        if (shipErr.code === "23505" || /duplicate|unique/i.test(shipErr.message)) {
          throw new Error("Поставка з таким номером вже існує");
        }
        throw new Error(shipErr.message || "Помилка збереження");
      }
      createdShipmentId = shipmentId;

      // Per-row commit via the authoritative helper.
      for (const r of draftRows) {
        const netKg = Number(r.net_weight_kg) || 0;
        const grossKg = Number(r.gross_weight_kg) || 0;
        // Legacy per-pallet shim (SQL cost trigger still reads pallet_weight).
        const palletWeightShim = r.pallet_count > 0 ? netKg / r.pallet_count : 0;
        const itemPayload: Record<string, unknown> = {
          shipment_id: shipmentId,
          product_name: r.product_name,
          variety: r.variety || null,
          origin_country: normalizeCountry(r.origin_country) || null,
          caliber: r.caliber || null,
          brand: r.brand.trim() || null,
          class: r.class.trim() || null,
          sku: null,
          package_used: r.package_used || null,
          pallet_count: r.pallet_count,
          net_weight_kg: netKg,
          gross_weight_kg: grossKg,
          resolver_net_per_pallet_kg: r.resolver_net_per_pallet_kg,
          resolver_gross_per_pallet_kg: r.resolver_gross_per_pallet_kg,
          net_auto: r.net_auto,
          gross_auto: r.gross_auto,
          pallet_weight: palletWeightShim,
          qty: netKg,
          unit: "kg",
          unit_price: r.unit_price,
          price_currency: r.price_currency,
        };
        const commitRes = await commitNewShipmentItem({
          shipmentId,
          draft: {
            localId: r.localId,
            source_offer_id: r.source_offer_id,
            source_position_id: r.source_position_id,
            product_name: r.product_name,
            origin_country: normalizeCountry(r.origin_country) || "",
            caliber: r.caliber || "",
            package_used: r.package_used || "",
            pallet_count: r.pallet_count,
          },
          payload: itemPayload,
          responsibleManagerId: assignedManagerId,
        });
        if (!commitRes.ok) {
          if (commitRes.createdPositionId) createdPositionIds.push(commitRes.createdPositionId);
          await rollback();
          toast.error(commitRes.reason || "Не вдалося зберегти позицію");
          setSubmitting(false);
          return;
        }
        createdItemIds.push(commitRes.itemId);
        if (commitRes.createdPositionId) createdPositionIds.push(commitRes.createdPositionId);
      }

      qc.invalidateQueries({ queryKey: ["shipments-list"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["dash-manager"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["open-vehicles"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["distribution-list"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["manager-offers"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["manager-offer-responses"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["manager-offer-linked-shipments"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["manager-offer-targets"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["link-dialog-offer"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["shipments-link-options"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["branch-active-offers"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["my-branch-responses"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["branch-offer-shipments"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["nav-branch-manager-offers"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["nav-pending-manager-responses"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["shipment-products"], refetchType: "all" });

      toast.success("Поставку створено");
      navigate({ to: "/shipments" });
    } catch (err: unknown) {
      await rollback();
      qc.invalidateQueries({ queryKey: ["open-vehicles"], refetchType: "all" });
      toast.error(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setSubmitting(false);
    }
  };


  if (loading || !isStaff) {
    return <p className="text-sm text-muted-foreground">Завантаження…</p>;
  }

  const supplierField = (
    <div className={cn("space-y-1.5", invalid.has("supplier") && "field-invalid")}>
      <Label>Постачальник</Label>
      <InlineAutocomplete
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
          if (!raw.trim()) setSupplierId("");
        }}
        placeholder="Оберіть постачальника…"
        browseLimit={5}
        searchLimit={3}
        minSearchLength={2}
        className="w-full"
        inputClassName="h-10 w-full bg-background text-sm"
        inputProps={{ "data-mobile-edit-label": "Постачальник" }}
        renderItem={(item) => (
          <div className="flex flex-col">
            <span className="truncate">{item.name}</span>
            {item.country ? <span className="text-[11px] text-muted-foreground">{toUaCountry(item.country)}</span> : null}
          </div>
        )}
      />
    </div>
  );

  const countryField = (
    <div className={cn("space-y-1.5", invalid.has("country") && "field-invalid")}>
      <Label>Країна завантаження</Label>
      <InlineAutocomplete
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
          }
        }}
        placeholder="Оберіть країну…"
        browseLimit={5}
        searchLimit={3}
        minSearchLength={2}
        className="w-full"
        inputClassName="h-10 w-full bg-background text-sm"
        inputProps={{ "data-mobile-edit-label": "Країна завантаження" }}
        renderItem={(item) => <span className="block truncate">{item.label}</span>}
      />
    </div>
  );

  const codeField = (
    <div className="space-y-1.5">
      <Label htmlFor="code">Номер поставки</Label>
      <Input
        id="code"
        value={code}
        readOnly
        placeholder="GR29-OLI"
        className="bg-secondary/40 font-mono"
      />
      <div className="text-[11px] text-muted-foreground">
        Номер формується автоматично. Остаточний — після створення.
      </div>
    </div>
  );

  const minLoadingDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();
  const loadingDateField = (
    <div className={cn("space-y-1.5", invalid.has("loadingDate") && "field-invalid")}>
      <Label htmlFor="ld">Дата завантаження</Label>
      <Input
        id="ld"
        type="date"
        min={minLoadingDate}
        value={loadingDate}
        onChange={(e) => {
          const v = e.target.value;
          if (v && v < minLoadingDate) {
            toast.error("Дата завантаження не раніше завтрашнього дня");
            return;
          }
          setLoadingDate(v);
          if (v) clearInvalid("loadingDate");
        }}
      />
    </div>
  );

  // ETA cannot be earlier than ETD + 1 day.
  const minEta = (() => {
    const base = loadingDate || minLoadingDate;
    if (!base) return "";
    const d = new Date(base);
    if (Number.isNaN(d.getTime())) return "";
    d.setDate(d.getDate() + 1);
    return toDateInputValue(d);
  })();
  const etaField = (
    <div className={cn("space-y-1.5 rounded-xl border border-dashed border-border bg-secondary/40 p-3", invalid.has("eta") && "field-invalid")}>
      <Label htmlFor="eta-new" className="text-xs uppercase tracking-wider text-muted-foreground">
        Дата прибуття (ETA)
      </Label>
      <Input
        id="eta-new"
        type="date"
        min={minEta || undefined}
        value={computedEta}
        onChange={(e) => {
          const v = e.target.value;
          if (v && minEta && v < minEta) {
            toast.error("ETA не може бути раніше за ETD + 1 день");
            return;
          }
          setEtaOverride(v);
          setEtaTouched(true);
          if (v) clearInvalid("eta");
        }}
      />
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {etaTouched && etaOverride
            ? "Ручне налаштування"
            : autoEta
              ? "Автоматично з країни та дати завантаження"
              : "Заповніть країну та дату завантаження"}
        </span>
        {etaTouched && (
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => {
              setEtaOverride("");
              setEtaTouched(false);
            }}
          >
            Скинути до авто
          </button>
        )}
      </div>
    </div>
  );

  // Read-only ETD/ETA rows for "existing vehicle" mode. Dates belong to the
  // selected open vehicle and MUST NOT be editable here — no input, no
  // picker, no override state copy.
  const vehicleDatesReadOnly = selectedVehicle ? (
    <div className="rounded-xl border border-dashed border-border bg-secondary/40 p-3 text-xs space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground uppercase tracking-wider text-[11px]">ETD (завантаження авто)</span>
        <span className="font-semibold tabular-nums">{selectedVehicle.loading_date ?? "—"}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground uppercase tracking-wider text-[11px]">ETA (прибуття авто)</span>
        <span className="font-semibold tabular-nums">{selectedVehicle.eta ?? "—"}</span>
      </div>
    </div>
  ) : null;

  // Transport entry — new vehicle only. Persisted to shipments on final save.
  // Build B.3.2B — MANDATORY for a new vehicle. Empty / 0 / negative blocks
  // header "Далі" and final "+Створити". Field shows red when invalid;
  // clears the red as soon as a valid positive value is typed.
  const transportInvalid = invalid.has("logisticsCost");
  const transportField = (
    <div
      className={cn(
        "space-y-1.5 rounded-xl border border-dashed border-border bg-secondary/40 p-3",
        transportInvalid && "field-invalid",
      )}
    >
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
        Вартість перевезення <span className="text-destructive">*</span>
      </Label>
      <div className="flex gap-2">
        <Input
          inputMode="decimal"
          placeholder="0,00"
          value={logisticsCostText}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "" || /^[0-9]*[.,]?[0-9]*$/.test(raw)) {
              setLogisticsCostText(raw);
              const n = Number(raw.replace(",", "."));
              if (raw.trim() !== "" && Number.isFinite(n) && n > 0) {
                clearInvalid("logisticsCost");
              }
            }
          }}
          className="flex-1"
        />
        <select
          value={logisticsCurrency}
          onChange={(e) => setLogisticsCurrency(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="EUR">EUR</option>
          <option value="USD">USD</option>
        </select>
      </div>
      <div className="text-[11px] text-muted-foreground">
        Обовʼязково для нового авто. Збережеться при натисканні «Створити».
      </div>
    </div>
  );



  const vehicleField = (
    <div className={cn("space-y-1.5", invalid.has("vehicle") && "field-invalid")}>
      <Label>Відкрите авто</Label>
      <InlineAutocomplete
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
          }
        }}
        placeholder="Оберіть авто…"
        browseLimit={5}
        searchLimit={3}
        minSearchLength={2}
        className="w-full"
        inputClassName="h-10 w-full bg-background text-sm"
        inputProps={{ "data-mobile-edit-label": "Відкрите авто" }}
        renderItem={(item) => (
          <div className="flex flex-col">
            <span className="font-semibold truncate">{item.code} · {item.country}</span>
            <span className="text-[11px] text-muted-foreground">
              {Number(item.total_pallets ?? 0)}/26 пал · {Math.round(Number(item.total_weight_kg ?? 0))}/21500 кг
              {item.suppliersText ? ` · ${item.suppliersText}` : ""}
            </span>
          </div>
        )}
      />
    </div>
  );

  const headerSummary = (
    <div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs space-y-1">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <div><span className="text-muted-foreground">Постачальник: </span><span className="font-semibold">{selectedSupplier?.name ?? "—"}</span></div>
        <div><span className="text-muted-foreground">Номер: </span><span className="font-semibold tabular-nums">{code || "—"}</span></div>
        <div><span className="text-muted-foreground">Країна: </span><span className="font-semibold">{mode === "existing" && selectedVehicle ? selectedVehicle.country : country || "—"}</span></div>
        <div><span className="text-muted-foreground">{mode === "new" ? "Завантаж." : "Авто"}: </span><span className="font-semibold tabular-nums">{mode === "new" ? (loadingDate || "—") : (selectedVehicle?.code ?? "—")}</span></div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 pb-[calc(var(--keyboard-inset,0px)+4.5rem)] md:pb-0">
      {step === "header" && <PageHeader title="Нова поставка" />}


      {step === "header" ? (
        <form onSubmit={onHeaderNext} noValidate className={cn("space-y-4 rounded-2xl border border-border bg-card p-4", shake && "animate-shake")}>
          {/* Mode toggle */}
          <div className="grid grid-cols-2 gap-2">
            <ModeButton active={mode === "new"} onClick={() => { setMode("new"); setVehicleId(""); }}>
              <Plus className="mr-1 h-4 w-4" /> Нове авто
            </ModeButton>
            <ModeButton active={mode === "existing"} onClick={() => setMode("existing")}>
              <Truck className="mr-1 h-4 w-4" /> До відкритого
            </ModeButton>
          </div>

          {mode === "new" ? (
            <>
              {supplierField}
              {countryField}
              {codeField}
              {loadingDateField}
              {etaField}
              {transportField}
            </>
          ) : (
            <>
              {supplierField}
              {selectedVehicle ? <VehicleLockedInfo vehicle={selectedVehicle} ownerName={selectedVehicleOwnerName} /> : countryField}
              {vehicleField}
              {vehicleDatesReadOnly}
              {codeField}
            </>
          )}

          {isOfferFlow && offerProductPrefillLoading && (
            <div className="rounded-xl border border-border bg-secondary/30 p-3 text-sm text-muted-foreground">
              Завантаження товару з пропозиції…
            </div>
          )}
          {offerFlowBlocked && (
            <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              Пропозиція недоступна для створення поставки.
            </div>
          )}

          <Button
            type="submit"
            disabled={submitting || (isOfferFlow && (offerProductPrefillLoading || !isOfferDraftMode))}
            className="w-full bg-brand text-brand-foreground hover:bg-brand/90"
          >
            Далі — товари
          </Button>
        </form>
      ) : (() => {
        // Approved /draft-mockup visual package wired to live draftRows.
        const addEmptyRow = () => setDraftRows((rows) => [
          ...rows,
          {
            localId: `tmp_${crypto.randomUUID()}`,
            dbId: null,
            source_offer_id: null,
            source_position_id: null,
            source_offer_freight_amount: null,
            source_offer_freight_currency: null,
            product_name: "",
            variety: "",
            origin_country: "",
            caliber: "",
            sku: "",
            brand: "",
            class: "",
            package_used: "",
            pallet_count: 1,
            net_weight_kg: 0,
            gross_weight_kg: 0,
            resolver_net_per_pallet_kg: null,
            resolver_gross_per_pallet_kg: null,
            net_auto: true,
            gross_auto: true,
            unit_price: 0,
            price_currency: "EUR",
            offerLocked: false,
          },
        ]);
        const addSimilarRow = () => setDraftRows((rows) => {
          const last = rows[rows.length - 1];
          return [
            ...rows,
            {
              localId: `tmp_${crypto.randomUUID()}`,
              dbId: null,
              source_offer_id: null,
              source_position_id: null,
              source_offer_freight_amount: null,
              source_offer_freight_currency: null,
              product_name: last?.product_name ?? "",
              variety: last?.variety ?? "",
              origin_country: last?.origin_country ?? "",
              caliber: last?.caliber ?? "",
              sku: "",
              brand: last?.brand ?? "",
              class: last?.class ?? "",
              package_used: last?.package_used ?? "",
              pallet_count: 1,
              net_weight_kg: last?.resolver_net_per_pallet_kg ? Number(last.resolver_net_per_pallet_kg) : 0,
              gross_weight_kg: last?.resolver_gross_per_pallet_kg ? Number(last.resolver_gross_per_pallet_kg) : 0,
              resolver_net_per_pallet_kg: last?.resolver_net_per_pallet_kg ?? null,
              resolver_gross_per_pallet_kg: last?.resolver_gross_per_pallet_kg ?? null,
              net_auto: true,
              gross_auto: true,
              unit_price: 0,
              price_currency: (last?.price_currency ?? "EUR") as "EUR" | "USD",
              offerLocked: false,
            },
          ];
        });
        // Build B.2 — shared draft capacity via engine sumCapacity.
        const draftCap = sumCapacity(draftRows);
        const draftPallets = draftCap.pallets;
        const draftGross = draftCap.grossKg;
        // Combine with existing committed load when topping up an open vehicle,
        // so the strip never hides an overload behind a positive remainder.
        const totalPallets = draftPallets + existingVehicleLoad.pallets;
        const totalGross = draftGross + existingVehicleLoad.gross;
        const capPallets = MAX_PALLETS_PER_OFFER_DRAFT;
        const capGross = VEHICLE_MAX_KG;
        const remainPallets = capPallets - totalPallets;
        const remainGross = capGross - totalGross;
        const fmt = (n: number) => Math.round(n).toLocaleString("uk-UA").replace(/,/g, " ");
        return (
        <div className="shipments-new-products -mx-4 md:mx-0">
          {/* Sticky capacity strip — approved mockup */}
          <div className="sticky top-0 z-30 border-b border-border/60 bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/75">
            <div className="mx-auto flex w-full max-w-[460px] items-center justify-between gap-2 whitespace-nowrap text-[11.5px] leading-tight tabular-nums">
              <span><span className="text-muted-foreground">Палети </span><span className="font-semibold">{totalPallets}/{capPallets}</span></span>
              <span className="text-border">·</span>
              <span><span className="text-muted-foreground">Брутто </span><span className="font-semibold">{fmt(totalGross)}/{fmt(capGross)}</span></span>
              <span className="text-border">·</span>
              <span><span className="text-muted-foreground">Залишок </span><span className="font-semibold">{remainPallets} / {fmt(remainGross)}</span></span>
            </div>
          </div>

          <div className="px-2 pb-6 pt-3">
            <div className="mx-auto w-full max-w-[460px] space-y-2.5">
              {draftRows.length === 0 && (
                <div className="rounded-xl border border-dashed border-border bg-secondary/20 p-3 text-center text-sm text-muted-foreground">
                  Додайте хоча б один товар і натисніть «Створити».
                </div>
              )}

              {draftRows.map((r, idx) => (
                <DraftRowCard
                  key={r.localId}
                  row={r}
                  index={idx}
                  onChange={(patch) => setDraftRows((rows) => rows.map((x) => x.localId === r.localId ? { ...x, ...patch } : x))}
                  onRemove={() => setDraftRows((rows) => rows.filter((x) => x.localId !== r.localId))}
                  offerPending={r.source_offer_id && offerProductPrefill && !offerProductPrefill.blocked ? offerProductPrefill.pending : null}
                  productOptions={productOptions}
                  productAliases={productAliases}
                  countryOptions={countryOptions}
                  countryAliases={countryAliases}
                  supplierName={selectedSupplier?.name || ""}
                  shipmentCode={code}
                  preview={previewByLocalId.get(r.localId) ?? null}
                  vehicleTransportLabel={vehicleTransportLabel}
                />

              ))}

              {/* Footer buttons — approved mockup */}
              <div className="space-y-1.5 pt-1">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={addEmptyRow}
                    className="h-11 rounded-full border-2 border-white/90 bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    + Додати товар
                  </button>
                  <button
                    type="button"
                    onClick={addSimilarRow}
                    disabled={draftRows.length === 0}
                    className="h-11 rounded-full border-2 border-primary/70 bg-primary/10 px-3 text-[13px] font-semibold text-primary disabled:opacity-50"
                  >
                    + Аналогічний
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div aria-hidden="true" />
                  <VelvetCosmicCreateButton
                    label={submitting ? "Створення…" : "+Створити"}
                    disabled={submitting || draftRows.length === 0}
                    onClick={() => { if (!submitting && draftRows.length > 0) void finalSave(); }}
                    className="shipments-new-velvet-create"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
        );
      })()}


      {mobileEditingLabel && step === "header" && (
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
              onClick={blurAndCloseEditors}
              className="h-9 shrink-0 bg-brand px-4 text-brand-foreground hover:bg-brand/90"
            >
              Готово
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Build B.2 — DraftRowCard reuses the route-level NewShipmentDraftRow type.
type DraftRowShape = NewShipmentDraftRow;

// Permissive decimal pattern: "", "0", "0,", "0,5", "0.5", "12", "12.34".
const DECIMAL_RE = /^[0-9]*[.,]?[0-9]*$/;
const parseDecimal = (s: string): number | null => {
  const t = s.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const formatDecimal = (n: number): string => {
  if (!Number.isFinite(n) || n === 0) return "";
  // Preserve up to 4 decimals but trim trailing zeros.
  return String(Math.round(n * 10000) / 10000);
};

function DraftRowCard({
  row,
  index,
  onChange,
  onRemove,
  offerPending,
  productOptions,
  productAliases,
  countryOptions,
  countryAliases,
  supplierName,
  shipmentCode,
  preview,
  vehicleTransportLabel,
}: {
  row: DraftRowShape;
  index: number;
  onChange: (patch: Partial<DraftRowShape>) => void;
  onRemove: () => void;
  offerPending: number | null;
  productOptions: string[];
  productAliases: Record<string, string>;
  countryOptions: string[];
  countryAliases: Record<string, string>;
  supplierName: string;
  shipmentCode: string;
  preview: DraftPreview | null;
  vehicleTransportLabel: string | null;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const tooManyOffer = offerPending != null && row.pallet_count > offerPending;
  const varieties = useVarietiesFor(row.product_name);
  const { data: palletResolved } = usePalletResolver(row.product_name, row.origin_country);
  const packageOptions: PackageOption[] = palletResolved?.options ?? [];
  const packageItems = useMemo(
    () => packageOptions.map((opt, i) => ({
      ...opt,
      key: `${opt.package_used}|${opt.pallet_net_kg ?? ""}|${opt.pallet_gross_kg ?? ""}|${i}`,
      label: opt.package_used,
      searchStrings: [opt.package_used, opt.pallet_size ?? ""].filter(Boolean) as string[],
    })),
    [packageOptions],
  );

  // Local text states for price/net/gross — needed to accept partial entries
  // like "0," before the user types the second digit.
  const [priceText, setPriceText] = useState<string>(formatDecimal(row.unit_price));
  const [netText, setNetText] = useState<string>(formatDecimal(row.net_weight_kg));
  const [grossText, setGrossText] = useState<string>(formatDecimal(row.gross_weight_kg));
  // Sync from external row changes (offer prefill, package auto-fill, pallet_count recompute).
  useEffect(() => {
    const parsed = parseDecimal(priceText);
    if (parsed !== row.unit_price) setPriceText(formatDecimal(row.unit_price));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.unit_price]);
  useEffect(() => {
    const parsed = parseDecimal(netText);
    if (parsed !== row.net_weight_kg) setNetText(formatDecimal(row.net_weight_kg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.net_weight_kg]);
  useEffect(() => {
    const parsed = parseDecimal(grossText);
    if (parsed !== row.gross_weight_kg) setGrossText(formatDecimal(row.gross_weight_kg));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.gross_weight_kg]);

  const pillInput = "snp-pill-input";
  // Header shows ONLY supplier name. No fallback to product/brand. Empty supplier → dash.
  const headerTitle = (supplierName || "—").toUpperCase();
  const headerSub = shipmentCode || `Товар №${index + 1}`;

  const handlePalletCountChange = (raw: string) => {
    const n = Number(raw) || 0;
    const patch: Partial<DraftRowShape> = { pallet_count: n };
    if (row.net_auto && row.resolver_net_per_pallet_kg && n > 0) {
      patch.net_weight_kg = n * row.resolver_net_per_pallet_kg;
    }
    if (row.gross_auto && row.resolver_gross_per_pallet_kg && n > 0) {
      patch.gross_weight_kg = n * row.resolver_gross_per_pallet_kg;
    }
    onChange(patch);
  };

  return (
    <section className="snp-card rounded-2xl border border-border bg-card p-3 shadow">
      {/* Header — single row: Постачальник · Номер · Видалити */}
      <div className="mb-2.5 flex items-center justify-between gap-3 border-b border-border/60 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate text-[15px] font-semibold leading-tight uppercase">{headerTitle}</span>
          <span className="shrink-0 text-border">·</span>
          <span className="truncate text-[11px] font-medium text-muted-foreground tabular-nums">{headerSub}</span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="snp-muted-red shrink-0 text-[12px] font-medium hover:opacity-80"
        >
          Видалити
        </button>
      </div>

      <div className="space-y-2">
        {/* Row: Товар / Походження */}
        <div className="grid grid-cols-2 gap-2">
          <PillSlot label="Товар" required hasValue={!!row.product_name}>
            <AutocompleteCell
              value={row.product_name}
              onChange={(v) => onChange({ product_name: v })}
              options={productOptions}
              aliases={productAliases}
              placeholder="Товар"
              readOnly={row.offerLocked}
              expandedMinWidth={220}
              className={pillInput}
            />
          </PillSlot>
          <PillSlot label="Походження" required hasValue={!!row.origin_country}>
            <AutocompleteCell
              value={row.origin_country}
              onChange={(v) => onChange({ origin_country: v })}
              options={countryOptions}
              aliases={countryAliases}
              placeholder="Походження"
              readOnly={row.offerLocked}
              expandedMinWidth={200}
              className={pillInput}
            />
          </PillSlot>
        </div>

        {/* Row: Сорт / Бренд */}
        <div className="grid grid-cols-2 gap-2">
          <PillSlot label="Сорт" hasValue={!!row.variety}>
            <VarietyAutocomplete
              value={row.variety}
              onChange={(v) => onChange({ variety: v })}
              varieties={varieties}
              placeholder="Сорт"
              disabled={row.offerLocked}
              expandedMinWidth={200}
              inputClassName={pillInput}
            />
          </PillSlot>
          <PillSlot label="Бренд" hasValue={!!row.brand}>
            <input
              value={row.brand}
              onChange={(e) => onChange({ brand: e.target.value })}
              placeholder="Бренд"
              className={pillInput}
            />
          </PillSlot>
        </div>

        {/* Row: Калібр / Клас */}
        <div className="grid grid-cols-2 gap-2">
          <PillSlot label="Калібр" hasValue={!!row.caliber}>
            <input
              value={row.caliber}
              onChange={(e) => onChange({ caliber: e.target.value })}
              disabled={row.offerLocked}
              placeholder="Калібр"
              className={pillInput}
            />
          </PillSlot>
          <PillSlot label="Клас" hasValue={!!row.class}>
            <select
              value={row.class}
              onChange={(e) => onChange({ class: e.target.value })}
              className={cn(pillInput, "appearance-none bg-transparent")}
            >
              <option value="">Клас</option>
              <option value="екстра">екстра</option>
              <option value="1ий">1ий</option>
              <option value="1біс">1біс</option>
              <option value="2ий">2ий</option>
              <option value="індустрі">індустрі</option>
            </select>
          </PillSlot>
        </div>

        {/* Упаковка — full width */}
        <PillSlot label="Пакування" required hasValue={!!row.package_used}>
          <InlineAutocomplete
            value={row.package_used}
            onValueChange={(v) => onChange({ package_used: v })}
            items={packageItems}
            getKey={(item) => item.key}
            getLabel={(item) => item.label}
            getSearchStrings={(item) => item.searchStrings}
            onSelect={(item) => {
              const patch: Partial<DraftRowShape> = { package_used: item.package_used };
              const pc = row.pallet_count > 0 ? row.pallet_count : 0;
              const netPer = item.pallet_net_kg != null && item.pallet_net_kg > 0 ? Number(item.pallet_net_kg) : null;
              const grossPer = item.pallet_gross_kg != null && item.pallet_gross_kg > 0 ? Number(item.pallet_gross_kg) : null;
              patch.resolver_net_per_pallet_kg = netPer;
              patch.resolver_gross_per_pallet_kg = grossPer;
              // Auto-fill totals only when the field is in auto mode.
              if (row.net_auto && netPer && pc > 0) patch.net_weight_kg = pc * netPer;
              if (row.gross_auto && grossPer && pc > 0) patch.gross_weight_kg = pc * grossPer;
              onChange(patch);
            }}
            placeholder={row.product_name ? "Пакування" : "Спочатку виберіть товар"}
            expandedMinWidth={240}
            browseLimit={50}
            searchLimit={3}
            minSearchLength={2}
            inputClassName={pillInput}
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
        </PillSlot>

        {/* Row: К-ть палет / Нетто / Брутто */}
        <div className="grid grid-cols-3 gap-2">
          <PillSlot
            label={offerPending != null ? `Палет (${offerPending})` : "Палет"}
            required
            hasValue={!!row.pallet_count}
            errored={tooManyOffer}
          >
            <input
              type="text"
              inputMode="numeric"
              value={row.pallet_count || ""}
              onChange={(e) => {
                const raw = e.target.value;
                // Pallet count is an integer; allow only digits.
                if (raw !== "" && !/^[0-9]+$/.test(raw)) return;
                handlePalletCountChange(raw);
              }}
              placeholder="Палет"
              className={pillInput}
            />
          </PillSlot>
          <PillSlot label="Нетто, кг" required hasValue={row.net_weight_kg > 0}>
            <input
              type="text"
              inputMode="decimal"
              value={netText}
              onChange={(e) => {
                const raw = e.target.value;
                if (!DECIMAL_RE.test(raw)) return;
                setNetText(raw);
                const n = parseDecimal(raw);
                onChange({ net_weight_kg: n ?? 0, net_auto: false });
              }}
              placeholder="Нетто"
              className={pillInput}
            />
          </PillSlot>
          <PillSlot label="Брутто, кг" required hasValue={row.gross_weight_kg > 0}>
            <input
              type="text"
              inputMode="decimal"
              value={grossText}
              onChange={(e) => {
                const raw = e.target.value;
                if (!DECIMAL_RE.test(raw)) return;
                setGrossText(raw);
                const n = parseDecimal(raw);
                onChange({ gross_weight_kg: n ?? 0, gross_auto: false });
              }}
              placeholder="Брутто"
              className={pillInput}
            />
          </PillSlot>
        </div>

        {/* Row: Ціна за кг / Валюта */}
        <div className="grid grid-cols-2 gap-2">
          <PillSlot label="Ціна за кг" required hasValue={row.unit_price > 0}>
            <input
              type="text"
              inputMode="decimal"
              value={priceText}
              onChange={(e) => {
                const raw = e.target.value;
                if (!DECIMAL_RE.test(raw)) return;
                setPriceText(raw);
                const n = parseDecimal(raw);
                onChange({ unit_price: n ?? 0 });
              }}
              placeholder="0,50"
              className={pillInput}
            />
          </PillSlot>
          <PillSlot label="Валюта" hasValue={!!row.price_currency}>
            <input
              value={row.price_currency}
              onChange={(e) => onChange({ price_currency: e.target.value.toUpperCase() as "EUR" | "USD" })}
              maxLength={3}
              placeholder="EUR"
              className={pillInput}
            />
          </PillSlot>
        </div>

        {/* B.3.2C.1 — live cost block. All values come from computeRowPreview
            in the parent; this card never recomputes FX/customs/transport. */}
        {(() => {
          const c = preview?.components;
          const v = preview?.value ?? null;
          const reason = preview?.reason ?? null;
          const fmt2 = (n: number | null | undefined) =>
            n != null && Number.isFinite(n) ? n.toFixed(2) : "—";
          const fmt4 = (n: number | null | undefined) =>
            n != null && Number.isFinite(n) ? n.toFixed(4) : "—";
          const showFxLine =
            !!(c?.fxRate) ||
            (vehicleTransportLabel ? /EUR/i.test(vehicleTransportLabel) : false);
          const basisLabel =
            c?.customsBasis === "exact" ? "знайдено"
            : c?.customsBasis === "fallback" ? "країну не знайдено"
            : c?.customsBasis === "manual" ? "вручну"
            : "не знайдена";
          const usedEur = c?.inputCurrency === "EUR" || (vehicleTransportLabel ? /EUR/i.test(vehicleTransportLabel) : false);
          return (
            <div className="mt-2 rounded-xl border border-border/60 bg-background/40 p-2.5">
              <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Розрахунок собівартості</span>
                <button
                  type="button"
                  onClick={() => setDetailsOpen((x) => !x)}
                  className="inline-flex items-center gap-0.5 text-[10px] font-medium text-primary hover:opacity-80"
                >
                  Деталі {detailsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              </div>

              <div className="space-y-0.5 text-[11.5px] tabular-nums">
                {showFxLine && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Курс EUR/USD</span>
                    <span className="font-medium">{fmt4(c?.fxRate ?? null)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Митна база</span>
                  <span className="font-medium">{basisLabel}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Вартість перевезення, $/кг</span>
                  <span className="font-medium">{fmt4(c?.transportPerKg ?? null)}</span>
                </div>
              </div>

              <div className="mt-1.5 flex items-center justify-between border-t border-border/40 pt-1.5 text-[12px] font-bold tabular-nums">
                <span>Собівартість, $/кг</span>
                {v ? (
                  <CostPair indicative={v.indicative} invoice={v.invoice} size="sm" />
                ) : (
                  <span className="text-[10px] font-medium text-muted-foreground/80">
                    {reason ?? "Заповніть обов'язкові поля"}
                  </span>
                )}
              </div>

              {detailsOpen && (
                <div className="mt-2 space-y-0.5 border-t border-border/40 pt-2 text-[11px] tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ціна товару</span>
                    <span className="font-medium">
                      {c?.inputPrice != null ? `${fmt2(c.inputPrice)} ${c.inputCurrency ?? ""}` : "—"}
                    </span>
                  </div>
                  {usedEur && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Курс EUR/USD</span>
                      <span className="font-medium">{fmt4(c?.fxRate ?? null)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ціна товару, $/кг</span>
                    <span className="font-medium">{fmt4(c?.unitUsd ?? null)}</span>
                  </div>
                  {vehicleTransportLabel && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Вартість транспорту (авто)</span>
                      <span className="font-medium">{vehicleTransportLabel}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Вартість перевезення, $/кг</span>
                    <span className="font-medium">{fmt4(c?.transportPerKg ?? null)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Мито індикатив, $/кг</span>
                    <span className="font-medium">{fmt4(c?.customsIndicative ?? null)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Мито інвойс, $/кг</span>
                    <span className="font-medium">{fmt4(c?.customsInvoice ?? null)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Собівартість індикативна, $/кг</span>
                    <span className="font-medium">{v ? fmt4(v.indicative) : "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Собівартість інвойсна, $/кг</span>
                    <span className="font-medium">{v ? fmt4(v.invoice) : "—"}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })()}

      </div>
    </section>
  );
}


function PillSlot({
  label,
  required = false,
  hasValue,
  errored = false,
  deferred = false,
  children,
}: {
  label: string;
  required?: boolean;
  hasValue: boolean;
  errored?: boolean;
  deferred?: boolean;
  children?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const showFloating = focused || hasValue;
  return (
    <div
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
      className={cn(
        "snp-pill relative h-11 rounded-full",
        focused && "is-focused",
        errored && "is-error",
        deferred && "is-deferred",
      )}
      data-required={required ? "true" : undefined}
    >
      {showFloating && !deferred && (
        <span className={cn("snp-pill-label pointer-events-none absolute left-4 top-1 z-10 text-[9px] font-medium uppercase tracking-wide leading-none", required ? "snp-muted-red" : "snp-pill-label-opt")}>
          {label}
        </span>
      )}
      {children}
      {!focused && !hasValue && (
        <span className="snp-pill-placeholder pointer-events-none absolute inset-0 flex items-center justify-center text-[13px]">
          {label}
        </span>
      )}
    </div>
  );
}



function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-10 items-center justify-center rounded-md border px-3 text-sm font-semibold transition",
        active
          ? "border-brand bg-brand text-brand-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}


function VehicleLockedInfo({ vehicle, ownerName }: { vehicle: OpenVehicle; ownerName: string }) {
  const loadedP = Number(vehicle.total_pallets ?? 0);
  const loadedKg = Number(vehicle.total_weight_kg ?? 0);
  const freeP = Math.max(0, VEHICLE_MAX_PALLETS - loadedP);
  const freeKg = Math.max(0, VEHICLE_MAX_KG - loadedKg);
  const sups = (vehicle.shipments ?? []).map((s) => s.suppliers?.name).filter(Boolean).join(", ");
  const ownerShipment = (vehicle.shipments ?? []).find((shipment) => shipment.created_by === vehicle.created_by) ?? (vehicle.shipments ?? []).find((shipment) => Number(shipment.logistics_cost ?? 0) > 0) ?? null;
  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label className="flex items-center gap-1 text-muted-foreground">
          <Lock className="h-3 w-3" /> Країна (зафіксована для авто)
        </Label>
        <div className="flex h-10 w-full items-center rounded-md border border-dashed border-border bg-secondary/40 px-3 text-sm font-semibold">
          {vehicle.country}
        </div>
      </div>
      <div className="rounded-xl border border-border bg-secondary/30 p-3 text-xs">
        <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Завантаження авто</div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-muted-foreground">Фрахт</div>
            <div className="font-semibold tabular-nums">
              {ownerShipment && Number(ownerShipment.logistics_cost ?? 0) > 0
                ? `${Number(ownerShipment.logistics_cost ?? 0).toFixed(2)} ${ownerShipment.logistics_cost_currency ?? "EUR"}`
                : "Не вказано"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Вже завантажено</div>
            <div className="font-semibold tabular-nums">{loadedP} пал · {Math.round(loadedKg)} кг</div>
          </div>
          <div>
            <div className="text-muted-foreground">Вільно</div>
            <div className={cn("font-semibold tabular-nums", freeP <= 1 ? "text-destructive" : "text-success")}>
              {freeP} пал · {Math.round(freeKg)} кг
            </div>
          </div>
          <div>
            <div className="text-muted-foreground">Маршрут</div>
            <div className="font-semibold tabular-nums">{vehicle.country}</div>
          </div>
        </div>
        {sups && (
          <div className="mt-2 text-[11px] text-muted-foreground">
            Постачальники в авто: <span className="text-foreground">{sups}</span>
          </div>
        )}
        <div className="mt-2 text-[11px] text-muted-foreground">
          Власник авто: <span className="text-foreground">{ownerName}</span>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          Транспорт оплачує менеджер-власник авто. Для вашої поставки вартість транспорту вводити не потрібно.
        </div>
      </div>

      {(() => {
        const productNames = Array.from(
          new Set(
            (vehicle.shipments ?? [])
              .flatMap((s) => s.shipment_items ?? [])
              .map((it) => (it.product_name ?? "").trim())
              .filter((name) => name && name !== "Новий товар"),
          ),
        );
        if (productNames.length === 0) return null;
        return (
          <div className="rounded-xl border-2 border-amber-500/60 bg-amber-500/10 p-3.5 text-sm space-y-2 shadow-[0_0_0_3px_rgba(245,158,11,0.08)]">
            <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-semibold text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>Товари в авто — перевірте сумісність</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {productNames.map((name) => (
                <span key={name} className="rounded-full bg-background border border-amber-500/40 px-2.5 py-1 text-sm font-semibold text-foreground">
                  {name}
                </span>
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// (OfferDraftSummary removed in Build 3 — replaced by real draft product step.)
