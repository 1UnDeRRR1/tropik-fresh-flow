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

export const Route = createFileRoute("/_authenticated/shipments/new")({
  component: NewShipment,
});

function NewShipment() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [country, setCountry] = useState("");
  const [loadingDate, setLoadingDate] = useState("");
  const [logisticsDays, setLogisticsDays] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-select"],
    queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("id,name").order("name");
      return data ?? [];
    },
  });

  const effectiveDays = logisticsDays !== ""
    ? Number(logisticsDays)
    : country
      ? COUNTRY_DAYS[country] ?? 0
      : 0;

  const computedEta = useMemo(() => {
    if (!loadingDate || !country) return "";
    return toDateInputValue(calcArrivalDate(loadingDate, effectiveDays));
  }, [loadingDate, country, effectiveDays]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("shipments")
        .insert({
          code,
          supplier_id: supplierId || null,
          country: country || null,
          loading_date: loadingDate || null,
          logistics_days: effectiveDays || null,
          eta: computedEta || null,
          import_manager_id: user?.id ?? null,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      toast.success("Поставку створено");
      navigate({ to: "/shipments/$id", params: { id: data.id } });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Помилка");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Нова поставка" subtitle="Заповніть основні дані" />
      <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-border bg-card p-4">
        <div className="space-y-1.5">
          <Label htmlFor="code">Номер поставки</Label>
          <Input id="code" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="SHP-2026-001" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sup">Постачальник</Label>
          <select
            id="sup"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">— виберіть —</option>
            {suppliers?.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ctr">Країна</Label>
          <select
            id="ctr"
            required
            value={country}
            onChange={(e) => {
              setCountry(e.target.value);
              setLogisticsDays("");
            }}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">— виберіть —</option>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>{c} (+{COUNTRY_DAYS[c]} дн.)</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="ld">Дата завантаження</Label>
            <Input id="ld" type="date" required value={loadingDate} onChange={(e) => setLoadingDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dys">Днів логістики</Label>
            <Input
              id="dys"
              type="number"
              min={0}
              value={logisticsDays}
              onChange={(e) => setLogisticsDays(e.target.value)}
              placeholder={country ? String(COUNTRY_DAYS[country]) : "—"}
            />
          </div>
        </div>
        <div className="rounded-xl border border-dashed border-border bg-secondary/40 p-3 text-sm">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Розрахункова дата прибуття</div>
          <div className="mt-1 text-base font-semibold text-foreground">
            {computedEta
              ? new Date(computedEta).toLocaleDateString("uk-UA", { weekday: "short", day: "2-digit", month: "long", year: "numeric" })
              : "Заповніть країну та дату завантаження"}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Неділя та державні свята України автоматично переносяться на наступний робочий день.
          </p>
        </div>
        <Button type="submit" disabled={submitting || !computedEta} className="w-full bg-brand text-brand-foreground hover:bg-brand/90">
          {submitting ? "Створення…" : "Створити"}
        </Button>
      </form>
    </div>
  );
}
