import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { EmptyState } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableScroller } from "@/components/TableScroller";
import { CostPair } from "@/components/CostPair";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  STATUS_LABEL,
  STATUS_CLASS,
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
      // Show closed/deleted/expired only if this branch already engaged with the offer,
      // and only for the recent window so the inbox doesn't grow forever.
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
      {!isLoading && visibleOffers.length === 0 && (
        <EmptyState title="Немає активних пропозицій" />
      )}
      {visibleOffers.length > 0 && (
        <TableScroller className="-mx-2">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr className="border-b">
                <th className="px-2 py-2 text-left font-medium">Товар (Країна)</th>
                <th className="px-2 py-2 text-left font-medium">Сорт</th>
                <th className="px-2 py-2 text-left font-medium">Калібр</th>
                <th className="px-2 py-2 text-left font-medium">Специфікація</th>
                <th className="px-2 py-2 text-right font-medium">Собівартість</th>
                <th className="px-2 py-2 text-left font-medium">Менеджер</th>
                <th className="px-2 py-2 text-right font-medium">Доступно</th>
                <th className="px-2 py-2 text-right font-medium">Замовлення</th>
              </tr>
            </thead>
            <tbody>
              {visibleOffers.map((o) => {
                const r = responseByOffer[o.id];
                const draft = drafts[o.id] ?? (r ? String(r.requested_pallets) : "");
                const reqQty = r ? Number(r.requested_pallets) : 0;
                const apprQty = r?.approved_pallets != null ? Number(r.approved_pallets) : null;
                const palletDelta = apprQty != null ? apprQty - reqQty : 0;
                const locked = ["linked", "closed", "expired", "deleted"].includes(o.status);
                const statusLabel =
                  o.status === "deleted"
                    ? "Скасовано"
                    : o.status === "closed"
                    ? "Підтверджено"
                    : o.status === "linked"
                    ? "Замовлено"
                    : STATUS_LABEL[o.status];
                const statusCls =
                  o.status === "deleted"
                    ? "bg-destructive/15 text-destructive"
                    : o.status === "closed"
                    ? "bg-success/15 text-success"
                    : o.status === "linked"
                    ? "bg-primary/15 text-primary"
                    : STATUS_CLASS[o.status];


                return (
                  <tr
                    key={o.id}
                    className={cn(
                      "border-b align-top",
                      o.status === "closed" && "bg-destructive/5",
                    )}
                  >
                    <td className="px-2 py-2">
                      <div className="font-semibold">
                        {o.product_name}
                        {o.origin_country && (
                          <span className="font-normal text-muted-foreground">
                            {" "}({o.origin_country})
                          </span>
                        )}
                      </div>
                      <span
                        className={cn(
                          "mt-0.5 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                          statusCls,
                        )}
                      >
                        {statusLabel}
                      </span>
                    </td>
                    <td className="px-2 py-2">{o.variety || "—"}</td>
                    <td className="px-2 py-2">{o.caliber || "—"}</td>
                    <td className="px-2 py-2">
                      {[o.packaging, o.specification].filter(Boolean).join(" • ") || "—"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <CostPair
                        indicative={o.indicative_cost_usd}
                        invoice={o.invoice_cost_usd}
                      />
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {managerNameById[o.created_by] ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {o.offered_pallets != null ? `${o.offered_pallets}п` : "—"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {!locked ? (
                        <div className="flex items-center justify-end gap-1">
                          <Input
                            type="number"
                            min={0}
                            className="h-8 w-16 text-right font-bold tabular-nums"
                            value={draft}
                            onChange={(e) =>
                              setDrafts((p) => ({ ...p, [o.id]: e.target.value }))
                            }
                          />
                          <Button
                            size="sm"
                            className="h-8"
                            onClick={() => {
                              const n = Number(draft);
                              if (!Number.isFinite(n) || n < 0) {
                                toast.error("Введіть кількість");
                                return;
                              }
                              submit.mutate({ offerId: o.id, pallets: n });
                            }}
                          >
                            {r ? "OK" : "Запит"}
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                      {r && (
                        <div className="mt-1 text-[10px] text-muted-foreground">
                          Запит: <b className="text-foreground tabular-nums">{reqQty}</b>
                          {apprQty != null && (
                            <>
                              {" · "}Підтв.:{" "}
                              <b
                                className={cn(
                                  "tabular-nums",
                                  palletDelta < 0 && "text-destructive",
                                  palletDelta > 0 && "text-success",
                                  palletDelta === 0 && "text-foreground",
                                )}
                              >
                                {apprQty}
                              </b>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroller>
      )}
    </div>
  );
}
