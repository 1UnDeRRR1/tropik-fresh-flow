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
  shipment_items?: {
    product_name: string;
    caliber: string | null;
    shipments?: { code: string; eta: string | null } | null;
  } | null;
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

  const { data: sent } = useQuery({
    queryKey: ["offers", "sent", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("branch_transfer_offers")
        .select(`
          id,shipment_item_id,from_branch_id,to_branch_id,offered_pallets,accepted_pallets,status,created_at,
          to_branch:branches!to_branch_id(name),
          shipment_items(product_name,caliber, shipments(code,eta))
        `)
        .eq("from_branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OfferRow[];
    },
  });

  const { data: received } = useQuery({
    queryKey: ["offers", "received", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("branch_transfer_offers")
        .select(`
          id,shipment_item_id,from_branch_id,to_branch_id,offered_pallets,accepted_pallets,status,created_at,
          from_branch:branches!from_branch_id(name),
          shipment_items(product_name,caliber, shipments(code,eta))
        `)
        .eq("to_branch_id", branchId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OfferRow[];
    },
  });

  // Group sent offers by shipment+product
  const sentGroups = useMemo(() => {
    const map = new Map<string, { code: string; product: string; caliber?: string | null; rows: OfferRow[] }>();
    for (const o of sent ?? []) {
      const code = o.shipment_items?.shipments?.code ?? "—";
      const product = o.shipment_items?.product_name ?? "—";
      const key = `${code}::${product}::${o.shipment_item_id}`;
      if (!map.has(key)) map.set(key, { code, product, caliber: o.shipment_items?.caliber, rows: [] });
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

  return (
    <div className="space-y-4">
      <PageHeader title="Пропозиції" subtitle="Передача між філіями" />

      <Tabs defaultValue="received">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="received">
            ВХІДНІ {incomingPending ? `· ${incomingPending}` : ""}
          </TabsTrigger>
          <TabsTrigger value="sent">ВІДПРАВЛЕНІ</TabsTrigger>
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
                    {o.shipment_items?.shipments?.code} · {o.shipment_items?.product_name}
                    {o.shipment_items?.caliber ? ` · ${o.shipment_items.caliber}` : ""}
                    {" · "}
                    <span className="text-primary">{o.offered_pallets}п</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    ETA {fmtEta(o.shipment_items?.shipments?.eta)}
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
                    {g.code} · {g.product}
                    {g.caliber ? ` · ${g.caliber}` : ""}
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
                  {actioning.shipment_items?.shipments?.code} · {actioning.shipment_items?.product_name}
                </div>
                <div className="text-xs text-muted-foreground">
                  Запропоновано {actioning.offered_pallets}п · ETA {fmtEta(actioning.shipment_items?.shipments?.eta)}
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
