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

type OfferWithEtaPrev = ManagerOffer & { prev_expected_eta?: string | null };

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("uk-UA") : "—";

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

          const etaDate = ship?.arrived_at
            ? { label: "Дата прибуття", value: new Date(ship.arrived_at).toLocaleDateString("uk-UA") }
            : ship?.eta
            ? { label: "Очікувана дата", value: new Date(ship.eta).toLocaleDateString("uk-UA") }
            : o.expected_eta
            ? { label: "Очікувана дата", value: new Date(o.expected_eta).toLocaleDateString("uk-UA"), plan: true }
            : null;

          const details = [o.variety, o.caliber, o.packaging, o.specification]
            .filter(Boolean)
            .join(" • ");

          return (
            <div key={o.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              {/* Header: product (country) + status */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold">{o.product_name}</span>
                {o.origin_country && (
                  <span className="text-sm text-muted-foreground">({o.origin_country})</span>
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
                  <span className="text-sm text-success">
                    Поставка <b>{ship.code}</b>
                  </span>
                )}
              </div>

              {/* Details line */}
              {details && (
                <div className="mt-1 text-sm text-muted-foreground">{details}</div>
              )}

              {/* Costs */}
              <div className="mt-2 space-y-0.5">
                <CostLine
                  label="Собівартість індикативна"
                  tone="success"
                  curr={Number(o.indicative_cost_usd ?? 0)}
                  prev={o.prev_indicative_cost_usd}
                  delta={indDelta}
                />
                <CostLine
                  label="Собівартість інвойсна"
                  tone="destructive"
                  curr={Number(o.invoice_cost_usd ?? 0)}
                  prev={o.prev_invoice_cost_usd}
                  delta={invDelta}
                />
              </div>

              {/* Expected date */}
              {etaDate && (
                <div className="mt-1 text-sm text-muted-foreground">
                  {etaDate.label}:{" "}
                  <b className="text-foreground tabular-nums">{etaDate.value}</b>
                  {etaDate.plan && (
                    <span className="ml-1 text-[10px] uppercase tracking-wide">(план)</span>
                  )}
                </div>
              )}

              {/* Available quantity */}
              {o.offered_pallets != null && (
                <div className="mt-1 text-sm text-muted-foreground">
                  Доступна кількість: <b className="text-foreground tabular-nums">{o.offered_pallets}</b> палет
                </div>
              )}

              {o.expires_at && (
                <div className="mt-1 text-sm text-muted-foreground">
                  Залишок: <b className="text-foreground">{formatRemaining(o.expires_at)}</b>
                </div>
              )}

              {/* Desired quantity input */}
              <div className="mt-3 flex flex-wrap items-end gap-2">
                {o.status !== "linked" ? (
                  <>
                    <label className="text-sm">
                      <span className="mb-1 block text-muted-foreground">Бажана кількість, палет</span>
                      <Input
                        type="number"
                        min={0}
                        className="h-9 w-32 font-bold tabular-nums"
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
                  <div className="ml-auto text-right text-sm">
                    <div className="text-muted-foreground">
                      Запит: <b className="text-foreground tabular-nums">{reqQty}</b>
                    </div>
                    {apprQty != null && (
                      <div className="text-muted-foreground">
                        Підтв.:{" "}
                        <b
                          className={cn(
                            "tabular-nums",
                            palletDelta < 0 && "text-destructive",
                            palletDelta > 0 && "text-success",
                            palletDelta === 0 && "text-foreground",
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
  tone,
  curr,
  prev,
  delta,
}: {
  label: string;
  tone: "success" | "destructive";
  curr: number;
  prev: number | null;
  delta: number;
}) {
  const changed = prev != null && delta !== 0;
  const toneCls = tone === "success" ? "text-success" : "text-destructive";
  return (
    <div className={cn("text-sm", toneCls)}>
      <span>{label}: </span>
      <b className="font-bold tabular-nums">${curr.toFixed(2)}</b>
      {changed && (
        <span className="ml-1 text-xs font-normal text-muted-foreground line-through">
          ${Number(prev).toFixed(2)}
        </span>
      )}
      {changed && (
        <span
          className={cn(
            "ml-1 text-xs font-bold",
            delta < 0 ? "text-success" : "text-destructive",
          )}
        >
          ({delta > 0 ? "+" : ""}
          {delta.toFixed(2)})
        </span>
      )}
    </div>
  );
}
