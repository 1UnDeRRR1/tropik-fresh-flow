import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";

export const Route = createFileRoute("/_authenticated/admin/managers")({
  component: ManagersAdmin,
});

interface IM {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  is_active: boolean;
}

function ManagersAdmin() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ full_name: "", phone: "", email: "" });
  const [edit, setEdit] = useState<Record<string, Partial<IM>>>({});

  const { data } = useQuery({
    queryKey: ["admin", "managers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("import_managers")
        .select("id,full_name,phone,email,is_active")
        .order("full_name");
      return (data ?? []) as IM[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      await supabase.from("import_managers").insert({
        full_name: form.full_name,
        phone: form.phone || null,
        email: form.email || null,
      });
    },
    onSuccess: () => {
      setForm({ full_name: "", phone: "", email: "" });
      qc.invalidateQueries({ queryKey: ["admin", "managers"] });
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<IM> }) => {
      await supabase.from("import_managers").update(patch).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "managers"] }),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Менеджери імпорту" />

      <SectionCard title="Додати менеджера">
        <div className="space-y-2">
          <input
            className="input"
            placeholder="ПІБ"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
          <input
            className="input"
            placeholder="Телефон"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
          <input
            className="input"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <button
            className="btn w-full"
            disabled={!form.full_name || create.isPending}
            onClick={() => create.mutate()}
          >
            Додати
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Список менеджерів">
        {!data?.length ? (
          <EmptyState title="Менеджерів немає" />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((m) => {
              const e = edit[m.id] ?? {};
              const merged = { ...m, ...e };
              const dirty = Object.keys(e).length > 0;
              return (
                <li key={m.id} className="space-y-2 py-3">
                  <input
                    className="input"
                    value={merged.full_name}
                    onChange={(ev) => setEdit({ ...edit, [m.id]: { ...e, full_name: ev.target.value } })}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="input"
                      placeholder="Телефон"
                      value={merged.phone ?? ""}
                      onChange={(ev) => setEdit({ ...edit, [m.id]: { ...e, phone: ev.target.value } })}
                    />
                    <input
                      className="input"
                      placeholder="Email"
                      value={merged.email ?? ""}
                      onChange={(ev) => setEdit({ ...edit, [m.id]: { ...e, email: ev.target.value } })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={merged.is_active}
                        onChange={(ev) =>
                          update.mutate({ id: m.id, patch: { is_active: ev.target.checked } })
                        }
                      />
                      <span>{merged.is_active ? "Активний" : "Неактивний"}</span>
                    </label>
                    <button
                      className="btn-sm"
                      disabled={!dirty}
                      onClick={() =>
                        update.mutate(
                          { id: m.id, patch: e },
                          {
                            onSuccess: () => {
                              const next = { ...edit };
                              delete next[m.id];
                              setEdit(next);
                            },
                          },
                        )
                      }
                    >
                      Зберегти
                    </button>
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
