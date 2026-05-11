import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { run, translateError } from "@/lib/mutation-helpers";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/countries-master")({
  component: CountriesMaster,
});

interface C {
  id: string;
  name: string;
  code: string | null;
  is_active: boolean;
  sort_order: number;
}

function CountriesMaster() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [edit, setEdit] = useState<Record<string, Partial<C>>>({});

  const { data } = useQuery({
    queryKey: ["admin", "countries"],
    queryFn: async () => {
      const { data } = await supabase
        .from("countries")
        .select("id,name,code,is_active,sort_order")
        .order("name");
      return (data ?? []) as C[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      await run(supabase.from("countries").insert({ name: name.trim() }));
    },
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["admin", "countries"] });
      toast.success("Країну додано");
    },
    onError: (e) => toast.error(translateError(e)),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<C> }) => {
      await run(supabase.from("countries").update(patch).eq("id", id));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "countries"] });
      toast.success("Збережено");
    },
    onError: (e) => toast.error(translateError(e)),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Країни (база)" subtitle="Майстер-довідник країн для всієї системи" />

      <SectionCard title="Додати країну">
        <div className="space-y-2">
          <input
            className="input"
            placeholder="Назва країни"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="btn w-full"
            disabled={!name.trim() || create.isPending}
            onClick={() => create.mutate()}
          >
            Додати
          </button>
        </div>
      </SectionCard>

      <SectionCard title={`Каталог (${data?.length ?? 0})`}>
        {!data?.length ? (
          <EmptyState title="Країн немає" />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((c) => {
              const e = edit[c.id] ?? {};
              const merged = { ...c, ...e };
              const dirty = Object.keys(e).length > 0;
              return (
                <li key={c.id} className="space-y-2 py-3">
                  <input
                    className="input"
                    value={merged.name}
                    onChange={(ev) => setEdit({ ...edit, [c.id]: { ...e, name: ev.target.value } })}
                  />
                  <input
                    className="input"
                    placeholder="ISO-код (необов'язково)"
                    value={merged.code ?? ""}
                    onChange={(ev) => setEdit({ ...edit, [c.id]: { ...e, code: ev.target.value } })}
                  />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={merged.is_active}
                        onChange={(ev) =>
                          update.mutate({ id: c.id, patch: { is_active: ev.target.checked } })
                        }
                      />
                      <span>{merged.is_active ? "Активна" : "Неактивна"}</span>
                    </label>
                    <button
                      className="btn-sm"
                      disabled={!dirty || update.isPending}
                      onClick={() =>
                        update.mutate(
                          { id: c.id, patch: e },
                          {
                            onSuccess: () => {
                              const n = { ...edit };
                              delete n[c.id];
                              setEdit(n);
                            },
                          },
                        )
                      }
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
