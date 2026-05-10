import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { SectionCard, EmptyState } from "@/components/cards";
import { COUNTRIES } from "@/lib/arrival";
import { LoadingPlanDetailDialog, type PlanDetailItem } from "@/components/LoadingPlanDetailDialog";
import { run, translateError } from "@/lib/mutation-helpers";
import { toast } from "sonner";

interface PlanRow {
  id: string;
  product_name: string;
  caliber: string | null;
  country: string | null;
  planned_pallets: number;
  is_active: boolean;
  count_existing: boolean;
  created_at: string;
}

export function LoadingPlanManager() {
  const qc = useQueryClient();
  const [selectedPlan, setSelectedPlan] = useState<PlanDetailItem | null>(null);
  const [form, setForm] = useState({
    product_name: "",
    caliber: "",
    country: "",
    planned_pallets: "" as string,
    count_existing: true,
  });

  const { data: products } = useQuery({
    queryKey: ["products", "active", "names"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("name")
        .eq("is_active", true)
        .order("name");
      return (data ?? []).map((r) => r.name as string);
    },
  });

  const { data: plan } = useQuery({
    queryKey: ["admin", "loading-plan"],
    queryFn: async () => {
      const { data } = await supabase
        .from("loading_plan")
        .select("id,product_name,caliber,country,planned_pallets,is_active,count_existing,created_at")
        .order("created_at", { ascending: false });
      return (data ?? []) as PlanRow[];
    },
  });

  const { data: loaded } = useQuery({
    queryKey: ["admin", "loading-plan", "loaded"],
    queryFn: async () => {
      const { data } = await supabase.rpc("loading_plan_loaded_totals");
      const map = new Map<string, number>();
      for (const r of (data ?? []) as Array<{ plan_id: string; loaded: number }>) {
        map.set(r.plan_id, Number(r.loaded ?? 0));
      }
      return map;
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("loading-plan-manager")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "loading_plan" },
        () => qc.invalidateQueries({ queryKey: ["admin", "loading-plan"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipment_items" },
        () => qc.invalidateQueries({ queryKey: ["admin", "loading-plan", "loaded"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  const create = useMutation({
    mutationFn: async () => {
      await run(supabase.from("loading_plan").insert({
        product_name: form.product_name,
        caliber: form.caliber || null,
        country: form.country || null,
        planned_pallets: Number(form.planned_pallets) || 0,
        count_existing: form.count_existing,
      }));
    },
    onSuccess: () => {
      setForm({ product_name: "", caliber: "", country: "", planned_pallets: 0, count_existing: true });
      qc.invalidateQueries({ queryKey: ["admin", "loading-plan"] });
      toast.success("Позицію плану додано");
    },
    onError: (e) => toast.error(translateError(e)),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<PlanRow> }) => {
      await run(supabase.from("loading_plan").update(patch).eq("id", id));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "loading-plan"] });
      toast.success("Збережено");
    },
    onError: (e) => toast.error(translateError(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await run(supabase.from("loading_plan").delete().eq("id", id));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "loading-plan"] });
      toast.success("Видалено");
    },
    onError: (e) => toast.error(translateError(e)),
  });

  const loadedFor = (row: PlanRow) => loaded?.get(row.id) ?? 0;

  return (
    <div className="space-y-4">
      <SectionCard title="Додати позицію плану закупок">
        <div className="space-y-2">
          <input
            className="input"
            placeholder="Товар (напр. Ківі)"
            value={form.product_name}
            onChange={(e) => setForm({ ...form, product_name: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              className="input"
              placeholder="Калібр / специф. (напр. 18/20)"
              value={form.caliber}
              onChange={(e) => setForm({ ...form, caliber: e.target.value })}
            />
            <select
              className="input"
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
            >
              <option value="">Країна (будь-яка)</option>
              {COUNTRIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <input
            className="input"
            type="number"
            min={0}
            placeholder="Запланована к-ть палет"
            value={form.planned_pallets}
            onChange={(e) => setForm({ ...form, planned_pallets: Number(e.target.value) })}
          />
          <select
            className="input"
            value={form.count_existing ? "1" : "0"}
            onChange={(e) => setForm({ ...form, count_existing: e.target.value === "1" })}
          >
            <option value="1">З урахуванням завантаженого товару</option>
            <option value="0">Без урахування завантаженого (рахувати з моменту створення)</option>
          </select>
          <button
            className="btn w-full"
            disabled={!form.product_name || !form.planned_pallets || create.isPending}
            onClick={() => create.mutate()}
          >
            Додати в план
          </button>
        </div>
      </SectionCard>

      <SectionCard title="Активний план закупок">
        {!plan?.length ? (
          <EmptyState title="План порожній" hint="Додайте позиції, щоб менеджери їх бачили" />
        ) : (
          <ul className="divide-y divide-border">
            {plan.map((p) => {
              const done = loadedFor(p);
              const remaining = Number(p.planned_pallets) - done;
              return (
                <li key={p.id} className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedPlan({
                          id: p.id,
                          product_name: p.product_name,
                          country: p.country,
                          caliber: p.caliber,
                          planned_pallets: Number(p.planned_pallets),
                          count_existing: p.count_existing,
                          created_at: p.created_at,
                        })
                      }
                      className="min-w-0 flex-1 text-left transition active:scale-[0.99]"
                    >
                      <div className="text-sm font-semibold underline-offset-2 hover:underline">
                        {p.product_name}
                        {p.caliber ? ` ${p.caliber}` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {p.country ?? "Будь-яка країна"} · план {p.planned_pallets}п · завантажено {done}п
                      </div>
                    </button>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                          remaining <= 0 ? "bg-emerald-500/15 text-emerald-600" : "bg-brand/15 text-brand"
                        }`}
                      >
                        {remaining > 0 ? `${remaining}п` : "0п"}
                      </span>
                      <input
                        className="input h-8 w-20 text-xs"
                        type="number"
                        min={0}
                        defaultValue={p.planned_pallets}
                        onBlur={(ev) => {
                          const v = Number(ev.target.value);
                          if (v !== p.planned_pallets) {
                            update.mutate({ id: p.id, patch: { planned_pallets: v } });
                          }
                        }}
                        aria-label="План палет"
                      />
                      <button
                        className="rounded p-1 text-muted-foreground hover:text-destructive"
                        onClick={() => remove.mutate(p.id)}
                        aria-label="Видалити"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <LoadingPlanDetailDialog
        plan={selectedPlan}
        open={!!selectedPlan}
        onOpenChange={(o) => !o && setSelectedPlan(null)}
      />
    </div>
  );
}
