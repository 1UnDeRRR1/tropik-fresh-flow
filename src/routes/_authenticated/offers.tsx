import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { EmptyState } from "@/components/cards";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/offers")({
  component: OffersPage,
});

const STATUS_LABEL: Record<string, string> = {
  pending: "Очікує",
  partially_accepted: "Частково",
  accepted: "Прийнято",
  rejected: "Відхилено",
  expired: "Протерміновано",
};

const STATUS_CLASS: Record<string, string> = {
  pending: "bg-warning/15 text-warning",
  partially_accepted: "bg-info/15 text-info",
  accepted: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  expired: "bg-muted text-muted-foreground",
};

type OfferRow = {
  id: string;
  shipment_item_id: string;
  from_branch_id: string;
  to_branch_id: string;
  offered_pallets: number;
  accepted_pallets: number;
  status: string;
  created_at: string;
  from_branch?: { name: string } | null;
  to_branch?: { name: string } | null;
  // hydrated client-side from branch views
  product_name?: string;
  caliber?: string | null;
  variety?: string | null;
  origin_country?: string | null;
  pallet_weight?: number | null;
  final_cost_indicative?: number | null;
  final_cost_invoice?: number | null;
  shipment_code?: string;
  shipment_eta?: string | null;
};

function fmtEta(eta: string | null | undefined) {
  if (!eta) return "—";
  return new Date(eta).toLocaleDateString("uk-UA", { day: "2-digit", month: "short" });
}

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_CLASS[status] ?? "bg-muted"}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function OffersPage() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id;
  const qc = useQueryClient();

  useEffect(() => {
    (supabase as any).rpc("expire_branch_transfer_offers").then(() => {
      qc.invalidateQueries({ queryKey: ["offers"] });
    });
  }, [qc]);

  const { data: sentRaw } = useQuery({
    queryKey: ["offers", "sent", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("branch_transfer_offers")
        .select(`
          id,shipment_item_id,from_branch_id,to_branch_id,offered_pallets,accepted_pallets,status,created_at,
          to_branch:branches!to_branch_id(name)
        `)
        .eq("from_branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OfferRow[];
    },
  });

  const { data: receivedRaw } = useQuery({
    queryKey: ["offers", "received", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("branch_transfer_offers")
        .select(`
          id,shipment_item_id,from_branch_id,to_branch_id,offered_pallets,accepted_pallets,status,created_at,
          from_branch:branches!from_branch_id(name)
        `)
        .eq("to_branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OfferRow[];
    },
  });

  // Hydrate product/shipment info via branch-safe views (no purchase prices).
  const itemIds = useMemo(
    () => Array.from(new Set([...(sentRaw ?? []), ...(receivedRaw ?? [])].map((o) => o.shipment_item_id).filter(Boolean))),
    [sentRaw, receivedRaw],
  );

  const { data: itemsInfo } = useQuery({
    queryKey: ["offers-items", itemIds.join(",")],
    enabled: itemIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipment_items_branch")
        .select("id,shipment_id,product_name,caliber,variety,origin_country,pallet_weight,final_cost_indicative,final_cost_invoice")
        .in("id", itemIds);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; shipment_id: string; product_name: string; caliber: string | null; variety: string | null; origin_country: string | null; pallet_weight: number | null; final_cost_indicative: number | null; final_cost_invoice: number | null }>;
    },
  });

  const shipmentIds = useMemo(
    () => Array.from(new Set((itemsInfo ?? []).map((i) => i.shipment_id))),
    [itemsInfo],
  );

  const { data: shipsInfo } = useQuery({
    queryKey: ["offers-ships", shipmentIds.join(",")],
    enabled: shipmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipments_branch")
        .select("id,code,eta,country")
        .in("id", shipmentIds);
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; code: string; eta: string | null; country: string | null }>;
    },
  });

  const hydrate = (list: OfferRow[] | undefined): OfferRow[] => {
    if (!list) return [];
    const iMap = new Map((itemsInfo ?? []).map((i) => [i.id, i]));
    const sMap = new Map((shipsInfo ?? []).map((s) => [s.id, s]));
    return list.map((o) => {
      const it = iMap.get(o.shipment_item_id);
      const sh = it ? sMap.get(it.shipment_id) : null;
      return {
        ...o,
        product_name: it?.product_name,
        caliber: it?.caliber ?? null,
        variety: it?.variety ?? null,
        origin_country: it?.origin_country ?? sh?.country ?? null,
        pallet_weight: it?.pallet_weight ?? null,
        final_cost_indicative: it?.final_cost_indicative ?? null,
        final_cost_invoice: it?.final_cost_invoice ?? null,
        shipment_code: sh?.code,
        shipment_eta: sh?.eta ?? null,
      };
    });
  };

  const sent = useMemo(() => hydrate(sentRaw), [sentRaw, itemsInfo, shipsInfo]);
  const received = useMemo(() => hydrate(receivedRaw), [receivedRaw, itemsInfo, shipsInfo]);

  // Group sent offers by shipment+product
  const sentGroups = useMemo(() => {
    const map = new Map<string, { code: string; product: string; caliber?: string | null; origin_country?: string | null; final_cost_indicative?: number | null; final_cost_invoice?: number | null; shipment_eta?: string | null; rows: OfferRow[] }>();
    for (const o of sent) {
      const code = o.shipment_code ?? "—";
      const product = o.product_name ?? "—";
      const key = `${code}::${product}::${o.shipment_item_id}`;
      if (!map.has(key)) map.set(key, { code, product, caliber: o.caliber, origin_country: o.origin_country ?? null, final_cost_indicative: o.final_cost_indicative ?? null, final_cost_invoice: o.final_cost_invoice ?? null, shipment_eta: o.shipment_eta ?? null, rows: [] });
      map.get(key)!.rows.push(o);
    }
    return [...map.values()];
  }, [sent]);

  const [actioning, setActioning] = useState<OfferRow | null>(null);
  const [mode, setMode] = useState<"choose" | "partial">("choose");
  const [acceptQty, setAcceptQty] = useState(0);

  const openAction = (o: OfferRow) => {
    setActioning(o);
    setMode("choose");
    setAcceptQty(o.offered_pallets);
  };

  const decide = useMutation({
    mutationFn: async (vars: { id: string; accepted: number; reject?: boolean }) => {
      const status = vars.reject
        ? "rejected"
        : vars.accepted >= (actioning?.offered_pallets ?? 0)
          ? "accepted"
          : "partially_accepted";
      const payload: any = {
        accepted_pallets: vars.reject ? 0 : vars.accepted,
        status,
        decided_at: new Date().toISOString(),
      };
      const { error } = await (supabase as any)
        .from("branch_transfer_offers")
        .update(payload)
        .eq("id", vars.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Виконано");
      qc.invalidateQueries({ queryKey: ["offers"] });
      qc.invalidateQueries({ queryKey: ["branch-incoming"] });
      qc.invalidateQueries({ queryKey: ["branch-outgoing-offers"] });
      setActioning(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Помилка"),
  });

  const incomingPending = received?.filter((o) => o.status === "pending").length ?? 0;
  const sentPending = sent?.filter((o) => o.status === "pending").length ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader title="Переміщення між філіями" subtitle="Передача між філіями" />

      <Tabs defaultValue="received">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger
            value="received"
            className="data-[state=active]:bg-yellow-100 data-[state=active]:text-yellow-900 dark:data-[state=active]:bg-yellow-500/15 dark:data-[state=active]:text-yellow-200"
          >
            ВХІДНІ
            {incomingPending > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-yellow-200 px-1.5 text-[11px] font-bold text-yellow-900 dark:bg-yellow-500/30 dark:text-yellow-100">
                {incomingPending}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="sent"
            className="data-[state=active]:bg-sky-100 data-[state=active]:text-sky-900 dark:data-[state=active]:bg-sky-500/15 dark:data-[state=active]:text-sky-200"
          >
            ВІДПРАВЛЕНІ
            {sentPending > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-200 px-1.5 text-[11px] font-bold text-sky-900 dark:bg-sky-500/30 dark:text-sky-100">
                {sentPending}
              </span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="received" className="mt-4">
          {!received?.length ? (
            <EmptyState title="Немає вхідних пропозицій" />
          ) : (
            <ul className="space-y-2">
              {received.map((o) => (
                <li
                  key={o.id}
                  onClick={() => o.status === "pending" && openAction(o)}
                  className={`rounded-xl border border-border bg-card p-3 ${
                    o.status === "pending" ? "cursor-pointer active:bg-muted/50" : ""
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">{o.from_branch?.name ?? "—"}</span> пропонує
                    </div>
                    <StatusChip status={o.status} />
                  </div>
                  <div className="text-sm font-semibold">
                    {o.shipment_code ?? "—"} · {o.product_name ?? "—"}{o.origin_country ? ` (${o.origin_country})` : ""}
                    {o.caliber ? ` · ${o.caliber}` : ""}
                    {" · "}
                    <span className="text-primary">{o.offered_pallets}п</span>
                  </div>
                  {(o.final_cost_indicative != null || o.final_cost_invoice != null) && (
                    <div className="mt-1 text-xs">
                      <span className="text-success font-semibold tabular-nums">
                        ${Number(o.final_cost_indicative ?? 0).toFixed(2)}
                      </span>
                      <span className="mx-1 text-muted-foreground">/</span>
                      <span className="text-destructive font-semibold tabular-nums">
                        ${Number(o.final_cost_invoice ?? 0).toFixed(2)}
                      </span>
                      <span className="ml-1 text-muted-foreground">собівартість</span>
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground">
                    ETA {fmtEta(o.shipment_eta)}
                    {o.accepted_pallets > 0 && (
                      <span className="ml-2 text-success">прийнято {o.accepted_pallets}п</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="sent" className="mt-4">
          {!sentGroups.length ? (
            <EmptyState title="Ви не відправляли пропозицій" />
          ) : (
            <ul className="space-y-3">
              {sentGroups.map((g, i) => (
                <li key={i} className="rounded-xl border border-border bg-card p-3">
                  <div className="text-sm font-semibold">
                    {g.code} · {g.product}{g.origin_country ? ` (${g.origin_country})` : ""}
                    {g.caliber ? ` · ${g.caliber}` : ""}
                  </div>
                  {(g.final_cost_indicative != null || g.final_cost_invoice != null) && (
                    <div className="mt-1 text-xs">
                      <span className="text-success font-semibold tabular-nums">
                        ${Number(g.final_cost_indicative ?? 0).toFixed(2)}
                      </span>
                      <span className="mx-1 text-muted-foreground">/</span>
                      <span className="text-destructive font-semibold tabular-nums">
                        ${Number(g.final_cost_invoice ?? 0).toFixed(2)}
                      </span>
                      <span className="ml-1 text-muted-foreground">собівартість</span>
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground">
                    ETA {fmtEta(g.shipment_eta)}
                  </div>
                  <ul className="mt-2 space-y-1">
                    {g.rows.map((r) => (
                      <li key={r.id} className="flex items-center justify-between text-sm">
                        <span className="text-foreground">
                          {r.to_branch?.name ?? "—"}:{" "}
                          <span className="font-bold tabular-nums">{r.offered_pallets}п</span>
                          {r.accepted_pallets > 0 && r.accepted_pallets !== r.offered_pallets && (
                            <span className="ml-1 text-xs text-success">
                              ({r.accepted_pallets}п прийнято)
                            </span>
                          )}
                        </span>
                        <StatusChip status={r.status} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <Sheet open={!!actioning} onOpenChange={(o) => !o && setActioning(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle>Пропозиція від {actioning?.from_branch?.name ?? "—"}</SheetTitle>
          </SheetHeader>
          {actioning && (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
                <div className="font-semibold">
                  {actioning.shipment_code ?? "—"} · {actioning.product_name ?? "—"}{actioning.origin_country ? ` (${actioning.origin_country})` : ""}
                  {actioning.caliber ? ` · ${actioning.caliber}` : ""}
                  {actioning.variety ? ` · ${actioning.variety}` : ""}
                </div>
                {(actioning.final_cost_indicative != null || actioning.final_cost_invoice != null) && (
                  <div className="mt-1 text-xs">
                    Собівартість:{" "}
                    <span className="text-success font-semibold tabular-nums">
                      ${Number(actioning.final_cost_indicative ?? 0).toFixed(2)}
                    </span>
                    <span className="mx-1 text-muted-foreground">/</span>
                    <span className="text-destructive font-semibold tabular-nums">
                      ${Number(actioning.final_cost_invoice ?? 0).toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="text-xs text-muted-foreground">
                  Запропоновано {actioning.offered_pallets}п · ETA {fmtEta(actioning.shipment_eta)}
                </div>
              </div>

              {mode === "choose" ? (
                <div className="space-y-2">
                  <Button
                    className="w-full"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: actioning.id, accepted: actioning.offered_pallets })}
                  >
                    Прийняти все ({actioning.offered_pallets}п)
                  </Button>
                  <Button
                    className="w-full"
                    variant="outline"
                    disabled={actioning.offered_pallets <= 1}
                    onClick={() => {
                      setMode("partial");
                      setAcceptQty(Math.max(1, Math.min(actioning.offered_pallets - 1, 1)));
                    }}
                  >
                    Прийняти частково
                  </Button>
                  <Button
                    className="w-full"
                    variant="destructive"
                    disabled={decide.isPending}
                    onClick={() => decide.mutate({ id: actioning.id, accepted: 0, reject: true })}
                  >
                    Відхилити
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Прийняти палет (макс {actioning.offered_pallets})
                    </label>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" onClick={() => setAcceptQty((p) => Math.max(1, p - 1))}>−</Button>
                      <Input
                        type="number"
                        min={1}
                        max={actioning.offered_pallets}
                        value={acceptQty}
                        onChange={(e) =>
                          setAcceptQty(
                            Math.max(1, Math.min(actioning.offered_pallets, Number(e.target.value) || 1)),
                          )
                        }
                        className="text-center"
                      />
                      <Button variant="outline" size="icon" onClick={() => setAcceptQty((p) => Math.min(actioning.offered_pallets, p + 1))}>+</Button>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setMode("choose")}>
                      Назад
                    </Button>
                    <Button
                      className="flex-1"
                      disabled={decide.isPending || acceptQty < 1}
                      onClick={() => decide.mutate({ id: actioning.id, accepted: acceptQty })}
                    >
                      Прийняти {acceptQty}п
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
