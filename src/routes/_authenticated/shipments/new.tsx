import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { COUNTRIES, COUNTRY_DAYS, calcArrivalDate, toDateInputValue } from "@/lib/arrival";
import { toUaCountry } from "@/lib/countries";

export const Route = createFileRoute("/_authenticated/shipments/new")({
  component: NewShipment,
});

function NewShipment() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [supplierQuery, setSupplierQuery] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [country, setCountry] = useState("");
  const [loadingDate, setLoadingDate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-select"],
    queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("id,name,country").order("name");
      return data ?? [];
    },
  });

  const filteredSuppliers = useMemo(() => {
    const q = supplierQuery.trim().toLowerCase();
    if (!q) return (suppliers ?? []).slice(0, 8);
    return (suppliers ?? []).filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8);
  }, [suppliers, supplierQuery]);

  const filteredCountries = useMemo(() => {
    const q = country.trim().toLowerCase();
    if (!q) return COUNTRIES;
    return COUNTRIES.filter((c) => c.toLowerCase().includes(q));
  }, [country]);

  const days = country ? COUNTRY_DAYS[country] ?? 0 : 0;
  const computedEta = useMemo(() => {
    if (!loadingDate || !country || !days) return "";
    return toDateInputValue(calcArrivalDate(loadingDate, days));
  }, [loadingDate, country, days]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return toast.error("Введіть номер поставки");
    if (!supplierId) return toast.error("Не вибрано постачальника");
    if (!country) return toast.error("Не вибрано країну");
    if (!loadingDate) return toast.error("Не вказана дата завантаження");
    if (!computedEta) return toast.error("Не вдалось розрахувати дату прибуття");

    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("shipments")
        .insert({
          code: code.trim(),
          supplier_id: supplierId,
          country,
          loading_date: loadingDate,
          logistics_days: days,
          eta: computedEta,
          import_manager_id: user?.id ?? null,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) {
        if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
          throw new Error("Поставка з таким номером вже існує");
        }
        throw new Error(error.message || "Помилка збереження поставки");
      }
      toast.success("Поставку створено. Додайте позиції товарів.");
      // Redirect to shipment page on the products tab so user adds items immediately
      navigate({ to: "/shipments/$id", params: { id: data.id } });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Помилка збереження поставки");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedSupplier = suppliers?.find((s) => s.id === supplierId);

  return (
    <div className="space-y-4">
      <PageHeader title="Нова поставка" subtitle="Заповніть основні дані, потім додайте позиції" />
      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="code">Номер поставки</Label>
          <Input id="code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="SHP-2026-001" />
        </div>

        {/* Searchable supplier */}
        <div className="space-y-1.5">
          <Label htmlFor="sup">Постачальник</Label>
          <Input
            id="sup"
            value={selectedSupplier ? selectedSupplier.name : supplierQuery}
            onChange={(e) => {
              setSupplierQuery(e.target.value);
              setSupplierId("");
            }}
            placeholder="Почніть вводити назву…"
            autoComplete="off"
          />
          {!supplierId && supplierQuery && filteredSuppliers.length > 0 && (
            <div className="rounded-lg border border-border bg-background shadow-sm">
              {filteredSuppliers.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSupplierId(s.id);
                    setSupplierQuery("");
                    if (!country && s.country) setCountry(toUaCountry(s.country));
                  }}
                  className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-secondary"
                >
                  {s.name}
                  {s.country && <span className="ml-2 text-xs text-muted-foreground">{toUaCountry(s.country)}</span>}
                </button>
              ))}
            </div>
          )}
          {!supplierId && supplierQuery && filteredSuppliers.length === 0 && (
            <p className="text-xs text-muted-foreground">Постачальника не знайдено. Додайте його в Адмін → Постачальники.</p>
          )}
        </div>

        {/* Searchable country (datalist) */}
        <div className="space-y-1.5">
          <Label htmlFor="ctr">Країна</Label>
          <Input
            id="ctr"
            list="country-options"
            required
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="Почніть вводити країну…"
            autoComplete="off"
          />
          <datalist id="country-options">
            {filteredCountries.map((c) => (
              <option key={c} value={c}>{`+${COUNTRY_DAYS[c]} дн.`}</option>
            ))}
          </datalist>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ld">Дата завантаження</Label>
          <Input id="ld" type="date" required value={loadingDate} onChange={(e) => setLoadingDate(e.target.value)} />
        </div>

        <div className="rounded-xl border border-dashed border-border bg-secondary/40 p-3 text-sm">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Розрахункова дата прибуття</div>
          <div className="mt-1 text-base font-semibold text-foreground">
            {computedEta
              ? new Date(computedEta).toLocaleDateString("uk-UA", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })
              : "Заповніть країну та дату завантаження"}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Дні логістики беруться з довідника країни. Неділя та свята переносяться на наступний робочий день.
          </p>
        </div>

        <Button type="submit" disabled={submitting} className="w-full bg-brand text-brand-foreground hover:bg-brand/90">
          {submitting ? "Створення…" : "Створити та перейти до товарів"}
        </Button>
      </form>
    </div>
  );
}
