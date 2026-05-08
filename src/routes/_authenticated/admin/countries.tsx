import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";

export const Route = createFileRoute("/_authenticated/admin/countries")({
  component: CountriesAdmin,
});

interface CL {
  id: string;
  country: string;
  logistics_days: number;
  weekend_adjustment: boolean;
}

function CountriesAdmin() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ country: "", logistics_days: 1, weekend_adjustment: true });
  const [edit, setEdit] = useState<Record<string, Partial<CL>>>({});

  const { data } = useQuery({
    queryKey: ["admin", "countries"],
    queryFn: async () => {
      const { data } = await supabase
        .from("country_logistics")
        .select("id,country,logistics_days,weekend_adjustment")
        .order("country");
      return (data ?? []) as CL[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      await supabase.from("country_logistics").insert({
        country: form.country,
        logistics_days: Number(form.logistics_days) || 1,
        weekend_adjustment: form.weekend_adjustment,
      });
    },
    onSuccess: () => {
      setForm({ country: "", logistics_days: 1, weekend_adjustment: true });
      qc.invalidateQueries({ queryKey: ["admin", "countries"] });
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<CL> }) => {
      await supabase.from("country_logistics").update(patch).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "countries"] }),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Логістика по країнах" subtitle="Дні в дорозі + правило вихідних" />

      <SectionCard title="Додати країну">
        <div className="space-y-2">
          <input className="input" placeholder="Країна (англ.)" value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })} />
          <input className="input" type="number" placeholder="Дні логістики"
            value={form.logistics_days}
            onChange={(e) => setForm({ ...form, logistics_days: Number(e.target.value) })} />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={form.weekend_adjustment}
              onChange={(e) => setForm({ ...form, weekend_adjustment: e.target.checked })} />
            <span>Зсув з неділі/свят</span>
          </label>
          <button className="btn w-full" disabled={!form.country || create.isPending}
            onClick={() => create.mutate()}>Додати</button>
        </div>
      </SectionCard>

      <SectionCard title="Налаштування">
        {!data?.length ? <EmptyState title="Країн немає" /> : (
          <ul className="divide-y divide-border">
            {data.map((c) => {
              const e = edit[c.id] ?? {};
              const merged = { ...c, ...e };
              const dirty = Object.keys(e).length > 0;
              return (
                <li key={c.id} className="space-y-2 py-3">
                  <div className="grid grid-cols-12 gap-2">
                    <input className="input col-span-7" value={merged.country}
                      onChange={(ev) => setEdit({ ...edit, [c.id]: { ...e, country: ev.target.value } })} />
                    <input className="input col-span-3" type="number"
                      value={merged.logistics_days}
                      onChange={(ev) => setEdit({ ...edit, [c.id]: { ...e, logistics_days: Number(ev.target.value) } })} />
                    <span className="col-span-2 self-center text-xs text-muted-foreground">днів</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={merged.weekend_adjustment}
                        onChange={(ev) => update.mutate({ id: c.id, patch: { weekend_adjustment: ev.target.checked } })} />
                      <span>Зсув з вихідних</span>
                    </label>
                    <button className="btn-sm" disabled={!dirty}
                      onClick={() => update.mutate(
                        { id: c.id, patch: e },
                        { onSuccess: () => { const n = { ...edit }; delete n[c.id]; setEdit(n); } },
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
