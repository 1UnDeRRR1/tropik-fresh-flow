import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Check, X, Pencil, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";
import { CostPair } from "@/components/CostPair";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toUaCountry } from "@/lib/countries";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/branch-requests")({
  component: BranchRequestsPage,
});

type Row = {
  id: string;
  status: string;
  pallets: number;
  approvedQty: number | null;
  salePrice: number | null;
  saleCurrency: string | null;
  createdAt: string;
  updatedAt: string;
  branchName: string;
  shipmentCode: string;
  supplierName: string;
  shipmentId: string;
  shipmentItemId: string | null;
  branchId: string;
  importManagerId: string | null;
  product: string;
  country: string | null;
  caliber: string;
  variety: string | null;
  palletWeight: number;
  indicative: number | null;
  invoice: number | null;
};

function BranchRequestsPage() {
  const { user, hasRole } = useAuth();
  const qc = useQueryClient();
  const isAdmin = hasRole(["admin", "super_admin"]);
  const [edit, setEdit] = useState<Row | null>(null);
  const [editPallets, setEditPallets] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Row | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["branch-requests-full", isAdmin ? "all" : user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data: reqs, error } = await supabase
        .from("branch_requests")
        .select("id,status,pallets,approved_qty,sale_price,sale_currency,created_at,updated_at,branch_id,shipment_id,shipment_item_id")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const list = reqs ?? [];
      if (!list.length) return [] as Row[];

      const branchIds = [...new Set(list.map((r) => r.branch_id))];
      const shipmentIds = [...new Set(list.map((r) => r.shipment_id).filter(Boolean) as string[])];
      const itemIds = [...new Set(list.map((r) => r.shipment_item_id).filter(Boolean) as string[])];

      const [{ data: branches }, { data: ships }, { data: items }] = await Promise.all([
        supabase.from("branches").select("id,name").in("id", branchIds),
        shipmentIds.length
          ? supabase.from("shipments").select("id,code,country,import_manager_id,created_by,supplier_id").in("id", shipmentIds)
          : Promise.resolve({ data: [] as any[] }),
        itemIds.length
          ? supabase
              .from("shipment_items")
              .select("id,product_name,caliber,variety,origin_country,pallet_weight,final_cost_indicative,final_cost_invoice")
              .in("id", itemIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const supplierIds = [...new Set(((ships ?? []) as any[]).map((s) => s.supplier_id).filter(Boolean))];
      const { data: sups } = supplierIds.length
        ? await supabase.from("suppliers").select("id,name").in("id", supplierIds)
        : { data: [] as any[] };

      const bMap = new Map((branches ?? []).map((b: any) => [b.id, b]));
      const sMap = new Map((ships ?? []).map((s: any) => [s.id, s]));
      const iMap = new Map((items ?? []).map((i: any) => [i.id, i]));
      const supMap = new Map((sups ?? []).map((s: any) => [s.id, s]));

      const rows: Row[] = list.map((r) => {
        const b = bMap.get(r.branch_id);
        const s = r.shipment_id ? sMap.get(r.shipment_id) : null;
        const it = r.shipment_item_id ? iMap.get(r.shipment_item_id) : null;
        return {
          id: r.id,
          status: r.status,
          pallets: Number(r.pallets ?? 0),
          approvedQty: r.approved_qty == null ? null : Number(r.approved_qty),
          salePrice: r.sale_price == null ? null : Number(r.sale_price),
          saleCurrency: r.sale_currency,
          createdAt: r.created_at,
          updatedAt: r.updated_at ?? r.created_at,
          branchName: b?.name ?? "—",
          shipmentCode: s?.code ?? "—",
          supplierName: s?.supplier_id ? (supMap.get(s.supplier_id)?.name ?? "—") : "—",
          shipmentId: r.shipment_id ?? "",
          shipmentItemId: r.shipment_item_id,
          branchId: r.branch_id,
          importManagerId: s?.created_by ?? null,
          product: it?.product_name ?? "—",
          country: it?.origin_country ?? s?.country ?? null,
          caliber: it?.caliber ?? "—",
          variety: it?.variety ?? null,
          palletWeight: Number(it?.pallet_weight ?? 0),
          indicative: it?.final_cost_indicative ?? null,
          invoice: it?.final_cost_invoice ?? null,
        };
      });

      if (isAdmin) return rows;
      return rows.filter((r) => r.importManagerId === user!.id);
    },
  });

  const pending = useMemo(() => (data ?? []).filter((r) => r.status === "pending"), [data]);
  const cutoff = useMemo(() => Date.now() - 30 * 24 * 60 * 60 * 1000, []);
  const decided = useMemo(
    () =>
      (data ?? []).filter(
        (r) => r.status !== "pending" && new Date(r.updatedAt).getTime() >= cutoff,
      ),
    [data, cutoff],
  );
  const archived = useMemo(
    () =>
      (data ?? []).filter(
        (r) => r.status !== "pending" && new Date(r.updatedAt).getTime() < cutoff,
      ),
    [data, cutoff],
  );
  const [showArchive, setShowArchive] = useState(false);

  const approve = async (r: Row, pallets: number) => {
    if (!r.shipmentItemId || !r.shipmentId) {
      toast.error("Заявка без прив'язки до товару");
      return;
    }
    if (pallets <= 0) {
      toast.error("Кількість має бути більше 0");
      return;
    }
    if (pallets > r.pallets) {
      toast.error(`Не більше ${r.pallets} палет`);
      return;
    }
    setBusyId(r.id);
    try {
      // Upsert distribution(shipment_id, branch_id)
      const { data: existing } = await supabase
        .from("distributions")
        .select("id")
        .eq("shipment_id", r.shipmentId)
        .eq("branch_id", r.branchId)
        .maybeSingle();
      let distId = existing?.id;
      if (!distId) {
        const { data: created, error: ce } = await supabase
          .from("distributions")
          .insert({ shipment_id: r.shipmentId, branch_id: r.branchId, status: "planned" })
          .select("id")
          .single();
        if (ce) throw ce;
        distId = created.id;
      }
      // Upsert distribution_items row for shipment_item_id (sum pallets)
      const { data: existItem } = await supabase
        .from("distribution_items")
        .select("id,pallets,qty")
        .eq("distribution_id", distId!)
        .eq("shipment_item_id", r.shipmentItemId)
        .maybeSingle();
      const addQty = pallets * r.palletWeight;
      if (existItem) {
        const { error: ue } = await supabase
          .from("distribution_items")
          .update({
            pallets: Number(existItem.pallets ?? 0) + pallets,
            qty: Number(existItem.qty ?? 0) + addQty,
          })
          .eq("id", existItem.id);
        if (ue) throw ue;
      } else {
        const { error: ie } = await supabase.from("distribution_items").insert({
          distribution_id: distId!,
          shipment_item_id: r.shipmentItemId,
          pallets,
          qty: addQty,
        });
        if (ie) throw ie;
      }
      const { error: re } = await supabase
        .from("branch_requests")
        .update({ status: "approved", approved_qty: pallets, updated_at: new Date().toISOString() })
        .eq("id", r.id);
      if (re) throw re;
      toast.success(
        pallets < r.pallets
          ? `Частково затверджено: ${pallets} з ${r.pallets} палет`
          : `Затверджено: ${pallets} палет`,
      );
      qc.invalidateQueries({ queryKey: ["branch-requests-full"] });
      qc.invalidateQueries({ queryKey: ["branch-free"] });
      setEdit(null);
    } catch (e: any) {
      toast.error(e?.message ?? "Помилка");
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (r: Row) => {
    setBusyId(r.id);
    const { error } = await supabase
      .from("branch_requests")
      .update({ status: "rejected", approved_qty: 0, updated_at: new Date().toISOString() })
      .eq("id", r.id);
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Заявку відхилено");
    qc.invalidateQueries({ queryKey: ["branch-requests-full"] });
    qc.invalidateQueries({ queryKey: ["branch-free"] });
  };

  const openEdit = (r: Row) => {
    setEdit(r);
    setEditPallets(String(r.pallets));
  };

  return (
    <div className="space-y-4 pb-20">
      <PageHeader title="Заявки філій" subtitle="Пропозиції філій по вільному товару" />

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Завантаження…
        </div>
      ) : (
        <>
          <SectionCard title={`На розгляді (${pending.length})`}>
            {!pending.length ? (
              <EmptyState title="Немає нових заявок" hint="Філії ще не подавали пропозицій" />
            ) : (
              <RequestList rows={pending} onApprove={(r) => approve(r, r.pallets)} onReject={reject} onEdit={openEdit} busyId={busyId} actions />
            )}
          </SectionCard>

          <SectionCard title={`Опрацьовано (${decided.length})`}>
            {!decided.length ? (
              <EmptyState title="Поки що порожньо" hint="Зберігаються 30 днів з моменту рішення" />
            ) : (
              <>
                <p className="mb-2 text-[11px] text-muted-foreground">
                  Зберігаються 30 днів з моменту рішення, далі — в архіві.
                </p>
                <RequestList rows={decided} busyId={busyId} />
              </>
            )}
          </SectionCard>

          {isAdmin && (
            <SectionCard
              title={`Архів (${archived.length})`}
              action={
                <Button size="sm" variant="ghost" onClick={() => setShowArchive((v) => !v)}>
                  {showArchive ? "Сховати" : "Показати"}
                </Button>
              }
            >
              {!showArchive ? (
                <p className="text-xs text-muted-foreground">
                  Заявки старші за 30 днів. Доступно тільки адміністраторам.
                </p>
              ) : !archived.length ? (
                <EmptyState title="Архів порожній" />
              ) : (
                <ArchiveList rows={archived} onOpen={(r) => setDetail(r)} />
              )}
            </SectionCard>
          )}
        </>
      )}

      <Sheet open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle>Часткове затвердження</SheetTitle>
          </SheetHeader>
          {edit && (
            <div className="mt-3 space-y-4 text-sm">
              <div className="rounded-xl border border-border p-3 text-xs space-y-1">
                <Line k="Філія" v={edit.branchName} />
                <Line k="Поставка" v={edit.shipmentCode} mono />
                <Line k="Товар" v={edit.product} />
                <Line k="Калібр" v={edit.caliber} />
                <Line k="Запитано" v={`${edit.pallets} п`} />
                <Line
                  k="Ціна філії"
                  v={edit.salePrice ? `${edit.salePrice} ${edit.saleCurrency ?? ""}/кг` : "—"}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">
                  Затвердити палет (1–{edit.pallets})
                </label>
                <Input
                  type="number"
                  min={1}
                  max={edit.pallets}
                  value={editPallets}
                  onChange={(e) => setEditPallets(e.target.value)}
                  inputMode="numeric"
                />
                <div className="text-[11px] text-muted-foreground">
                  ≈ {(Number(editPallets || 0) * edit.palletWeight).toLocaleString("uk-UA")} кг
                </div>
              </div>
              <Button
                onClick={() => approve(edit, Math.floor(Number(editPallets) || 0))}
                disabled={busyId === edit.id}
                className="w-full"
              >
                {busyId === edit.id ? "Збереження…" : "Затвердити"}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Line({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className={mono ? "font-mono font-semibold" : "font-medium"}>{v}</span>
    </div>
  );
}

function RequestList({
  rows,
  onApprove,
  onReject,
  onEdit,
  busyId,
  actions,
}: {
  rows: Row[];
  onApprove?: (r: Row) => void;
  onReject?: (r: Row) => void;
  onEdit?: (r: Row) => void;
  busyId: string | null;
  actions?: boolean;
}) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => {
        const busy = busyId === r.id;
        return (
          <li key={r.id} className="py-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{r.branchName}</div>
                <div className="text-[11px] text-muted-foreground">
                  <span className="font-mono font-semibold">{r.shipmentCode}</span>
                  {" · "}
                  {new Date(r.createdAt).toLocaleDateString("uk-UA")}
                </div>
              </div>
              <StatusChip status={r.status} kind="branch_request" />
            </div>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <Field label="Товар" value={r.product} />
              <Field label="Країна" value={r.country ? toUaCountry(r.country) : "—"} />
              <Field label="Калібр" value={r.caliber} />
              <Field label="Специфікація" value={r.variety ?? "—"} />
              <Field
                label="Палет"
                value={
                  r.approvedQty != null && r.status !== "pending"
                    ? `${r.approvedQty} / ${r.pallets} п`
                    : `${r.pallets} п`
                }
                bold
              />
              <Field
                label="Ціна філії"
                value={r.salePrice ? `${r.salePrice} ${r.saleCurrency ?? ""}/кг` : "—"}
                bold
              />
              <div className="col-span-2 flex items-center justify-between">
                <span className="text-muted-foreground">Інд / Інв</span>
                <CostPair indicative={r.indicative} invoice={r.invoice} suffix="/кг" size="xs" />
              </div>
            </div>

            {actions && (
              <div className="flex gap-2 pt-1">
                <Button
                  size="sm"
                  className="flex-1 bg-success text-success-foreground hover:bg-success/90"
                  disabled={busy}
                  onClick={() => onApprove?.(r)}
                >
                  <Check className="mr-1 h-3.5 w-3.5" /> Підтвердити
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => onEdit?.(r)}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" /> Редагувати
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  disabled={busy}
                  onClick={() => onReject?.(r)}
                >
                  <X className="mr-1 h-3.5 w-3.5" /> Відхилити
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Field({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={bold ? "font-bold tabular-nums" : "tabular-nums"}>{value}</span>
    </div>
  );
}
