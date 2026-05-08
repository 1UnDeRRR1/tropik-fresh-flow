import { createFileRoute, Link, useBlocker } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Minus, Plus, RotateCcw, Save } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard } from "@/components/cards";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/distribution/$shipmentId")({
  component: DistributionMatrix,
});

type Item = {
  id: string;
  product_name: string;
  caliber: string | null;
  pallet_count: number;
  pallet_weight: number;
  final_cost_indicative: number | null;
  final_cost_invoice: number | null;
};

type Branch = { id: string; name: string; sort_order: number };
type Grid = Record<string, Record<string, number>>;

function DistributionMatrix() {
  const { shipmentId } = Route.useParams();
  const qc = useQueryClient();
  const [grid, setGrid] = useState<Grid>({});
  const [initial, setInitial] = useState<Grid>({});
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState<null | "save-overflow" | "reset" | "leave">(null);
  const pendingNavRef = useRef<null | (() => void)>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["matrix", shipmentId],
    queryFn: async () => {
      const [shRes, itemsRes, branchesRes, distRes] = await Promise.all([
        supabase.from("shipments").select("id,code,status").eq("id", shipmentId).single(),
        supabase.from("shipment_items").select("id,product_name,caliber,pallet_count,pallet_weight,final_cost_indicative,final_cost_invoice").eq("shipment_id", shipmentId).order("created_at"),
        supabase.from("branches").select("id,name,sort_order").eq("is_active", true).order("sort_order"),
        supabase
          .from("distributions")
          .select("id,branch_id, distribution_items(shipment_item_id,pallets,qty)")
          .eq("shipment_id", shipmentId),
      ]);
      const items = (itemsRes.data ?? []) as Item[];
      const branches = (branchesRes.data ?? []) as Branch[];
      const init: Grid = {};
      items.forEach((it) => {
        init[it.id] = {};
        branches.forEach((b) => (init[it.id][b.id] = 0));
      });
      (distRes.data ?? []).forEach((d) => {
        d.distribution_items?.forEach((di) => {
          if (init[di.shipment_item_id] && d.branch_id) {
            init[di.shipment_item_id][d.branch_id] = Number(di.pallets ?? 0);
          }
        });
      });
      // deep clone for both states
      setInitial(JSON.parse(JSON.stringify(init)));
      setGrid(JSON.parse(JSON.stringify(init)));
      return { shipment: shRes.data, items, branches };
    },
  });

  const totals = useMemo(() => {
    const map: Record<string, { distributed: number; remaining: number; total: number }> = {};
    data?.items.forEach((it) => {
      const distributed = Object.values(grid[it.id] ?? {}).reduce((a, b) => a + Number(b || 0), 0);
      const total = Number(it.pallet_count ?? 0);
      map[it.id] = { distributed, remaining: total - distributed, total };
    });
    return map;
  }, [grid, data]);

  const dirty = useMemo(() => JSON.stringify(grid) !== JSON.stringify(initial), [grid, initial]);
  const overflow = useMemo(() => Object.values(totals).some((t) => t.remaining < 0), [totals]);

  // Warn on browser/tab close while unsaved
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Block in-app navigation while unsaved
  useBlocker({
    shouldBlockFn: ({ next }) => {
      if (!dirty || saving) return false;
      const target = (next as { pathname?: string; href?: string }).pathname ?? (next as { href?: string }).href ?? "/";
      pendingNavRef.current = () => {
        setInitial(JSON.parse(JSON.stringify(grid)));
        window.setTimeout(() => { window.location.href = target; }, 0);
      };
      setConfirmOpen("leave");
      return true;
    },
  });

  const setCell = (itemId: string, branchId: string, val: number) => {
    setGrid((g) => ({ ...g, [itemId]: { ...(g[itemId] ?? {}), [branchId]: Math.max(0, val) } }));
  };
  const bump = (itemId: string, branchId: string, delta: number) => {
    setGrid((g) => ({ ...g, [itemId]: { ...(g[itemId] ?? {}), [branchId]: Math.max(0, Number(g[itemId]?.[branchId] ?? 0) + delta) } }));
  };

  const resetAll = () => {
    if (!data) return;
    const fresh: Grid = {};
    data.items.forEach((it) => {
      fresh[it.id] = {};
      data.branches.forEach((b) => (fresh[it.id][b.id] = 0));
    });
    setGrid(fresh);
  };

  const performSave = async () => {
    if (!data) return;
    setSaving(true);
    try {
      for (const branch of data.branches) {
        const branchTotals = data.items
          .map((it) => ({ itemId: it.id, pallets: Number(grid[it.id]?.[branch.id] ?? 0), weightPerPallet: Number(it.pallet_weight ?? 0) }))
          .filter((x) => x.pallets > 0);

        const { data: existing } = await supabase
          .from("distributions").select("id").eq("shipment_id", shipmentId).eq("branch_id", branch.id).maybeSingle();

        let distId = existing?.id;
        if (!distId && branchTotals.length > 0) {
          const { data: created, error: ce } = await supabase
            .from("distributions").insert({ shipment_id: shipmentId, branch_id: branch.id, status: "planned" })
            .select("id").single();
          if (ce) throw ce;
          distId = created.id;
        }

        if (distId) {
          await supabase.from("distribution_items").delete().eq("distribution_id", distId);
          if (branchTotals.length > 0) {
            const rows = branchTotals.map((x) => ({
              distribution_id: distId!,
              shipment_item_id: x.itemId,
              pallets: x.pallets,
              qty: x.pallets * x.weightPerPallet,
            }));
            const { error: ie } = await supabase.from("distribution_items").insert(rows);
            if (ie) throw ie;
          } else if (existing?.id) {
            await supabase.from("distributions").delete().eq("id", existing.id);
          }
        }
      }

      if (data.shipment?.status === "draft" || data.shipment?.status === "arrived") {
        await supabase.from("shipments").update({ status: "distributing" }).eq("id", shipmentId);
      }

      setInitial(JSON.parse(JSON.stringify(grid)));
      toast.success("Розподіл збережено");
      qc.invalidateQueries({ queryKey: ["matrix", shipmentId] });
      qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setSaving(false);
    }
  };

  const onSaveClick = () => {
    if (saving || !dirty) return;
    if (overflow) {
      setConfirmOpen("save-overflow");
      return;
    }
    void performSave();
  };

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Завантаження…
      </div>
    );
  }

  const SaveButton = (
    <Button
      size="sm"
      onClick={onSaveClick}
      disabled={saving || !dirty}
      className="bg-brand text-brand-foreground hover:bg-brand/90"
    >
      {saving ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
      {saving ? "Збереження…" : "Зберегти"}
    </Button>
  );

  return (
    <div className="space-y-4 pb-28">
      <PageHeader
        title="Розподіл по філіях"
        subtitle={`Поставка ${data.shipment?.code ?? ""}${dirty ? " · є незбережені зміни" : ""}`}
        action={
          <Link to="/shipments/$id" params={{ id: shipmentId }} className="text-xs text-brand">
            До поставки
          </Link>
        }
      />

      {overflow && (
        <div className="rounded-xl border border-destructive bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
          ⚠️ Розподілено більше, ніж FACT. Перевірте кількість палет.
        </div>
      )}

      {/* MOBILE: card per item */}
      <div className="space-y-3 md:hidden">
        {data.items.map((it) => {
          const t = totals[it.id] ?? { distributed: 0, remaining: 0, total: 0 };
          return (
            <div key={it.id} className="rounded-2xl border border-border bg-card p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">
                    {it.product_name}
                    {it.caliber && <span className="ml-1 text-muted-foreground">·{it.caliber}</span>}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">
                    інд ${Number(it.final_cost_indicative ?? 0).toFixed(2)}/кг · інв ${Number(it.final_cost_invoice ?? 0).toFixed(2)}/кг
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5 text-[11px] tabular-nums">
                  <span className="rounded-md bg-secondary px-1.5 py-0.5">FACT {t.total}</span>
                  <span className="rounded-md bg-brand/10 px-1.5 py-0.5 font-semibold text-brand">{t.distributed}</span>
                  <span className={cn("rounded-md px-1.5 py-0.5 font-semibold", t.remaining < 0 ? "bg-destructive/15 text-destructive" : "bg-secondary")}>
                    зал {t.remaining}
                  </span>
                </div>
              </div>

              <div className="mt-3 space-y-1.5">
                {data.branches.map((b) => {
                  const v = Number(grid[it.id]?.[b.id] ?? 0);
                  return (
                    <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-2 py-1.5">
                      <span className="truncate text-xs font-medium">{b.name}</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => bump(it.id, b.id, -1)}
                          aria-label="мінус"
                          className="grid h-8 w-8 place-items-center rounded-md border border-input bg-background active:scale-95"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <input
                          type="number"
                          min={0}
                          inputMode="numeric"
                          value={v}
                          onChange={(e) => setCell(it.id, b.id, Number(e.target.value) || 0)}
                          className="h-8 w-14 rounded-md border border-input bg-background px-1 text-center text-sm tabular-nums focus:border-brand focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => bump(it.id, b.id, 1)}
                          aria-label="плюс"
                          className="grid h-8 w-8 place-items-center rounded-md border border-input bg-background active:scale-95"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => setConfirmOpen("reset")}
          disabled={saving}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Скинути все
        </button>
      </div>

      {/* DESKTOP/TABLET: table */}
      <div className="hidden md:block">
      <SectionCard title="Матриця розподілу" action={SaveButton}>
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="min-w-full border-separate border-spacing-0 text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-card px-2 py-2 text-left font-semibold">Товар</th>
                <th className="bg-card px-2 py-2 text-right font-semibold">FACT</th>
                <th className="bg-card px-2 py-2 text-right font-semibold">Розпод.</th>
                <th className="bg-card px-2 py-2 text-right font-semibold">Залиш.</th>
                {data.branches.map((b) => (
                  <th key={b.id} className="bg-card px-1 py-2 text-center font-semibold whitespace-nowrap">
                    {b.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => {
                const t = totals[it.id] ?? { distributed: 0, remaining: 0, total: 0 };
                return (
                  <tr key={it.id} className="border-t border-border">
                    <td className="sticky left-0 z-10 bg-background px-2 py-2 font-medium whitespace-nowrap">
                      <div>
                        {it.product_name}
                        {it.caliber && <span className="ml-1 text-muted-foreground">·{it.caliber}</span>}
                      </div>
                      <div className="text-[10px] font-normal text-muted-foreground">
                        інд ${Number(it.final_cost_indicative ?? 0).toFixed(2)}/кг · інв ${Number(it.final_cost_invoice ?? 0).toFixed(2)}/кг
                      </div>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{t.total}</td>
                    <td className="px-2 py-2 text-right tabular-nums font-semibold text-brand">{t.distributed}</td>
                    <td className={cn("px-2 py-2 text-right tabular-nums font-semibold", t.remaining < 0 ? "text-destructive" : "")}>
                      {t.remaining}
                    </td>
                    {data.branches.map((b) => (
                      <td key={b.id} className="px-0.5 py-1">
                        <input
                          type="number"
                          min={0}
                          inputMode="decimal"
                          value={grid[it.id]?.[b.id] ?? 0}
                          onChange={(e) => setCell(it.id, b.id, Number(e.target.value) || 0)}
                          className="h-9 w-14 rounded-md border border-input bg-background px-1 text-center text-xs tabular-nums focus:border-brand focus:outline-none"
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            FACT — отримана к-сть палет з інвойсу. Залиш. — нерозподілений залишок.
          </p>
          <Button size="sm" variant="ghost" onClick={() => setConfirmOpen("reset")} disabled={saving}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Скинути
          </Button>
        </div>
      </SectionCard>
      </div>

      {/* Sticky save bar (mobile) */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div className="text-[11px] text-muted-foreground">
            {dirty ? "Незбережені зміни" : "Все збережено"}
          </div>
          <Button onClick={onSaveClick} disabled={saving || !dirty} className="bg-brand text-brand-foreground hover:bg-brand/90">
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            {saving ? "Збереження…" : "Зберегти"}
          </Button>
        </div>
      </div>

      {/* Confirmations */}
      <AlertDialog open={confirmOpen === "save-overflow"} onOpenChange={(v) => !v && setConfirmOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Перевищення FACT</AlertDialogTitle>
            <AlertDialogDescription>
              Для деяких товарів розподілено більше палет, ніж надійшло. Зберегти все одно?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Скасувати</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(null);
                void performSave();
              }}
            >
              Зберегти
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOpen === "reset"} onOpenChange={(v) => !v && setConfirmOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Скинути розподіл?</AlertDialogTitle>
            <AlertDialogDescription>
              Усі введені палети будуть обнулені. Зміни застосуються після натискання «Зберегти».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Ні</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                resetAll();
                setConfirmOpen(null);
              }}
            >
              Скинути
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOpen === "leave"} onOpenChange={(v) => { if (!v) { pendingNavRef.current = null; setConfirmOpen(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Залишити сторінку?</AlertDialogTitle>
            <AlertDialogDescription>
              У вас є незбережені зміни розподілу. Якщо вийти, вони втратяться.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { pendingNavRef.current = null; setConfirmOpen(null); }}>
              Залишитись
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const go = pendingNavRef.current;
                pendingNavRef.current = null;
                setConfirmOpen(null);
                go?.();
              }}
            >
              Вийти без збереження
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
