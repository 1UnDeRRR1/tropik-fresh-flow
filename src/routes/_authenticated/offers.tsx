import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
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

  // Lazy-expire on mount
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

  const [accepting, setAccepting] = useState<OfferRow | null>(null);
  const [acceptQty, setAcceptQty] = useState(0);

  const decide = useMutation({
    mutationFn: async (vars: { id: string; accepted: number; reject?: boolean }) => {
      const status = vars.reject
        ? "rejected"
        : vars.accepted === accepting?.offered_pallets
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
      setAccepting(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "Помилка"),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Пропозиції" subtitle="Передача між філіями" />

      <Tabs defaultValue="received">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="received">Вхідні {received?.filter((o) => o.status === "pending").length ? `· ${received.filter((o) => o.status === "pending").length}` : ""}</TabsTrigger>
          <TabsTrigger value="sent">Відправлені</TabsTrigger>
        </TabsList>

        <TabsContent value="received" className="mt-4">
          {!received?.length ? (
            <EmptyState title="Немає вхідних пропозицій" />
          ) : (
            <ul className="space-y-2">
              {received.map((o) => (
                <li key={o.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      від <span className="font-semibold text-foreground">{o.from_branch?.name ?? "—"}</span>
                    </div>
                    <StatusChip status={o.status} />
                  </div>
                  <div className="text-sm font-semibold">{o.shipment_items?.product_name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {o.shipment_items?.shipments?.code} · ETA {fmtEta(o.shipment_items?.shipments?.eta)}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="text-sm tabular-nums">
                      <span className="font-bold">{o.offered_pallets}п</span>
                      {o.accepted_pallets > 0 && (
                        <span className="ml-2 text-success">прийнято {o.accepted_pallets}п</span>
                      )}
                    </div>
                    {o.status === "pending" && (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => decide.mutate({ id: o.id, accepted: 0, reject: true })}
                        >
                          Відхилити
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => {
                            setAccepting(o);
                            setAcceptQty(o.offered_pallets);
                          }}
                        >
                          Прийняти
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="sent" className="mt-4">
          {!sent?.length ? (
            <EmptyState title="Ви не відправляли пропозицій" />
          ) : (
            <ul className="space-y-2">
              {sent.map((o) => (
                <li key={o.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-xs text-muted-foreground">
                      до <span className="font-semibold text-foreground">{o.to_branch?.name ?? "—"}</span>
                    </div>
                    <StatusChip status={o.status} />
                  </div>
                  <div className="text-sm font-semibold">{o.shipment_items?.product_name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {o.shipment_items?.shipments?.code} · ETA {fmtEta(o.shipment_items?.shipments?.eta)}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
                    <div className="rounded-lg bg-muted/40 py-1">
                      <div className="font-bold tabular-nums">{o.offered_pallets}п</div>
                      <div className="text-muted-foreground">запропоновано</div>
                    </div>
                    <div className="rounded-lg bg-success/10 py-1">
                      <div className="font-bold tabular-nums text-success">{o.accepted_pallets}п</div>
                      <div className="text-muted-foreground">прийнято</div>
                    </div>
                    <div className="rounded-lg bg-warning/10 py-1">
                      <div className="font-bold tabular-nums">
                        {o.status === "pending"
                          ? o.offered_pallets - o.accepted_pallets
                          : 0}
                        п
                      </div>
                      <div className="text-muted-foreground">очікує</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <Sheet open={!!accepting} onOpenChange={(o) => !o && setAccepting(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle>Прийняти пропозицію</SheetTitle>
          </SheetHeader>
          {accepting && (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
                <div className="font-semibold">{accepting.shipment_items?.product_name}</div>
                <div className="text-xs text-muted-foreground">
                  від {accepting.from_branch?.name} · запропоновано {accepting.offered_pallets}п
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Прийняти палет
                </label>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={() => setAcceptQty((p) => Math.max(1, p - 1))}>−</Button>
                  <Input
                    type="number"
                    min={1}
                    max={accepting.offered_pallets}
                    value={acceptQty}
                    onChange={(e) => setAcceptQty(Math.max(1, Math.min(accepting.offered_pallets, Number(e.target.value) || 1)))}
                    className="text-center"
                  />
                  <Button variant="outline" size="icon" onClick={() => setAcceptQty((p) => Math.min(accepting.offered_pallets, p + 1))}>+</Button>
                </div>
              </div>
              <Button
                className="w-full"
                disabled={decide.isPending || acceptQty < 1}
                onClick={() => decide.mutate({ id: accepting.id, accepted: acceptQty })}
              >
                {acceptQty === accepting.offered_pallets ? "Прийняти повністю" : `Прийняти ${acceptQty}п`}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
