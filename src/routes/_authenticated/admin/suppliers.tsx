import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { run, translateError } from "@/lib/mutation-helpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/suppliers")({
  component: SuppliersAdmin,
});

interface Sup {
  id: string;
  name: string;
  country: string | null;
  is_active: boolean;
  import_manager_id: string | null;
  code_base: string | null;
  iso3: string | null;
}
interface IM { id: string; full_name: string; is_active: boolean }

function SuppliersAdmin() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", country: "", import_manager_id: "", code_base: "", iso3: "" });
  const [edit, setEdit] = useState<Record<string, Partial<Sup>>>({});

  const { data: sups } = useQuery({
    queryKey: ["admin", "suppliers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("suppliers")
        .select("id,name,country,is_active,import_manager_id,code_base,iso3")
        .order("name");
      return (data ?? []) as Sup[];
    },
  });

  const { data: managers } = useQuery({
    queryKey: ["admin", "managers", "active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("import_managers")
        .select("id,full_name,is_active")
        .eq("is_active", true)
        .order("full_name");
      return (data ?? []) as IM[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      await run(supabase.from("suppliers").insert({
        name: form.name,
        country: form.country || null,
        import_manager_id: form.import_manager_id || null,
        code_base: form.code_base || null,
        iso3: form.iso3 ? form.iso3.toUpperCase() : null,
      }));
    },
    onSuccess: () => {
      setForm({ name: "", country: "", import_manager_id: "", code_base: "", iso3: "" });
      qc.invalidateQueries({ queryKey: ["admin", "suppliers"] });
      toast.success("Постачальника додано");
    },
    onError: (e) => toast.error(translateError(e)),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Sup> }) => {
      await run(supabase.from("suppliers").update(patch).eq("id", id));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "suppliers"] });
      toast.success("Збережено");
    },
    onError: (e) => toast.error(translateError(e)),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Постачальники" />

      <SectionCard title="Додати постачальника">
        <div className="space-y-2">
          <input className="input" placeholder="Назва" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" placeholder="Країна" value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <input className="input" placeholder="Код-база (Nava)" value={form.code_base}
              onChange={(e) => setForm({ ...form, code_base: e.target.value })} />
            <input className="input" placeholder="ISO3 (ITA)" maxLength={3} value={form.iso3}
              onChange={(e) => setForm({ ...form, iso3: e.target.value.toUpperCase() })} />
          </div>
          <select className="input" value={form.import_manager_id}
            onChange={(e) => setForm({ ...form, import_manager_id: e.target.value })}>
            <option value="">— менеджер імпорту —</option>
            {managers?.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
          </select>
          <button className="btn w-full" disabled={!form.name || create.isPending}
            onClick={() => create.mutate()}>Додати</button>
        </div>
      </SectionCard>

      <SectionCard title="Список постачальників">
        {!sups?.length ? <EmptyState title="Постачальників немає" /> : (
          <ul className="divide-y divide-border">
            {sups.map((s) => {
              const e = edit[s.id] ?? {};
              const merged = { ...s, ...e };
              const dirty = Object.keys(e).length > 0;
              return (
                <li key={s.id} className="space-y-2 py-3">
                  <input className="input" value={merged.name}
                    onChange={(ev) => setEdit({ ...edit, [s.id]: { ...e, name: ev.target.value } })} />
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input" placeholder="Країна" value={merged.country ?? ""}
                      onChange={(ev) => setEdit({ ...edit, [s.id]: { ...e, country: ev.target.value } })} />
                    <select className="input" value={merged.import_manager_id ?? ""}
                      onChange={(ev) => setEdit({ ...edit, [s.id]: { ...e, import_manager_id: ev.target.value || null } })}>
                      <option value="">— менеджер —</option>
                      {managers?.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input" placeholder="Код-база" value={merged.code_base ?? ""}
                      onChange={(ev) => setEdit({ ...edit, [s.id]: { ...e, code_base: ev.target.value } })} />
                    <input className="input" placeholder="ISO3" maxLength={3} value={merged.iso3 ?? ""}
                      onChange={(ev) => setEdit({ ...edit, [s.id]: { ...e, iso3: ev.target.value.toUpperCase() } })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={merged.is_active}
                        onChange={(ev) => update.mutate({ id: s.id, patch: { is_active: ev.target.checked } })} />
                      <span>{merged.is_active ? "Активний" : "Неактивний"}</span>
                    </label>
                    <button className="btn-sm" disabled={!dirty || update.isPending}
                      onClick={() => update.mutate(
                        { id: s.id, patch: e },
                        { onSuccess: () => { const n = { ...edit }; delete n[s.id]; setEdit(n); } },
                      )}>{update.isPending ? "Збереження…" : "Зберегти"}</button>
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
