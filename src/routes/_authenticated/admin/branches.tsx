import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { cn } from "@/lib/utils";
import { run, feedback } from "@/lib/mutation-helpers";

export const Route = createFileRoute("/_authenticated/admin/branches")({
  component: BranchesAdmin,
});

interface Branch {
  id: string;
  name: string;
  code: string | null;
  city: string | null;
  is_active: boolean;
  sort_order: number | null;
}

function BranchesAdmin() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", code: "", city: "", sort_order: 99 });
  const [editing, setEditing] = useState<Record<string, Partial<Branch>>>({});

  const { data } = useQuery({
    queryKey: ["admin", "branches"],
    queryFn: async () => {
      const { data } = await supabase
        .from("branches")
        .select("id,name,code,city,is_active,sort_order")
        .order("sort_order", { ascending: true });
      return (data ?? []) as Branch[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      await run(supabase.from("branches").insert({
        name: form.name,
        code: form.code || null,
        city: form.city || null,
        sort_order: Number(form.sort_order) || 99,
      }));
    },
    ...feedback({ success: "Філію додано" }),
    onSuccess: () => {
      setForm({ name: "", code: "", city: "", sort_order: 99 });
      qc.invalidateQueries({ queryKey: ["admin", "branches"] });
      import("sonner").then(({ toast }) => toast.success("Філію додано"));
    },
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Branch> }) => {
      await run(supabase.from("branches").update(patch).eq("id", id));
    },
    ...feedback({ success: "Збережено" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "branches"] }),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Філії" subtitle="Master-data: 14 фіксованих філій" />

      <SectionCard title="Додати філію">
        <div className="grid grid-cols-2 gap-2">
          <input
            className="input col-span-2"
            placeholder="Назва"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className="input"
            placeholder="Код"
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
          />
          <input
            className="input"
            placeholder="Місто"
            value={form.city}
            onChange={(e) => setForm({ ...form, city: e.target.value })}
          />
          <input
            className="input"
            type="number"
            placeholder="№"
            value={form.sort_order}
            onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
          />
          <button
            className="btn col-span-2"
            disabled={!form.name || create.isPending}
            onClick={() => create.mutate()}
          >
            Додати
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Список філій">
        {!data?.length ? (
          <EmptyState title="Філій ще немає" />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((b) => {
              const e = editing[b.id] ?? {};
              const merged = { ...b, ...e };
              const dirty = Object.keys(e).length > 0;
              return (
                <li key={b.id} className="space-y-2 py-3">
                  <div className="grid grid-cols-12 gap-2">
                    <span className="col-span-1 self-center text-xs font-bold text-muted-foreground">
                      {merged.sort_order}
                    </span>
                    <input
                      className="input col-span-5"
                      value={merged.name ?? ""}
                      onChange={(ev) =>
                        setEditing({ ...editing, [b.id]: { ...e, name: ev.target.value } })
                      }
                    />
                    <input
                      className="input col-span-3"
                      placeholder="Код"
                      value={merged.code ?? ""}
                      onChange={(ev) =>
                        setEditing({ ...editing, [b.id]: { ...e, code: ev.target.value } })
                      }
                    />
                    <input
                      className="input col-span-3"
                      type="number"
                      value={merged.sort_order ?? 0}
                      onChange={(ev) =>
                        setEditing({
                          ...editing,
                          [b.id]: { ...e, sort_order: Number(ev.target.value) },
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={merged.is_active}
                        onChange={(ev) =>
                          update.mutate({ id: b.id, patch: { is_active: ev.target.checked } })
                        }
                      />
                      <span className={cn(merged.is_active ? "text-foreground" : "text-muted-foreground")}>
                        {merged.is_active ? "Активна" : "Неактивна"}
                      </span>
                    </label>
                    <button
                      className="btn-sm"
                      disabled={!dirty || update.isPending}
                      onClick={() => {
                        update.mutate(
                          { id: b.id, patch: e },
                          {
                            onSuccess: () => {
                              const next = { ...editing };
                              delete next[b.id];
                              setEditing(next);
                            },
                          },
                        );
                      }}
                    >
                      {update.isPending ? "Збереження…" : "Зберегти"}
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
