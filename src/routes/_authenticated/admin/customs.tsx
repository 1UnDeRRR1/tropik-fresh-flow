import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/customs")({
  component: CustomsAdmin,
});

interface CR {
  id: string;
  product_name: string;
  country: string;
  threshold_price_usd: number;
  customs_fee_percent: number;
  euro1_markup_usd: number;
  active: boolean;
}

const COUNTRIES = ["Poland", "Moldova", "Italy", "Greece", "Spain", "Netherlands", "Belgium", "Albania", "Macedonia"];

function CustomsAdmin() {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    product_name: "",
    country: COUNTRIES[0],
    threshold_price_usd: 0,
    customs_fee_percent: 0,
    euro1_markup_usd: 0,
  });
  const [edit, setEdit] = useState<Record<string, Partial<CR>>>({});

  const { data } = useQuery({
    queryKey: ["admin", "customs_reference"],
    queryFn: async () => {
      const { data } = await supabase
        .from("customs_reference")
        .select("id,product_name,country,threshold_price_usd,customs_fee_percent,euro1_markup_usd,active")
        .order("country")
        .order("product_name");
      return (data ?? []) as CR[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("customs_reference").insert({
        product_name: form.product_name.trim(),
        country: form.country,
        threshold_price_usd: Number(form.threshold_price_usd) || 0,
        customs_fee_percent: Number(form.customs_fee_percent) || 0,
        euro1_markup_usd: Number(form.euro1_markup_usd) || 0,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Запис додано");
      setForm({ ...form, product_name: "", threshold_price_usd: 0, customs_fee_percent: 0, euro1_markup_usd: 0 });
      qc.invalidateQueries({ queryKey: ["admin", "customs_reference"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<CR> }) => {
      const { error } = await supabase.from("customs_reference").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "customs_reference"] }),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Митний довідник" subtitle="Параметри для розрахунку митної собівартості" />

      <SectionCard title="Додати запис">
        <div className="space-y-2">
          <input
            className="input"
            placeholder="Назва товару"
            value={form.product_name}
            onChange={(e) => setForm({ ...form, product_name: e.target.value })}
          />
          <select
            className="input"
            value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })}
          >
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Поріг $</span>
              <input className="input" type="number" step="0.01" value={form.threshold_price_usd}
                onChange={(e) => setForm({ ...form, threshold_price_usd: Number(e.target.value) })} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Митний збір %</span>
              <input className="input" type="number" step="0.01" value={form.customs_fee_percent}
                onChange={(e) => setForm({ ...form, customs_fee_percent: Number(e.target.value) })} />
            </label>
            <label className="space-y-1">
              <span className="text-[11px] text-muted-foreground">Націнка Euro1, $</span>
              <input className="input" type="number" step="0.01" value={form.euro1_markup_usd}
                onChange={(e) => setForm({ ...form, euro1_markup_usd: Number(e.target.value) })} />
            </label>
          </div>
          <button className="btn w-full" disabled={!form.product_name || create.isPending}
            onClick={() => create.mutate()}>Додати</button>
        </div>
      </SectionCard>

      <SectionCard title="Записи">
        {!data?.length ? <EmptyState title="Поки що порожньо" /> : (
          <ul className="divide-y divide-border">
            {data.map((r) => {
              const e = edit[r.id] ?? {};
              const merged = { ...r, ...e };
              const dirty = Object.keys(e).length > 0;
              return (
                <li key={r.id} className="space-y-2 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <input className="input flex-1" value={merged.product_name}
                      onChange={(ev) => setEdit({ ...edit, [r.id]: { ...e, product_name: ev.target.value } })} />
                    <select className="input w-32" value={merged.country}
                      onChange={(ev) => setEdit({ ...edit, [r.id]: { ...e, country: ev.target.value } })}>
                      {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground">Поріг $</span>
                      <input className="input" type="number" step="0.01" value={merged.threshold_price_usd}
                        onChange={(ev) => setEdit({ ...edit, [r.id]: { ...e, threshold_price_usd: Number(ev.target.value) } })} />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground">Збір %</span>
                      <input className="input" type="number" step="0.01" value={merged.customs_fee_percent}
                        onChange={(ev) => setEdit({ ...edit, [r.id]: { ...e, customs_fee_percent: Number(ev.target.value) } })} />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-[10px] text-muted-foreground">Euro1 $</span>
                      <input className="input" type="number" step="0.01" value={merged.euro1_markup_usd}
                        onChange={(ev) => setEdit({ ...edit, [r.id]: { ...e, euro1_markup_usd: Number(ev.target.value) } })} />
                    </label>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={merged.active}
                        onChange={(ev) => update.mutate({ id: r.id, patch: { active: ev.target.checked } })} />
                      <span>{merged.active ? "Активний" : "Неактивний"}</span>
                    </label>
                    <button className="btn-sm" disabled={!dirty}
                      onClick={() => update.mutate(
                        { id: r.id, patch: e },
                        { onSuccess: () => { const n = { ...edit }; delete n[r.id]; setEdit(n); } },
                      )}>Зберегти</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
