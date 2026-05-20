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
        .in("status", ["active", "in_work", "confirmed", "linked", "closed", "expired", "deleted"])
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

  const managerIds = useMemo(
    () => Array.from(new Set((offers ?? []).map((o) => o.created_by).filter(Boolean))),
    [offers],
  );

  const { data: managerNames } = useQuery({
    queryKey: ["offer-manager-names", managerIds],
    enabled: managerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_profile_names", { _ids: managerIds });
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string | null }[];
    },
  });

  const responseByOffer = useMemo(() => {
    const m: Record<string, ManagerOfferResponse> = {};
    for (const r of myResponses ?? []) m[r.offer_id] = r;
    return m;
  }, [myResponses]);

  const visibleOffers = useMemo(() => {
    const list = offers ?? [];
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return list.filter((o) => {
      if (["active", "in_work", "confirmed", "linked"].includes(o.status)) return true;
      // closed / expired: show only to branches that responded, and only for 7 days
      if (!responseByOffer[o.id]) return false;
      const ts = new Date((o as ManagerOffer & { updated_at?: string }).updated_at ?? o.created_at).getTime();
      return ts >= cutoff;
    });
  }, [offers, responseByOffer]);

  const managerNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of managerNames ?? []) if (r.full_name) m[r.id] = r.full_name;
    return m;
  }, [managerNames]);

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
    onSuccess: (_, vars) => {
      toast.success("Запит надіслано", { id: `req-${vars.offerId}`, duration: 1500 });
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
      {!isLoading && visibleOffers.length === 0 && (
        <EmptyState title="Немає активних пропозицій" />
      )}
      <div className="space-y-3">
        {visibleOffers.map((o) => {
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
          const linkedQty = r ? Number((r as ManagerOfferResponse & { linked_pallets?: number }).linked_pallets ?? 0) : 0;
          const pendingQty = apprQty != null ? Math.max(apprQty - linkedQty, 0) : 0;
          const isSplit = o.status === "linked" && linkedQty > 0 && pendingQty > 0;

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
            <div
              key={o.id}
              className={cn(
                "rounded-2xl border bg-card p-4 shadow-sm",
                o.status === "deleted"
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-border",
              )}
            >
              {/* Header: product (country) + status */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold">{o.product_name}</span>
                {o.origin_country && (
                  <span className="text-sm text-muted-foreground">({o.origin_country})</span>
                )}
                {apprQty === 0 ? (
                  <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase bg-destructive/15 text-destructive">
                    Відмовлено
                  </span>
                ) : isSplit ? (
                  <>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase bg-primary/15 text-primary">
                      Замовлено · {linkedQty}
                    </span>
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase bg-warning/15 text-warning">
                      Підтверджено · {pendingQty}*
                    </span>
                  </>
                ) : (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                      STATUS_CLASS[o.status],
                    )}
                  >
                    {STATUS_LABEL[o.status]}
                  </span>
                )}
                {ship && (
                  <span className="text-sm text-success">
                    Поставка <b>{ship.code}</b>
                  </span>
                )}
              </div>

              {isSplit && (
                <div className="mt-1 text-xs text-warning">
                  * {pendingQty}п чекають на номер поставки
                </div>
              )}

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
                  linked={o.status === "linked"}
                />
                <CostLine
                  label="Собівартість інвойсна"
                  tone="destructive"
                  curr={Number(o.invoice_cost_usd ?? 0)}
                  prev={o.prev_invoice_cost_usd}
                  delta={invDelta}
                  linked={o.status === "linked"}
                />
              </div>

              {/* Responsible manager (confirmed/linked only) */}
              {(o.status === "linked" || o.status === "confirmed") && managerNameById[o.created_by] && (
                <div className="mt-1 text-sm text-muted-foreground">
                  Відповідальний менеджер:{" "}
                  <b className="text-foreground">{managerNameById[o.created_by]}</b>
                </div>
              )}

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

              {/* ETA change notice (after link) */}
              {o.status === "linked" && (o as OfferWithEtaPrev).prev_expected_eta &&
                (o as OfferWithEtaPrev).prev_expected_eta !== o.expected_eta && (
                <div className="mt-1 rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
                  <b>Дата заходу змінена:</b> було{" "}
                  <span className="line-through tabular-nums">
                    {fmtDate((o as OfferWithEtaPrev).prev_expected_eta)}
                  </span>{" "}
                  → стало <b className="tabular-nums">{fmtDate(o.expected_eta)}</b>
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
                {!["linked", "closed", "expired"].includes(o.status) ? (
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
  linked,
}: {
  label: string;
  tone: "success" | "destructive";
  curr: number;
  prev: number | null;
  delta: number;
  linked?: boolean;
}) {
  const changed = prev != null && delta !== 0;
  const toneCls = tone === "success" ? "text-success" : "text-destructive";
  return (
    <div className={cn("text-sm", toneCls)}>
      <span>{label}: </span>
      <b className="font-bold tabular-nums">${curr.toFixed(2)}</b>
      {changed && !linked && (
        <>
          <span className="ml-1 text-xs font-normal text-muted-foreground line-through">
            ${Number(prev).toFixed(2)}
          </span>
          <span
            className={cn(
              "ml-1 text-xs font-bold",
              delta < 0 ? "text-success" : "text-destructive",
            )}
          >
            ({delta > 0 ? "+" : ""}
            {delta.toFixed(2)})
          </span>
        </>
      )}
      {changed && linked && (
        <div
          className={cn(
            "mt-0.5 rounded-md px-2 py-1 text-xs font-normal",
            delta > 0
              ? "bg-destructive/10 text-destructive"
              : "bg-success/10 text-success",
          )}
        >
          <b>Собівартість змінено:</b> було{" "}
          <span className="line-through tabular-nums">${Number(prev).toFixed(2)}</span>{" "}
          → стало <b className="tabular-nums">${curr.toFixed(2)}</b>{" "}
          <b className="tabular-nums">
            ({delta > 0 ? "+" : ""}
            {delta.toFixed(2)})
          </b>
        </div>
      )}
    </div>
  );
}
