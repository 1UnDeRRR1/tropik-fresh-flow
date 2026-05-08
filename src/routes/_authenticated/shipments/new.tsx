import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/shipments/new")({
  component: NewShipment,
});

function NewShipment() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [eta, setEta] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { data: suppliers } = useQuery({
    queryKey: ["suppliers-select"],
    queryFn: async () => {
      const { data } = await supabase.from("suppliers").select("id,name").order("name");
      return data ?? [];
    },
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("shipments")
        .insert({
          code,
          supplier_id: supplierId || null,
          eta: eta || null,
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
          <Label htmlFor="code">Код поставки</Label>
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
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eta">Дата прибуття (ETA)</Label>
          <Input id="eta" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
        </div>
        <Button type="submit" disabled={submitting} className="w-full bg-brand text-brand-foreground hover:bg-brand/90">
          {submitting ? "Створення…" : "Створити"}
        </Button>
      </form>
    </div>
  );
}
