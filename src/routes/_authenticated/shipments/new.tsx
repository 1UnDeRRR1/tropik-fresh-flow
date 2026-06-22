// R1A — header-only product-entry consolidation.
//
// This route now creates a vehicle (when needed) and a draft shipment header
// only, then navigates to the single authoritative editor at
// /shipments/$id/products. It performs ZERO writes to:
//   - shipment_items
//   - positions / position links
//   - manager_offer_allocation_parts
//   - offer-shipment links
//
// Hard rules preserved (do not regress in any later edit):
//   - Supplier is NEVER auto-selected from offer.
//   - manager_offers.origin_country never populates shipment country, vehicle
//     country, supplier filter or supplier auto-select. The only country
//     prefill comes from manager_offers.linked_shipment_id → shipments.country.
//   - For a new vehicle: insert vehicle, record createdVehicleId in handler
//     scope; on shipment INSERT failure, delete only that just-created
//     vehicle. A reused existing vehicle is never updated or deleted here.

import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Truck, Plus, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InlineAutocomplete } from "@/components/InlineAutocomplete";
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

  const [supplierInput, setSupplierInput] = useState("");
  const [countryInput, setCountryInput] = useState("");
  const countryOptions = useCountryOptions();
  const countryAliases = useCountryAliases();
  const [vehicleInput, setVehicleInput] = useState("");
  const [mobileEditingLabel, setMobileEditingLabel] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Set<string>>(() => new Set());
  const [shake, setShake] = useState(false);
  const clearInvalid = (key: string) =>
    setInvalid((prev) => {
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
        .select(
          "id,code,country,country_code,loading_date,eta,total_pallets,total_weight_kg,created_by,shipments(id,code,logistics_cost,logistics_cost_currency,created_by,suppliers(name),shipment_items(id,product_name,variety,caliber,pallet_count,pallet_weight,net_weight_kg,gross_weight_kg))",
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

  const countryChoices = useMemo(
    () => Array.from(new Set((countryOptions.length ? countryOptions : FALLBACK_COUNTRIES).filter(Boolean))),
    [countryOptions],
  );
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

  // R1A — thin fromOffer header query. Country prefill MAY come only from
  // manager_offers.linked_shipment_id → shipments.country. We intentionally
  // never read offer.origin_country here, never read offer.import_manager_id
  // to drive UI, and never auto-select supplier. A missing linked shipment
  // means no automatic loading-country prefill — manager picks it manually.
  const { data: fromOfferPrefill } = useQuery({
    queryKey: ["new-shipment-from-offer-header", search.fromOffer],
    enabled: !!search.fromOffer,
    queryFn: async () => {
      const { data: offer, error } = await supabase
        .from("manager_offers")
        .select("linked_shipment_id")
        .eq("id", search.fromOffer!)
        .maybeSingle();
      if (error) throw error;
      if (!offer || !offer.linked_shipment_id) return { country: null as string | null };
      const { data: shipment, error: shipmentError } = await supabase
        .from("shipments")
        .select("country")
        .eq("id", offer.linked_shipment_id)
        .maybeSingle();
      if (shipmentError) throw shipmentError;
      return { country: shipment?.country ?? null };
    },
  });
  useEffect(() => {
    if (!fromOfferPrefill?.country) return;
    if (countryTouched || country) return;
    const uaCountry = toUaCountry(fromOfferPrefill.country) || fromOfferPrefill.country;
    if (uaCountry) setCountry(uaCountry);
  }, [fromOfferPrefill?.country, countryTouched, country]);

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

  // R1A — header save boundary.
  // Creates vehicle (new mode), then shipment. ZERO shipment_items, ZERO
  // positions, ZERO position links, ZERO manager_offer_allocation_parts,
  // ZERO offer-shipment links. Navigates to the authoritative products
  // editor with fromOffer carried through when present.
  const onCreateShipment = async () => {
    const missing: string[] = [];
    if (!supplierId || !selectedSupplier) missing.push("supplier");
    if (mode === "new") {
      if (!country) missing.push("country");
      if (!loadingDate) missing.push("loadingDate");
      if (!computedEta) {
        missing.push("eta");
      } else if (minEta && computedEta < minEta) {
        missing.push("eta");
      }
    } else {
      if (!selectedVehicle) missing.push("vehicle");
    }
    if (missing.length) {
      if (missing.includes("eta") && mode === "new") {
        if (!computedEta) toast.error("Вкажіть дату прибуття (ETA)");
        else toast.error("ETA не може бути раніше за ETD + 1 день");
      }
      triggerShake(missing);
      return;
    }

    setSubmitting(true);
    // Local-only handle. Used by the compensation rollback when shipment
    // INSERT fails AFTER vehicle INSERT succeeded. Never persisted, never
    // passed through search/state, never reused later.
    let createdVehicleId: string | null = null;

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
          ? Math.max(
              0,
              Math.round(
                (+new Date(selectedVehicle.eta) - +new Date(selectedVehicle.loading_date)) /
                  86400000,
              ),
            )
          : COUNTRY_DAYS[selectedVehicle.country] ?? 0;
      }

      const alias = getSupplierAlias(selectedSupplier!);
      const supplierSeq = await fetchNextSupplierSequence(supplierId);
      const autoCode = formatShipmentCode({ alias, supplierSeq, vehicleCode: vCode });
      const finalCode = autoCode;

      const shipmentId = crypto.randomUUID();

      // Import-manager assignment rules preserved verbatim.
      const isAdminActor = hasRole(["super_admin", "admin"]);
      const supplierManagerId = selectedSupplier?.import_manager_id ?? null;
      let assignedManagerId: string | null = supplierManagerId;
      if (!assignedManagerId && !isAdminActor) {
        assignedManagerId = currentManagerId ?? null;
      }
      if (!assignedManagerId) {
        // Compensation: nothing to roll back beyond the just-created vehicle.
        if (createdVehicleId) {
          try {
            await supabase.from("vehicles" as never).delete().eq("id", createdVehicleId);
          } catch {
            /* ignore */
          }
        }
        toast.error(
          isAdminActor
            ? "Постачальнику не призначено імпорт-менеджера. Призначте менеджера й повторіть."
            : "Не вдалось визначити імпорт-менеджера для поставки",
        );
        setSubmitting(false);
        return;
      }

      const { error: shipErr } = await supabase.from("shipments").insert({
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
        // Transport is entered in the products editor (TransportBar). The
        // header creates a draft shipment with no logistics_cost; the
        // existing NOT NULL DEFAULT on logistics_cost_currency means we
        // still send the currency to satisfy the column.
        logistics_cost: null,
        logistics_cost_currency: "EUR",
        status: "draft",
      } as never);
      if (shipErr) {
        // Compensation: delete only the just-created vehicle. An existing
        // reused vehicle is never touched here.
        if (createdVehicleId) {
          try {
            await supabase.from("vehicles" as never).delete().eq("id", createdVehicleId);
          } catch {
            /* ignore */
          }
        }
        if (shipErr.code === "23505" || /duplicate|unique/i.test(shipErr.message)) {
          throw new Error("Поставка з таким номером вже існує");
        }
        throw new Error(shipErr.message || "Помилка збереження");
      }

      // Cache invalidations preserved from the previous flow so vehicle /
      // shipment / dashboards refresh on return navigation.
      qc.invalidateQueries({ queryKey: ["shipments-list"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["dash-manager"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["open-vehicles"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["distribution-list"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["shipments-link-options"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["shipment-products"], refetchType: "all" });

      navigate({
        to: "/shipments/$id/products",
        params: { id: shipmentId },
        search: search.fromOffer ? { fromOffer: search.fromOffer } : {},
      });
    } catch (err: unknown) {
      // Defensive: in case an error path skipped explicit rollback above.
      if (createdVehicleId) {
        try {
          await supabase.from("vehicles" as never).delete().eq("id", createdVehicleId);
        } catch {
          /* ignore */
        }
      }
      qc.invalidateQueries({ queryKey: ["open-vehicles"], refetchType: "all" });
      toast.error(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setSubmitting(false);
    }
  };

  const onHeaderSubmit = (e: FormEvent) => {
    e.preventDefault();
    void onCreateShipment();
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
            {item.country ? (
              <span className="text-[11px] text-muted-foreground">{toUaCountry(item.country)}</span>
            ) : null}
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

  const etaField = (
    <div
      className={cn(
        "space-y-1.5 rounded-xl border border-dashed border-border bg-secondary/40 p-3",
        invalid.has("eta") && "field-invalid",
      )}
    >
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

  return (
    <div className="space-y-4 pb-[calc(var(--keyboard-inset,0px)+4.5rem)] md:pb-0">
      <PageHeader title="Нова поставка" />

      <form
        onSubmit={onHeaderSubmit}
        noValidate
        className={cn("space-y-4 rounded-2xl border border-border bg-card p-4", shake && "animate-shake")}
      >
        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-2">
          <ModeButton
            active={mode === "new"}
            onClick={() => {
              setMode("new");
              setVehicleId("");
            }}
          >
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
            {selectedVehicle ? (
              <VehicleLockedInfo vehicle={selectedVehicle} ownerName={selectedVehicleOwnerName} />
            ) : (
              countryField
            )}
            {vehicleField}
            {vehicleDatesReadOnly}
            {codeField}
          </>
        )}

        <Button
          type="submit"
          disabled={submitting}
          className="w-full bg-brand text-brand-foreground hover:bg-brand/90"
        >
          {submitting ? "Створення…" : "Створити та перейти до товарів"}
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

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
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
  const sups = (vehicle.shipments ?? [])
    .map((s) => s.suppliers?.name)
    .filter(Boolean)
    .join(", ");
  const ownerShipment =
    (vehicle.shipments ?? []).find((shipment) => shipment.created_by === vehicle.created_by) ??
    (vehicle.shipments ?? []).find((shipment) => Number(shipment.logistics_cost ?? 0) > 0) ??
    null;
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
            <div className="font-semibold tabular-nums">
              {loadedP} пал · {Math.round(loadedKg)} кг
            </div>
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
          Транспорт оплачує менеджер-власник авто. Вартість транспорту для вашої поставки додасте на наступному кроці.
        </div>
      </div>
    </div>
  );
}
