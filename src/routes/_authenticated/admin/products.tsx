import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";

export const Route = createFileRoute("/_authenticated/admin/products")({
  component: ProductsAdmin,
});

interface P {
  id: string;
  name: string;
  category: string | null;
  default_pallet_weight: number | null;
  is_active: boolean;
}

function ProductsAdmin() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", category: "", default_pallet_weight: 0 });
  const [edit, setEdit] = useState<Record<string, Partial<P>>>({});

  const { data } = useQuery({
    queryKey: ["admin", "products"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("id,name,category,default_pallet_weight,is_active")
        .order("name");
      return (data ?? []) as P[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      await supabase.from("products").insert({
        name: form.name,
        category: form.category || null,
        default_pallet_weight: Number(form.default_pallet_weight) || 0,
      });
    },
    onSuccess: () => {
      setForm({ name: "", category: "", default_pallet_weight: 0 });
      qc.invalidateQueries({ queryKey: ["admin", "products"] });
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<P> }) => {
      await supabase.from("products").update(patch).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "products"] }),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Товари" />

      <SectionCard title="Додати товар">
        <div className="space-y-2">
          <input className="input" placeholder="Назва товару" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Категорія" value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <input className="input" type="number" placeholder="Вага палети, кг"
            value={form.default_pallet_weight}
            onChange={(e) => setForm({ ...form, default_pallet_weight: Number(e.target.value) })} />
          <button className="btn w-full" disabled={!form.name || create.isPending}
            onClick={() => create.mutate()}>Додати</button>
        </div>
      </SectionCard>

      <SectionCard title="Каталог">
        {!data?.length ? <EmptyState title="Товарів немає" /> : (
          <ul className="divide-y divide-border">
            {data.map((p) => {
              const e = edit[p.id] ?? {};
              const merged = { ...p, ...e };
              const dirty = Object.keys(e).length > 0;
              return (
                <li key={p.id} className="space-y-2 py-3">
                  <input className="input" value={merged.name}
                    onChange={(ev) => setEdit({ ...edit, [p.id]: { ...e, name: ev.target.value } })} />
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input" placeholder="Категорія" value={merged.category ?? ""}
                      onChange={(ev) => setEdit({ ...edit, [p.id]: { ...e, category: ev.target.value } })} />
                    <input className="input" type="number" placeholder="кг/палета"
                      value={merged.default_pallet_weight ?? 0}
                      onChange={(ev) => setEdit({ ...edit, [p.id]: { ...e, default_pallet_weight: Number(ev.target.value) } })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={merged.is_active}
                        onChange={(ev) => update.mutate({ id: p.id, patch: { is_active: ev.target.checked } })} />
                      <span>{merged.is_active ? "Активний" : "Неактивний"}</span>
                    </label>
                    <button className="btn-sm" disabled={!dirty}
                      onClick={() => update.mutate(
                        { id: p.id, patch: e },
                        { onSuccess: () => { const n = { ...edit }; delete n[p.id]; setEdit(n); } },
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
