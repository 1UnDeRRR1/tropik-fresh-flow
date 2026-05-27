import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useCallback, type FormEvent } from "react";
import { Check, ChevronsUpDown, Truck, Plus, Lock, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { COUNTRIES as FALLBACK_COUNTRIES, COUNTRY_DAYS, calcArrivalDate, toDateInputValue } from "@/lib/arrival";
import { useCountryOptions } from "@/hooks/useCountryOptions";
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
import { filterWordStart } from "@/lib/compact-search";

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

  const [supplierOpen, setSupplierOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [countrySearch, setCountrySearch] = useState("");
  const countryOptions = useCountryOptions();
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [vehicleSearch, setVehicleSearch] = useState("");
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
  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    return filterWordStart(suppliers ?? [], (s) => s.name, q, 3);
  }, [suppliers, supplierSearch]);
  const filteredCountries = useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    const base = countryOptions.length ? countryOptions : FALLBACK_COUNTRIES;
    if (q.length < 2) return [];
    return filterWordStart(base, (c) => c, q, 3);
  }, [countryOptions, countrySearch]);
  const filteredVehicles = useMemo(() => {
    const q = vehicleSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    return filterWordStart(openVehicles ?? [], (v) => `${v.code} ${v.country}`, q, 3);
  }, [openVehicles, vehicleSearch]);

  const blurAndCloseEditors = useCallback(() => {
    if (typeof document !== "undefined") {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    }
    setSupplierOpen(false);
    setCountryOpen(false);
    setVehicleOpen(false);
    setMobileEditingLabel(null);
  }, []);

  const blurActiveElement = useCallback(() => {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  }, []);

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
        .select("origin_country,linked_shipment_id,import_manager_id,position_id")
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
        country: linkedShipment?.country ?? offer.origin_country ?? null,
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

  useEffect(() => {
    if (supplierId || !fromOfferPrefill || !suppliers?.length) return;

    const directSupplier = fromOfferPrefill.supplierId
      ? suppliers.find((supplier) => supplier.id === fromOfferPrefill.supplierId)
      : null;
    if (directSupplier) {
      setSupplierId(directSupplier.id);
      return;
    }

    const targetCountry = normalizeCountry(fromOfferPrefill.country ?? "");
    if (!targetCountry) return;

    const scopedManagerId = fromOfferPrefill.offerManagerId ?? currentManagerId ?? null;
    // Try scoped pool first (manager's own suppliers); if empty fall back to all.
    const scopedPool = scopedManagerId
      ? suppliers.filter((supplier) => supplier.import_manager_id === scopedManagerId)
      : [];
    const pools: typeof suppliers[] = scopedPool.length ? [scopedPool, suppliers] : [suppliers];
    for (const pool of pools) {
      const countryMatches = pool.filter(
        (supplier) => normalizeCountry(supplier.country ?? "") === targetCountry,
      );
      if (countryMatches.length > 0) {
        // Pick first match — even if multiple, manager can change after.
        setSupplierId(countryMatches[0].id);
        return;
      }
    }
  }, [fromOfferPrefill, suppliers, supplierId, currentManagerId]);


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

      // Shipment committed — vehicle is no longer orphan, cancel rollback.
      createdVehicleIdForRollback = null;

      // refetchType: "all" — force background refetch even on unmounted lists,
      // so the manager's /shipments table is fresh on the next navigation
      // without requiring a manual page refresh.
      qc.invalidateQueries({ queryKey: ["shipments-list"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["dash-manager"], refetchType: "all" });
      qc.invalidateQueries({ queryKey: ["open-vehicles"], refetchType: "all" });
      toast.success("Поставку створено. Додайте позиції товарів.");
      navigate({
        to: "/shipments/$id/products",
        params: { id: shipmentId },
        search: search.fromOffer ? { fromOffer: search.fromOffer } : {},
      } as never);
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
      {/* invalid: supplier */}
      <Label>Постачальник</Label>
      <Popover open={supplierOpen} onOpenChange={setSupplierOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-mobile-edit-label="Постачальник"
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm"
          >
            <span className={cn(!selectedSupplier && "text-muted-foreground")}>
              {selectedSupplier ? selectedSupplier.name : "Оберіть постачальника…"}
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(var(--radix-popover-trigger-width),calc(100vw-1rem))] max-w-[calc(100vw-1rem)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Пошук постачальника…" value={supplierSearch} onValueChange={setSupplierSearch} />
            <CommandList className="max-h-[132px]">
              <CommandEmpty>{supplierSearch.trim().length < 2 ? "Введіть 2 літери" : "Не знайдено"}</CommandEmpty>
              <CommandGroup>
                {filteredSuppliers.map((s) => (
                  <CommandItem
                    key={s.id}
                    keywords={[toUaCountry(s.country ?? "")]}
                    value={s.name}
                    onSelect={() => {
                      setSupplierId(s.id);
                      clearInvalid("supplier");
                      setSupplierSearch("");
                      setSupplierOpen(false);
                      blurActiveElement();
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", supplierId === s.id ? "opacity-100" : "opacity-0")} />
                    <div className="flex flex-col">
                      <span>{s.name}</span>
                      {s.country && (
                        <span className="text-[11px] text-muted-foreground">{toUaCountry(s.country)}</span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );

  const countryField = (
    <div className={cn("space-y-1.5", invalid.has("country") && "field-invalid")}>
      <Label>Країна завантаження</Label>
      <Popover open={countryOpen} onOpenChange={setCountryOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-mobile-edit-label="Країна завантаження"
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm"
          >
            <span className={cn(!country && "text-muted-foreground")}>
              {country || "Оберіть країну…"}
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(var(--radix-popover-trigger-width),calc(100vw-1rem))] max-w-[calc(100vw-1rem)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Пошук країни…" value={countrySearch} onValueChange={setCountrySearch} />
            <CommandList className="max-h-[132px]">
              <CommandEmpty>{countrySearch.trim().length < 2 ? "Введіть 2 літери" : "Не знайдено"}</CommandEmpty>
              <CommandGroup>
                {filteredCountries.map((c: string) => (
                  <CommandItem
                    key={c}
                    value={c}
                    onSelect={() => {
                      setCountry(c);
                      setCountryTouched(true);
                      setVehicleId("");
                      clearInvalid("country");
                      setCountrySearch("");
                      setCountryOpen(false);
                      blurActiveElement();
                    }}
                  >
                    <Check className={cn("mr-2 h-4 w-4", country === c ? "opacity-100" : "opacity-0")} />
                    {c}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
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
      <Popover open={vehicleOpen} onOpenChange={setVehicleOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-mobile-edit-label="Відкрите авто"
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm"
          >
            <span className={cn(!selectedVehicle && "text-muted-foreground")}>
              {selectedVehicle ? `${selectedVehicle.code} · ${selectedVehicle.country}` : "Оберіть авто…"}
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(var(--radix-popover-trigger-width),calc(100vw-1rem))] max-w-[calc(100vw-1rem)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput placeholder="Пошук авто…" value={vehicleSearch} onValueChange={setVehicleSearch} />
            <CommandList className="max-h-[132px]">
              <CommandEmpty>{vehicleSearch.trim().length < 2 ? "Введіть 2 літери" : "Немає відкритих авто"}</CommandEmpty>
              <CommandGroup>
                {filteredVehicles.map((v) => {
                  const sups = (v.shipments ?? [])
                    .map((s) => s.suppliers?.name)
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <CommandItem
                      key={v.id}
                      keywords={[v.country, sups]}
                      value={v.code}
                      onSelect={() => {
                        setVehicleId(v.id);
                        setCountry(v.country);
                        setCountryTouched(true);
                        clearInvalid("vehicle");
                        setVehicleSearch("");
                        setVehicleOpen(false);
                        blurActiveElement();
                      }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", vehicleId === v.id ? "opacity-100" : "opacity-0")} />
                      <div className="flex flex-col">
                        <span className="font-semibold">{v.code} · {v.country}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {Number(v.total_pallets ?? 0)}/26 пал · {Math.round(Number(v.total_weight_kg ?? 0))}/21500 кг
                          {sups ? ` · ${sups}` : ""}
                        </span>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
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

        <Button type="submit" disabled={submitting} className="w-full bg-brand text-brand-foreground hover:bg-brand/90">
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
