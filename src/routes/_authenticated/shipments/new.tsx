import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useCallback, type FormEvent } from "react";
import { Truck, Plus, Lock, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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

const MAX_PALLETS_PER_OFFER_DRAFT = 26;
const TARGET_KG_PER_OFFER_DRAFT = 21000;

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
  const [codeOverride, setCodeOverride] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [etaOverride, setEtaOverride] = useState<string>("");
  const [etaTouched, setEtaTouched] = useState(false);

  const [supplierInput, setSupplierInput] = useState("");
  const [countryInput, setCountryInput] = useState("");
  const countryOptions = useCountryOptions();
  const countryAliases = useCountryAliases();
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
        .select("id,code,country,country_code,loading_date,eta,total_pallets,total_weight_kg,created_by,shipments(id,code,logistics_cost,logistics_cost_currency,created_by,suppliers(name),shipment_items(id,product_name,variety,caliber,pallet_count))")
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
  const { data: offerProductPrefill } = useQuery({
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

  const [offerDraftPallets, setOfferDraftPallets] = useState<number>(0);
  // Seed editable pallet count once when prefill arrives.
  useEffect(() => {
    if (!offerProductPrefill || offerProductPrefill.blocked) return;
    if (offerDraftPallets > 0) return;
    if (offerProductPrefill.safePalletCount > 0) {
      setOfferDraftPallets(offerProductPrefill.safePalletCount);
    }
  }, [offerProductPrefill, offerDraftPallets]);

  const isOfferDraftMode = !!search.fromOffer && !!offerProductPrefill && !offerProductPrefill.blocked;



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

  // Auto-generate code preview: ALIAS-XXX-VVV-YYY
  useEffect(() => {
    if (codeOverride) return;
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
  }, [mode, selectedVehicle, selectedSupplier, country, codeOverride, previewSeq, previewSupSeq]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const missing: string[] = [];
    if (!supplierId || !selectedSupplier) missing.push("supplier");
    if (mode === "new") {
      if (!country) missing.push("country");
      if (!loadingDate) missing.push("loadingDate");
    } else {
      if (!selectedVehicle) missing.push("vehicle");
    }
    if (missing.length) {
      triggerShake(missing);
      return;
    }
    // Build 2A — offer-draft validation: pallets must be in (0, pending].
    if (isOfferDraftMode && offerProductPrefill && !offerProductPrefill.blocked) {
      const pc = Number(offerDraftPallets);
      if (!Number.isFinite(pc) || pc <= 0) {
        toast.error("Вкажіть кількість палет більше 0");
        return;
      }
      if (pc > offerProductPrefill.pending) {
        toast.error(`Більше за залишок пропозиції (${offerProductPrefill.pending} пал)`);
        return;
      }
    }
    setInvalid(new Set());


    setSubmitting(true);
    // Track a freshly-created vehicle so we can roll it back if the
    // subsequent shipment INSERT fails. Without this, a failed creation
    // leaves an orphan vehicle in the "open vehicles" list with no
    // shipments inside (looks "underloaded" and unowned).
    let createdVehicleIdForRollback: string | null = null;
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
        createdVehicleIdForRollback = vId;
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
      const finalCode = codeOverride && code.trim() ? code.trim() : autoCode;

      const shipmentId = crypto.randomUUID();

      // Phase 2 strict manager assignment.
      // Rule: supplier known → manager comes from the supplier's assignment.
      //       No assignment → block.
      //       admin/super_admin never silently become the responsible manager
      //       (no fallback to currentManagerId for those roles).
      const isAdminActor = hasRole(["super_admin", "admin"]);
      const supplierManagerId = selectedSupplier?.import_manager_id ?? null;
      let assignedManagerId: string | null = supplierManagerId;
      if (!assignedManagerId && !isAdminActor) {
        // Import manager flow: they own their own shipment when the supplier
        // has no explicit assignment yet.
        assignedManagerId = currentManagerId ?? null;
      }
      if (!assignedManagerId) {
        // Roll back the vehicle we just created — otherwise the manager
        // sees a phantom "open vehicle" with no owner.
        if (createdVehicleIdForRollback) {
          await supabase.from("vehicles" as never).delete().eq("id", createdVehicleIdForRollback);
          createdVehicleIdForRollback = null;
        }
        toast.error(
          isAdminActor
            ? "Постачальнику не призначено імпорт-менеджера. Призначте менеджера й повторіть."
            : "Не вдалось визначити імпорт-менеджера для поставки",
        );
        setSubmitting(false);
        return;
      }

      const insertPayload = {
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
      } as never;

      const { error } = await supabase
        .from("shipments")
        .insert(insertPayload);

      if (error) {
        if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
          throw new Error("Поставка з таким номером вже існує");
        }
        throw new Error(error.message || "Помилка збереження");
      }

      // Build 1 (final) — offer-draft commit happens inline here, NOT on the
      // products page. We must hold both the vehicle and shipment rollback
      // handles until commitNewShipmentItem succeeds. If it fails we
      // unwind: shipment_item is removed by the helper, then we delete the
      // shipment + vehicle and roll back any freshly-minted position.
      if (isOfferDraftMode && offerProductPrefill && !offerProductPrefill.blocked) {
        const offer = offerProductPrefill.offer;
        const pc = Number(offerDraftPallets);
        const palletWeight = Number(offerProductPrefill.palletWeight ?? 0);
        const netKg = pc * (palletWeight > 0 ? palletWeight : 0);
        const grossKg = netKg;
        const resolvedName =
          canonicalizeProductName(offer.product_name ?? "") ||
          (offer.product_name ?? "");
        const itemPayload: Record<string, unknown> = {
          shipment_id: shipmentId,
          product_name: resolvedName,
          variety: offer.variety || null,
          origin_country: normalizeCountry(offer.origin_country ?? "") || null,
          caliber: offer.caliber || null,
          sku: null,
          package_used: null,
          pallet_count: pc,
          net_weight_kg: netKg,
          gross_weight_kg: grossKg,
          resolver_net_per_pallet_kg: null,
          resolver_gross_per_pallet_kg: null,
          net_auto: false,
          gross_auto: false,
          pallet_weight: palletWeight > 0 ? palletWeight : 0,
          qty: netKg,
          unit: "kg",
          unit_price: Number(offer.price_per_kg ?? 0),
          price_currency: (offer.price_currency ?? "EUR"),
        };
        const localId = `tmp_${crypto.randomUUID()}`;
        const commitRes = await commitNewShipmentItem({
          shipmentId,
          draft: {
            localId,
            source_offer_id: offer.id,
            source_position_id: offerProductPrefill.positionId,
            product_name: resolvedName,
            origin_country: normalizeCountry(offer.origin_country ?? "") || "",
            caliber: offer.caliber || "",
            package_used: "",
            pallet_count: pc,
          },
          payload: itemPayload,
          responsibleManagerId: assignedManagerId,
        });
        if (!commitRes.ok) {
          // Unwind: shipment first (FK guards prevent later vehicle delete
          // otherwise), then vehicle, then any freshly-created position.
          try {
            await supabase.from("shipments").delete().eq("id", shipmentId);
          } catch { /* swallow */ }
          if (createdVehicleIdForRollback) {
            try {
              await supabase.from("vehicles" as never).delete().eq("id", createdVehicleIdForRollback);
            } catch { /* swallow */ }
            createdVehicleIdForRollback = null;
          }
          if (commitRes.createdPositionId) {
            await rollbackBirthPosition(commitRes.createdPositionId);
          }
          qc.invalidateQueries({ queryKey: ["open-vehicles"], refetchType: "all" });
          toast.error(commitRes.reason || "Не вдалося зберегти позицію");
          setSubmitting(false);
          return;
        }
      }

      // Shipment committed — vehicle is no longer orphan, cancel rollback.
      createdVehicleIdForRollback = null;

      // refetchType: "all" — force background refetch even on unmounted lists,
      // so the manager's /shipments table is fresh on the next navigation
      // without requiring a manual page refresh.
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
      if (isOfferDraftMode) {
        toast.success("Поставку створено");
        navigate({ to: "/shipments" });
      } else {
        toast.success("Поставку створено. Додайте позиції товарів.");
        navigate({
          to: "/shipments/$id/products",
          params: { id: shipmentId },
          search: search.fromOffer ? { fromOffer: search.fromOffer } : {},
        } as never);
      }
    } catch (err: unknown) {
      // Roll back orphan vehicle from a failed mode="new" creation.
      // Best-effort: if delete itself fails (FK from a parallel write, RLS),
      // we still surface the original error to the user.
      if (createdVehicleIdForRollback) {
        try {
          await supabase
            .from("vehicles" as never)
            .delete()
            .eq("id", createdVehicleIdForRollback);
        } catch {
          /* swallow rollback failure */
        }
        createdVehicleIdForRollback = null;
        qc.invalidateQueries({ queryKey: ["open-vehicles"], refetchType: "all" });
      }
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
      <div className="flex gap-2">
        <Input
          id="code"
          value={code}
          onChange={(e) => { setCode(e.target.value); setCodeOverride(true); }}
          readOnly={!codeOverride}
          placeholder="GR29-OLI"
          className={cn(!codeOverride && "bg-secondary/40 font-mono")}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setCodeOverride((v) => !v)}
        >
          {codeOverride ? "Авто" : "✎"}
        </Button>
      </div>
    </div>
  );

  const loadingDateField = (
    <div className={cn("space-y-1.5", invalid.has("loadingDate") && "field-invalid")}>
      <Label htmlFor="ld">Дата завантаження</Label>
      <Input id="ld" type="date" value={loadingDate} onChange={(e) => { setLoadingDate(e.target.value); if (e.target.value) clearInvalid("loadingDate"); }} />
    </div>
  );

  const etaField = (
    <div className="space-y-1.5 rounded-xl border border-dashed border-border bg-secondary/40 p-3">
      <Label htmlFor="eta-new" className="text-xs uppercase tracking-wider text-muted-foreground">
        Дата прибуття (ETA)
      </Label>
      <Input
        id="eta-new"
        type="date"
        value={computedEta}
        onChange={(e) => {
          setEtaOverride(e.target.value);
          setEtaTouched(true);
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

  return (
    <div className="space-y-4 pb-[calc(var(--keyboard-inset,0px)+4.5rem)] md:pb-0">
      <PageHeader title="Нова поставка" />

      <form onSubmit={onSubmit} noValidate className={cn("space-y-4 rounded-2xl border border-border bg-card p-4", shake && "animate-shake")}>
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
          </>
        ) : (
          <>
            {supplierField}
            {selectedVehicle ? <VehicleLockedInfo vehicle={selectedVehicle} ownerName={selectedVehicleOwnerName} /> : countryField}
            {vehicleField}
            {codeField}
            {etaField}
          </>
        )}

        {isOfferDraftMode && offerProductPrefill && !offerProductPrefill.blocked && (
          <OfferDraftSummary
            offer={offerProductPrefill.offer}
            pending={offerProductPrefill.pending}
            palletWeight={offerProductPrefill.palletWeight}
            pallets={offerDraftPallets}
            onPalletsChange={setOfferDraftPallets}
          />
        )}

        <Button type="submit" disabled={submitting} className="w-full bg-brand text-brand-foreground hover:bg-brand/90">
          {submitting
            ? "Створення…"
            : isOfferDraftMode
              ? "Створити поставку"
              : "Створити та перейти до товарів"}
        </Button>
      </form>

      {mobileEditingLabel && (
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

const VEHICLE_MAX_PALLETS = 26;
const VEHICLE_MAX_KG = 21500;

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

function OfferDraftSummary({
  offer,
  pending,
  palletWeight,
  pallets,
  onPalletsChange,
}: {
  offer: {
    product_name: string | null;
    origin_country: string | null;
    caliber: string | null;
    variety: string | null;
    price_per_kg: number | null;
    price_currency: string | null;
  };
  pending: number;
  palletWeight: number;
  pallets: number;
  onPalletsChange: (n: number) => void;
}) {
  const pw = Number(palletWeight) > 0 ? Number(palletWeight) : 0;
  const netKg = pw * Math.max(0, Number(pallets || 0));
  const tooMany = Number(pallets || 0) > pending;
  const tooFew = Number(pallets || 0) <= 0;
  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-3 space-y-2 text-sm">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
        Товар з пропозиції (чернетка — ще не збережено)
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <div className="text-muted-foreground text-[11px]">Товар</div>
          <div className="font-semibold truncate">{offer.product_name ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-[11px]">Походження</div>
          <div className="font-semibold truncate">{offer.origin_country ?? "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-[11px]">Калібр</div>
          <div className="font-semibold truncate">{offer.caliber || "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-[11px]">Сорт</div>
          <div className="font-semibold truncate">{offer.variety || "—"}</div>
        </div>
        <div>
          <div className="text-muted-foreground text-[11px]">Ціна</div>
          <div className="font-semibold tabular-nums">
            {Number(offer.price_per_kg ?? 0).toFixed(2)} {offer.price_currency ?? "EUR"}/кг
          </div>
        </div>
        <div>
          <div className="text-muted-foreground text-[11px]">Вага палети</div>
          <div className="font-semibold tabular-nums">{pw ? `${Math.round(pw)} кг` : "—"}</div>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="offer-draft-pallets" className="text-xs">
          Палет (залишок пропозиції: {pending})
        </Label>
        <Input
          id="offer-draft-pallets"
          type="number"
          inputMode="numeric"
          min={1}
          max={pending}
          value={pallets || ""}
          onChange={(e) => onPalletsChange(Number(e.target.value) || 0)}
          className={cn((tooMany || tooFew) && "border-destructive")}
        />
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>
            {tooFew
              ? "Вкажіть кількість > 0"
              : tooMany
                ? `Більше за залишок (${pending})`
                : `Нетто ≈ ${Math.round(netKg)} кг`}
          </span>
        </div>
      </div>
    </div>
  );
}
