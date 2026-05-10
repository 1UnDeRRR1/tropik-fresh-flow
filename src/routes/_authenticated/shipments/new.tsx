import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, ChevronsUpDown, Truck, Plus, Lock } from "lucide-react";
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
import { COUNTRIES, COUNTRY_DAYS, calcArrivalDate, toDateInputValue } from "@/lib/arrival";
import { toUaCountry } from "@/lib/countries";
import {
  buildSupplierCode,
  fetchNextVehicleSequence,
  formatShipmentCode,
  formatVehicleCode,
  getCountryCode,
} from "@/lib/shipment-code";
import { StaffOnly } from "@/components/StaffOnly";

export const Route = createFileRoute("/_authenticated/shipments/new")({
  validateSearch: (search: Record<string, unknown>): { vehicleId?: string } => ({
    vehicleId: typeof search.vehicleId === "string" ? search.vehicleId : undefined,
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
  shipments: { suppliers: { name: string | null } | null }[] | null;
};

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

  const [mode, setMode] = useState<Mode>(search.vehicleId ? "existing" : "new");
  const [vehicleId, setVehicleId] = useState<string>(search.vehicleId ?? "");
  const [country, setCountry] = useState<string>("");
  const [countryTouched, setCountryTouched] = useState(false);
  const [loadingDate, setLoadingDate] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [code, setCode] = useState<string>("");
  const [codeOverride, setCodeOverride] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [supplierOpen, setSupplierOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-select", user?.id],
    enabled: !loading && !!user && isStaff,
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id,name,country").order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: openVehicles } = useQuery({
    queryKey: ["open-vehicles", user?.id, country],
    enabled: !loading && !!user && isStaff,
    queryFn: async () => {
      let q = supabase
        .from("vehicles" as never)
        .select("id,code,country,country_code,loading_date,eta,total_pallets,total_weight_kg, shipments(suppliers(name))")
        .eq("status", "open")
        .order("created_at", { ascending: false });
      if (country) q = q.eq("country", country);
      const { data, error } = await q;
      if (error) return [] as OpenVehicle[];
      return (data ?? []) as unknown as OpenVehicle[];
    },
  });

  const selectedSupplier = useMemo(
    () => suppliers?.find((s) => s.id === supplierId) ?? null,
    [suppliers, supplierId],
  );

  const selectedVehicle = useMemo(
    () => openVehicles?.find((v) => v.id === vehicleId) ?? null,
    [openVehicles, vehicleId],
  );

  // When supplier picked: auto-fill country if user hasn't touched it (and we're creating new vehicle)
  useEffect(() => {
    if (mode !== "new") return;
    if (countryTouched) return;
    if (!selectedSupplier?.country) return;
    const ua = toUaCountry(selectedSupplier.country);
    if (ua && ua !== country) setCountry(ua);
  }, [selectedSupplier, mode, countryTouched, country]);

  const days = country ? COUNTRY_DAYS[country] ?? 0 : 0;
  const computedEta = useMemo(() => {
    if (mode === "existing" && selectedVehicle?.eta) return selectedVehicle.eta;
    if (!loadingDate || !country || !days) return "";
    return toDateInputValue(calcArrivalDate(loadingDate, days));
  }, [mode, selectedVehicle, loadingDate, country, days]);

  // Preview next sequence per country
  const previewCc = mode === "new" && country ? getCountryCode(country) : "";
  const { data: previewSeq } = useQuery({
    queryKey: ["next-vehicle-seq", user?.id, previewCc],
    queryFn: () => fetchNextVehicleSequence(previewCc),
    enabled: !loading && !!user && isStaff && !!previewCc,
  });

  // Auto-generate code preview
  useEffect(() => {
    if (codeOverride) return;
    const supplierCode = selectedSupplier ? buildSupplierCode(selectedSupplier.name) : "";
    if (mode === "existing" && selectedVehicle && supplierCode) {
      setCode(formatShipmentCode(selectedVehicle.code, supplierCode));
    } else if (mode === "new" && country && supplierCode) {
      const cc = getCountryCode(country);
      const seqStr = previewSeq ? String(previewSeq).padStart(2, "0") : "··";
      setCode(formatShipmentCode(`${cc}${seqStr}`, supplierCode));
    } else {
      setCode("");
    }
  }, [mode, selectedVehicle, selectedSupplier, country, codeOverride, previewSeq]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!supplierId || !selectedSupplier) return toast.error("Виберіть постачальника");

    setSubmitting(true);
    try {
      let vId = vehicleId;
      let vCode = selectedVehicle?.code ?? "";
      let useCountry = country;
      let useLoadingDate = loadingDate;
      let useEta = computedEta;
      let useDays = days;

      if (mode === "new") {
        if (!country) throw new Error("Виберіть країну завантаження");
        if (!loadingDate) throw new Error("Вкажіть дату завантаження");
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
      } else {
        if (!selectedVehicle) throw new Error("Виберіть відкрите авто");
        useCountry = selectedVehicle.country;
        useLoadingDate = selectedVehicle.loading_date ?? "";
        useEta = selectedVehicle.eta ?? "";
        useDays = selectedVehicle.eta && selectedVehicle.loading_date
          ? Math.max(0, Math.round((+new Date(selectedVehicle.eta) - +new Date(selectedVehicle.loading_date)) / 86400000))
          : (COUNTRY_DAYS[selectedVehicle.country] ?? 0);
      }

      const supplierCode = buildSupplierCode(selectedSupplier.name);
      const finalCode = codeOverride && code.trim()
        ? code.trim()
        : formatShipmentCode(vCode, supplierCode);

      const { data, error } = await supabase
        .from("shipments")
        .insert({
          code: finalCode,
          supplier_id: supplierId,
          country: useCountry,
          loading_date: useLoadingDate || null,
          logistics_days: useDays,
          eta: useEta || null,
          import_manager_id: user?.id ?? null,
          created_by: user?.id ?? null,
          vehicle_id: vId,
        } as never)
        .select("id")
        .single();

      if (error) {
        if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
          throw new Error("Поставка з таким номером вже існує");
        }
        throw new Error(error.message || "Помилка збереження");
      }

      toast.success("Поставку створено. Додайте позиції товарів.");
      navigate({ to: "/shipments/$id/products", params: { id: data.id } });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !isStaff) {
    return <p className="text-sm text-muted-foreground">Завантаження…</p>;
  }

  const supplierField = (
    <div className="space-y-1.5">
      <Label>Постачальник</Label>
      <Popover open={supplierOpen} onOpenChange={setSupplierOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm"
          >
            <span className={cn(!selectedSupplier && "text-muted-foreground")}>
              {selectedSupplier ? selectedSupplier.name : "Оберіть постачальника…"}
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Пошук постачальника…" />
            <CommandList>
              <CommandEmpty>Не знайдено</CommandEmpty>
              <CommandGroup>
                {(suppliers ?? []).map((s) => (
                  <CommandItem
                    key={s.id}
                    value={`${s.name} ${toUaCountry(s.country ?? "")}`}
                    onSelect={() => {
                      setSupplierId(s.id);
                      setSupplierOpen(false);
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
    <div className="space-y-1.5">
      <Label>Країна завантаження</Label>
      <Popover open={countryOpen} onOpenChange={setCountryOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm"
          >
            <span className={cn(!country && "text-muted-foreground")}>
              {country || "Оберіть країну…"}
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Пошук країни…" />
            <CommandList>
              <CommandEmpty>Не знайдено</CommandEmpty>
              <CommandGroup>
                {COUNTRIES.map((c) => (
                  <CommandItem
                    key={c}
                    value={c}
                    onSelect={() => {
                      setCountry(c);
                      setCountryTouched(true);
                      setVehicleId("");
                      setCountryOpen(false);
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
    <div className="space-y-1.5">
      <Label htmlFor="ld">Дата завантаження</Label>
      <Input id="ld" type="date" required value={loadingDate} onChange={(e) => setLoadingDate(e.target.value)} />
    </div>
  );

  const etaField = (
    <div className="rounded-xl border border-dashed border-border bg-secondary/40 p-3 text-sm">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Розрахункова дата прибуття</div>
      <div className="mt-1 text-base font-semibold text-foreground">
        {computedEta
          ? new Date(computedEta).toLocaleDateString("uk-UA", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })
          : "Заповніть країну та дату завантаження"}
      </div>
    </div>
  );

  const vehicleField = (
    <div className="space-y-1.5">
      <Label>Відкрите авто</Label>
      <Popover open={vehicleOpen} onOpenChange={setVehicleOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm"
          >
            <span className={cn(!selectedVehicle && "text-muted-foreground")}>
              {selectedVehicle ? `${selectedVehicle.code} · ${selectedVehicle.country}` : "Оберіть авто…"}
            </span>
            <ChevronsUpDown className="h-4 w-4 opacity-50" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Пошук авто…" />
            <CommandList>
              <CommandEmpty>Немає відкритих авто</CommandEmpty>
              <CommandGroup>
                {(openVehicles ?? []).map((v) => {
                  const sups = (v.shipments ?? [])
                    .map((s) => s.suppliers?.name)
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <CommandItem
                      key={v.id}
                      value={`${v.code} ${v.country} ${sups}`}
                      onSelect={() => {
                        setVehicleId(v.id);
                        setCountry(v.country);
                        setCountryTouched(true);
                        setVehicleOpen(false);
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
    <div className="space-y-4">
      <PageHeader title="Нова поставка" />

      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-border bg-card p-4">
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
            {countryField}
            {vehicleField}
            {codeField}
            {etaField}
          </>
        )}

        <Button type="submit" disabled={submitting} className="w-full bg-brand text-brand-foreground hover:bg-brand/90">
          {submitting ? "Створення…" : "Створити та перейти до товарів"}
        </Button>
      </form>
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
