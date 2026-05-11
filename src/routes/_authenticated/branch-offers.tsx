import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { EmptyState } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  STATUS_LABEL,
  STATUS_CLASS,
  formatRemaining,
  type ManagerOffer,
  type ManagerOfferResponse,
} from "@/lib/manager-offers";

export const Route = createFileRoute("/_authenticated/branch-offers")({
  component: BranchOffersPage,
});

function BranchOffersPage() {
  const { profile } = useAuth();
  const branchId = profile?.branch_id ?? null;
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const { data: offers, isLoading } = useQuery({
    queryKey: ["branch-active-offers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_offers")
        .select("*")
        .in("status", ["active", "in_work", "confirmed", "linked"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ManagerOffer[];
    },
  });

  const { data: myResponses } = useQuery({
    queryKey: ["my-branch-responses", branchId],
    enabled: !!branchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_offer_responses")
        .select("*")
        .eq("branch_id", branchId!);
      if (error) throw error;
      return (data ?? []) as ManagerOfferResponse[];
    },
  });

  const { data: shipments } = useQuery({
    queryKey: ["branch-offer-shipments"],
    queryFn: async () => {
      const { data, error } = await supabase.from("shipments").select("id,code,eta,arrived_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const responseByOffer = useMemo(() => {
    const m: Record<string, ManagerOfferResponse> = {};
    for (const r of myResponses ?? []) m[r.offer_id] = r;
    return m;
  }, [myResponses]);

  const shipmentById = useMemo(() => {
    const m: Record<string, { code: string; eta: string | null; arrived_at: string | null }> = {};
    for (const s of shipments ?? []) m[s.id] = { code: s.code, eta: s.eta, arrived_at: (s as { arrived_at: string | null }).arrived_at };
    return m;
  }, [shipments]);

  const submit = useMutation({
    mutationFn: async ({ offerId, pallets }: { offerId: string; pallets: number }) => {
      if (!branchId) throw new Error("Філія не вказана у профілі");
      const existing = responseByOffer[offerId];
      if (existing) {
        const { error } = await supabase
          .from("manager_offer_responses")
          .update({ requested_pallets: pallets })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("manager_offer_responses")
          .insert({ offer_id: offerId, branch_id: branchId, requested_pallets: pallets });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Запит надіслано");
      qc.invalidateQueries({ queryKey: ["my-branch-responses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!branchId) {
    return (
      <div>
        <PageHeader title="Пропозиції ЗЕД" />
        <EmptyState title="Філія не вказана" hint="Зверніться до адміністратора" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Пропозиції ЗЕД"
        subtitle="Активні пропозиції менеджерів. Введіть бажану кількість палет."
      />
      {isLoading && <p className="text-sm text-muted-foreground">Завантаження…</p>}
      {!isLoading && (offers ?? []).length === 0 && (
        <EmptyState title="Немає активних пропозицій" />
      )}
      <div className="space-y-3">
        {(offers ?? []).map((o) => {
          const r = responseByOffer[o.id];
          const draft = drafts[o.id] ?? (r ? String(r.requested_pallets) : "");
          const ship = o.linked_shipment_id ? shipmentById[o.linked_shipment_id] : null;

          // cost change indicator
          const indDelta =
            o.prev_indicative_cost_usd != null
              ? Number(o.indicative_cost_usd ?? 0) - Number(o.prev_indicative_cost_usd)
              : 0;
          const invDelta =
            o.prev_invoice_cost_usd != null
              ? Number(o.invoice_cost_usd ?? 0) - Number(o.prev_invoice_cost_usd)
              : 0;

          // pallets diff
          const reqQty = r ? Number(r.requested_pallets) : 0;
          const apprQty = r?.approved_pallets != null ? Number(r.approved_pallets) : null;
          const palletDelta = apprQty != null ? apprQty - reqQty : 0;

          return (
            <div key={o.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-bold">{o.product_name}</span>
                    {o.origin_country && (
                      <span className="text-sm text-muted-foreground">{o.origin_country}</span>
                    )}
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                        o.status === "linked"
                          ? "bg-success/15 text-success"
                          : STATUS_CLASS[o.status],
                      )}
                    >
                      {o.status === "linked" ? "Підтверджено" : STATUS_LABEL[o.status]}
                    </span>
                    {ship && (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-success">
                        <span>
                          Поставка <b>{ship.code}</b>
                        </span>
                        {ship.arrived_at ? (
                          <span>
                            Дата прибуття:{" "}
                            <b>{new Date(ship.arrived_at).toLocaleDateString("uk-UA")}</b>
                          </span>
                        ) : ship.eta ? (
                          <span>
                            Очікувана дата:{" "}
                            <b>{new Date(ship.eta).toLocaleDateString("uk-UA")}</b>
                          </span>
                        ) : null}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {[o.caliber, o.packaging, o.specification, o.variety]
                      .filter(Boolean)
                      .join(" • ")}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <CostLine
                      label="Індикативна"
                      curr={Number(o.indicative_cost_usd ?? 0)}
                      prev={o.prev_indicative_cost_usd}
                      delta={indDelta}
                    />
                    <CostLine
                      label="Інвойсна"
                      curr={Number(o.invoice_cost_usd ?? 0)}
                      prev={o.prev_invoice_cost_usd}
                      delta={invDelta}
                    />
                  </div>
                  {o.expires_at && (
                    <div className="mt-1 text-xs text-muted-foreground">
                      Залишок: {formatRemaining(o.expires_at)}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  {o.offered_pallets != null && (
                    <div className="text-xs text-muted-foreground">
                      Пропоновано: <b>{o.offered_pallets}</b> палет
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-end gap-2">
                {o.status !== "linked" ? (
                  <>
                    <label className="text-xs">
                      <span className="mb-1 block text-muted-foreground">Бажана к-сть, палет</span>
                      <Input
                        type="number"
                        min={0}
                        className="h-9 w-32"
                        value={draft}
                        onChange={(e) => setDrafts((p) => ({ ...p, [o.id]: e.target.value }))}
                      />
                    </label>
                    <Button
                      size="sm"
                      onClick={() => {
                        const n = Number(draft);
                        if (!Number.isFinite(n) || n < 0) {
                          toast.error("Введіть кількість");
                          return;
                        }
                        submit.mutate({ offerId: o.id, pallets: n });
                      }}
                    >
                      {r ? "Оновити" : "Запитати"}
                    </Button>
                  </>
                ) : null}

                {r && (
                  <div className="ml-auto text-right text-xs">
                    <div>
                      Запит: <b>{reqQty}</b>
                    </div>
                    {apprQty != null && (
                      <div>
                        Підтв.:{" "}
                        <b
                          className={cn(
                            palletDelta < 0 && "text-destructive",
                            palletDelta > 0 && "text-success",
                          )}
                        >
                          {apprQty}
                          {palletDelta !== 0 && (
                            <span className="ml-1">
                              ({palletDelta > 0 ? "+" : ""}
                              {palletDelta})
                            </span>
                          )}
                        </b>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CostLine({
  label,
  curr,
  prev,
  delta,
}: {
  label: string;
  curr: number;
  prev: number | null;
  delta: number;
}) {
  const changed = prev != null && delta !== 0;
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      <b
        className={cn(
          changed && delta < 0 && "text-success",
          changed && delta > 0 && "text-destructive",
        )}
      >
        ${curr.toFixed(2)}
      </b>
      {changed && (
        <span className="ml-1 text-[10px] text-muted-foreground line-through">
          ${Number(prev).toFixed(2)}
        </span>
      )}
    </div>
  );
}
