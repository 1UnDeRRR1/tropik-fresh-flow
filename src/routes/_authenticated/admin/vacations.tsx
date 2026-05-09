import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/admin/vacations")({
  component: VacationsPage,
});

interface Vacation {
  id: string;
  import_manager_id: string;
  start_date: string;
  end_date: string;
  mode: "full" | "manual";
  replacement_manager_id: string | null;
  notes: string | null;
}

function VacationsPage() {
  const { hasRole, loading } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    import_manager_id: "",
    start_date: "",
    end_date: "",
    mode: "full" as "full" | "manual",
    replacement_manager_id: "",
  });
  const [supplierMap, setSupplierMap] = useState<Record<string, string>>({});

  const { data: managers = [] } = useQuery({
    queryKey: ["im-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("import_managers")
        .select("id,full_name,is_active")
        .eq("is_active", true)
        .order("full_name");
      return data ?? [];
    },
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["sup-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("suppliers")
        .select("id,name,import_manager_id")
        .order("name");
      return data ?? [];
    },
  });

  const { data: vacations = [] } = useQuery({
    queryKey: ["vacations"],
    queryFn: async () => {
      const { data } = await supabase
        .from("manager_vacations")
        .select("*")
        .order("start_date", { ascending: false });
      return (data ?? []) as Vacation[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data: vac, error } = await supabase
        .from("manager_vacations")
        .insert({
          import_manager_id: form.import_manager_id,
          start_date: form.start_date,
          end_date: form.end_date,
          mode: form.mode,
          replacement_manager_id:
            form.mode === "full" ? form.replacement_manager_id || null : null,
        })
        .select()
        .single();
      if (error) throw error;
      if (form.mode === "manual") {
        const rows = Object.entries(supplierMap)
          .filter(([, mid]) => mid)
          .map(([sid, mid]) => ({
            vacation_id: vac.id,
            supplier_id: sid,
            temp_manager_id: mid,
          }));
        if (rows.length) await supabase.from("vacation_supplier_assignments").insert(rows);
      }
    },
    onSuccess: () => {
      setForm({ import_manager_id: "", start_date: "", end_date: "", mode: "full", replacement_manager_id: "" });
      setSupplierMap({});
      qc.invalidateQueries({ queryKey: ["vacations"] });
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("manager_vacations").delete().eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vacations"] }),
  });

  if (loading) return null;
  if (!hasRole(["admin", "super_admin"])) return <Navigate to="/dashboard/admin" />;

  const targetSuppliers = suppliers.filter((s) => s.import_manager_id === form.import_manager_id);
  const otherManagers = managers.filter((m) => m.id !== form.import_manager_id);

  const today = new Date().toISOString().slice(0, 10);
  const isActive = (v: Vacation) => v.start_date <= today && v.end_date >= today;

  return (
    <div className="space-y-4">
      <PageHeader title="Відпустки менеджерів" subtitle="Тимчасова заміна та розподіл постачальників" />

      <SectionCard title="Призначити відпустку">
        <div className="space-y-2">
          <select
            className="input"
            value={form.import_manager_id}
            onChange={(e) => {
              setForm({ ...form, import_manager_id: e.target.value, replacement_manager_id: "" });
              setSupplierMap({});
            }}
          >
            <option value="">Менеджер у відпустку...</option>
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input"
              type="date"
              value={form.start_date}
              onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            />
            <input
              className="input"
              type="date"
              value={form.end_date}
              onChange={(e) => setForm({ ...form, end_date: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className={`rounded-xl border p-3 ${form.mode === "full" ? "border-primary bg-primary/5" : "border-border"}`}>
              <input
                type="radio"
                className="mr-2"
                checked={form.mode === "full"}
                onChange={() => setForm({ ...form, mode: "full" })}
              />
              Повна заміна
            </label>
            <label className={`rounded-xl border p-3 ${form.mode === "manual" ? "border-primary bg-primary/5" : "border-border"}`}>
              <input
                type="radio"
                className="mr-2"
                checked={form.mode === "manual"}
                onChange={() => setForm({ ...form, mode: "manual" })}
              />
              Розподіл вручну
            </label>
          </div>

          {form.mode === "full" && form.import_manager_id && (
            <select
              className="input"
              value={form.replacement_manager_id}
              onChange={(e) => setForm({ ...form, replacement_manager_id: e.target.value })}
            >
              <option value="">Замінник...</option>
              {otherManagers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.full_name}
                </option>
              ))}
            </select>
          )}

          {form.mode === "manual" && form.import_manager_id && (
            <div className="space-y-2 rounded-xl border border-border p-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                Постачальники → менеджер
              </div>
              {targetSuppliers.length === 0 ? (
                <div className="text-sm text-muted-foreground">Немає постачальників</div>
              ) : (
                targetSuppliers.map((s) => (
                  <div key={s.id} className="grid grid-cols-2 items-center gap-2">
                    <span className="truncate text-sm">{s.name}</span>
                    <select
                      className="input"
                      value={supplierMap[s.id] ?? ""}
                      onChange={(e) => setSupplierMap({ ...supplierMap, [s.id]: e.target.value })}
                    >
                      <option value="">—</option>
                      {otherManagers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name}
                        </option>
                      ))}
                    </select>
                  </div>
                ))
              )}
            </div>
          )}

          <button
            className="btn w-full"
            disabled={
              !form.import_manager_id ||
              !form.start_date ||
              !form.end_date ||
              (form.mode === "full" && !form.replacement_manager_id) ||
              create.isPending
            }
            onClick={() => create.mutate()}
          >
            <Plus className="mr-1 inline h-4 w-4" /> Зберегти
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Список відпусток">
        {vacations.length === 0 ? (
          <EmptyState title="Відпусток немає" />
        ) : (
          <ul className="divide-y divide-border">
            {vacations.map((v) => {
              const m = managers.find((x) => x.id === v.import_manager_id);
              const r = managers.find((x) => x.id === v.replacement_manager_id);
              const active = isActive(v);
              return (
                <li key={v.id} className="flex items-center justify-between py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-bold">
                      <span className="truncate">{m?.full_name ?? "—"}</span>
                      {active && (
                        <span className="rounded-full bg-warning/20 px-2 py-0.5 text-[10px] font-bold uppercase text-foreground">
                          у відпустці
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {v.start_date} → {v.end_date} ·{" "}
                      {v.mode === "full" ? `Замінник: ${r?.full_name ?? "—"}` : "Розподіл вручну"}
                    </div>
                  </div>
                  <button
                    className="rounded-md p-2 text-destructive hover:bg-destructive/10"
                    onClick={() => del.mutate(v.id)}
                    aria-label="Видалити"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
