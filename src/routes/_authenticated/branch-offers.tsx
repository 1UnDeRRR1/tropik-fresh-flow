import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { EmptyState } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import {
  formatRemaining,
  type ManagerOffer,
  type ManagerOfferResponse,
} from "@/lib/manager-offers";
import { SortByMenu, type SortKey } from "@/components/SortByMenu";
import {
  getBranchOfferStatus,
  toneClass,
  isRealShipmentCode,
  type BranchOfferStatusKind,
} from "@/lib/branch-offer-status";

const STATUS_SORT_PRIORITY: Record<BranchOfferStatusKind, number> = {
  waiting: 0,
  confirmed: 1,
  rejected: 2,
  cancelled: 3,
  shipped: 4,
  none: 5,
};

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
  const [sortBy, setSortBy] = useState<SortKey>("date");
  const [fProduct, setFProduct] = useState<string>("");
  const [fCountry, setFCountry] = useState<string>("");
  const [fManager, setFManager] = useState<string>("");
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);





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
      const { data, error } = await (supabase as any).from("shipments_branch").select("id,code,eta,arrived_at");
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

  const baseVisibleOffers = useMemo(() => {
    const list = offers ?? [];
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return list.filter((o) => {
      if (["active", "in_work", "confirmed", "linked"].includes(o.status)) return true;
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

  // Filter options derived ONLY from rows visible to this branch
  const productOptions = useMemo(
    () => Array.from(new Set(baseVisibleOffers.map((o) => o.product_name).filter(Boolean))).sort((a, b) => a.localeCompare(b, "uk")),
    [baseVisibleOffers],
  );
  const countryOptions = useMemo(
    () => Array.from(new Set(baseVisibleOffers.map((o) => o.origin_country).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "uk")),
    [baseVisibleOffers],
  );
  const managerOptions = useMemo(() => {
    const ids = Array.from(new Set(baseVisibleOffers.map((o) => o.created_by).filter(Boolean)));
    return ids
      .map((id) => ({ id, name: managerNameById[id] ?? "" }))
      .filter((m) => m.name)
      .sort((a, b) => a.name.localeCompare(b.name, "uk"));
  }, [baseVisibleOffers, managerNameById]);

  const shipmentById = useMemo(() => {
    const m: Record<string, { code: string; eta: string | null; arrived_at: string | null }> = {};
    for (const s of shipments ?? []) m[s.id] = { code: s.code, eta: s.eta, arrived_at: (s as { arrived_at: string | null }).arrived_at };
    return m;
  }, [shipments]);

  const visibleOffers = useMemo(() => {
    const arrivalDate = (o: ManagerOffer): string | null => {
      const ship = o.linked_shipment_id ? shipmentById[o.linked_shipment_id] : null;
      return ship?.arrived_at || ship?.eta || o.expected_eta || null;
    };
    const eventTs = (o: ManagerOffer): number =>
      new Date((o as ManagerOffer & { updated_at?: string }).updated_at ?? o.created_at).getTime();
    const shipCodeOf = (o: ManagerOffer): string | null =>
      o.linked_shipment_id ? shipmentById[o.linked_shipment_id]?.code ?? null : null;

    const filtered = baseVisibleOffers.filter((o) => {
      if (fProduct && o.product_name !== fProduct) return false;
      if (fCountry && o.origin_country !== fCountry) return false;
      if (fManager && o.created_by !== fManager) return false;
      // Real shipment code → row has left the active "Пропозиції ЗЕД" workflow.
      if (isRealShipmentCode(shipCodeOf(o))) return false;
      return true;
    });
    const sorted = [...filtered];
    if (sortBy === "date") {
      sorted.sort((a, b) => {
        const da = arrivalDate(a), db = arrivalDate(b);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return da.localeCompare(db);
      });
    } else if (sortBy === "name") {
      sorted.sort((a, b) => (a.product_name ?? "").localeCompare(b.product_name ?? "", "uk"));
    } else if (sortBy === "status") {
      sorted.sort((a, b) => {
        const sa = getBranchOfferStatus(a, responseByOffer[a.id] ?? null, shipCodeOf(a));
        const sb = getBranchOfferStatus(b, responseByOffer[b.id] ?? null, shipCodeOf(b));
        return STATUS_SORT_PRIORITY[sa.kind] - STATUS_SORT_PRIORITY[sb.kind];
      });
    } else if (sortBy === "last_event") {
      sorted.sort((a, b) => eventTs(b) - eventTs(a));
    }
    return sorted;
  }, [baseVisibleOffers, shipmentById, sortBy, fProduct, fCountry, fManager, responseByOffer]);



  const submit = useMutation({
    mutationFn: async ({ offerId, pallets }: { offerId: string; pallets: number }) => {
      if (!branchId) throw new Error("Філія не вказана у профілі");
      const existing = responseByOffer[offerId];
      if (existing) {
        const changed = Number(existing.requested_pallets) !== pallets;
        const { error } = await supabase
          .from("manager_offer_responses")
          .update(
            changed
              ? { requested_pallets: pallets, approved_pallets: null }
              : { requested_pallets: pallets },
          )
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
      // Block 2: auto-close the detail dialog after a successful request,
      // returning the user to the compact "Пропозиції" table.
      setSelectedOfferId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelRequest = useMutation({
    mutationFn: async (responseId: string) => {
      const { error } = await supabase
        .from("manager_offer_responses")
        .delete()
        .eq("id", responseId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Запит скасовано", { duration: 1500 });
      qc.invalidateQueries({ queryKey: ["my-branch-responses"] });
      setSelectedOfferId(null);
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
      />
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {productOptions.length > 1 && (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={fProduct}
              onChange={(e) => setFProduct(e.target.value)}
            >
              <option value="">Усі товари</option>
              {productOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {countryOptions.length > 1 && (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={fCountry}
              onChange={(e) => setFCountry(e.target.value)}
            >
              <option value="">Усі країни</option>
              {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          {managerOptions.length > 1 && (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={fManager}
              onChange={(e) => setFManager(e.target.value)}
            >
              <option value="">Усі менеджери</option>
              {managerOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          {(fProduct || fCountry || fManager) && (
            <Button size="sm" variant="ghost" onClick={() => { setFProduct(""); setFCountry(""); setFManager(""); }}>
              Скинути
            </Button>
          )}
        </div>
        <SortByMenu value={sortBy} onChange={setSortBy} />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Завантаження…</p>}
      {!isLoading && visibleOffers.length === 0 && (
        <EmptyState title="Немає активних пропозицій" />
      )}
      {/*
        Block 2 — Branch "Пропозиції" compact table.
        Primary list = airport-board table; one row per manager offer.
        Each row carries the existing position_id (manager_offers.position_id),
        already fetched via select("*"). No new lifecycle anchors, no text
        matching. Row click opens the existing big offer card in a dialog.
      */}
      <div className="rounded-2xl border border-border bg-card p-1 shadow-sm sm:p-2">
        <Table className="text-xs">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[34%] sm:w-[28%]">Товар</TableHead>
              <TableHead className="hidden sm:table-cell">Країна</TableHead>
              <TableHead className="hidden md:table-cell">Сорт / спец.</TableHead>
              <TableHead className="hidden sm:table-cell">Менеджер</TableHead>
              <TableHead className="text-right">Палет</TableHead>
              <TableHead className="hidden md:table-cell text-right">Ціна</TableHead>
              <TableHead className="hidden sm:table-cell tabular-nums">ETA</TableHead>
              <TableHead>Статус</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleOffers.map((o) => {
              const r = responseByOffer[o.id];
              const ship = o.linked_shipment_id ? shipmentById[o.linked_shipment_id] : null;
              const etaIso = ship?.arrived_at ?? ship?.eta ?? o.expected_eta ?? null;
              const etaStr = etaIso ? new Date(etaIso).toLocaleDateString("uk-UA") : "—";

              // SINGLE source of truth — same helper drives the detail badge.
              const st = getBranchOfferStatus(o, r ?? null, ship?.code ?? null);
              const qtyLabel =
                st.kind === "confirmed" && st.apprQty != null
                  ? `${st.apprQty}п`
                  : st.kind === "waiting" || st.kind === "rejected"
                  ? `${st.reqQty}п`
                  : o.offered_pallets != null
                  ? `${o.offered_pallets}п`
                  : "—";
              const toneCls = toneClass(st.tone);


              return (
                <TableRow
                  key={o.id}
                  onClick={() => setSelectedOfferId(o.id)}
                  className="cursor-pointer"
                >
                  <TableCell className="font-medium">
                    <div className="truncate" title={o.product_name}>{o.product_name}</div>
                    <div className="sm:hidden text-[10px] text-muted-foreground truncate">
                      {[o.origin_country, o.variety, o.caliber].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-foreground/80">
                    {o.origin_country ?? "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-foreground/80 max-w-[180px]">
                    <div className="truncate">
                      {[o.variety, o.caliber, o.packaging].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-foreground/80">
                    {managerNameById[o.created_by] ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{qtyLabel}</TableCell>
                  <TableCell className="hidden md:table-cell text-right tabular-nums">
                    {o.indicative_cost_usd != null
                      ? `$${Number(o.indicative_cost_usd).toFixed(2)}`
                      : "—"}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell tabular-nums">{etaStr}</TableCell>
                  <TableCell>
                    <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold", toneCls)}>
                      {st.label}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/*
        Detail dialog — reuses the EXISTING big offer card in full
        (no information removed: caliber, variety, brand, packaging,
        specification, comments, pallets, price, ETA, actions).
        Row click opens it; on successful "Запитати" the submit
        mutation closes it automatically.
      */}
      <Dialog
        open={!!selectedOfferId}
        onOpenChange={(open) => { if (!open) setSelectedOfferId(null); }}
      >
        <DialogContent
          className="max-h-[90vh] overflow-y-auto w-[calc(100vw-1.5rem)] sm:max-w-lg p-0"
          onOpenAutoFocus={(e) => {
            // Read-first: do NOT auto-focus the pallet input on mobile,
            // otherwise iOS pops the keyboard the moment the row is tapped.
            e.preventDefault();
          }}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Деталі пропозиції</DialogTitle>
          </DialogHeader>
          {(() => {
            const o = visibleOffers.find((x) => x.id === selectedOfferId);
            if (!o) return null;
            const r = responseByOffer[o.id];
            const draft = drafts[o.id] ?? (r ? String(r.requested_pallets) : "");
            const ship = o.linked_shipment_id ? shipmentById[o.linked_shipment_id] : null;

            const indDelta =
              o.prev_indicative_cost_usd != null
                ? Number(o.indicative_cost_usd ?? 0) - Number(o.prev_indicative_cost_usd)
                : 0;
            const invDelta =
              o.prev_invoice_cost_usd != null
                ? Number(o.invoice_cost_usd ?? 0) - Number(o.prev_invoice_cost_usd)
                : 0;

            const reqQty = r ? Number(r.requested_pallets) : 0;
            const apprQty = r?.approved_pallets != null ? Number(r.approved_pallets) : null;
            const cancelledSupply = o.status === "deleted";
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
                className={cn(
                  "p-4",
                  cancelledSupply ? "bg-destructive/5" : undefined,
                )}
              >
                {/* Header: product (country) + status (single source of truth) */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-bold">{o.product_name}</span>
                  {o.origin_country && (
                    <span className="text-sm text-muted-foreground">({o.origin_country})</span>
                  )}
                  {isSplit ? (
                    <>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase bg-primary/15 text-primary">
                        Замовлено · {linkedQty}
                      </span>
                      <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase bg-warning/15 text-warning">
                        Очікує номер · {pendingQty}*
                      </span>
                    </>
                  ) : (() => {
                    const st = getBranchOfferStatus(o, r ?? null, ship?.code ?? null);
                    return (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                          toneClass(st.tone),
                        )}
                      >
                        {st.label}
                      </span>
                    );
                  })()}
                  {ship && isRealShipmentCode(ship.code) && (
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

                {/* Responsible manager */}
                {managerNameById[o.created_by] && (
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

                {/* ETA change notice */}
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

                {/* Desired quantity input + actions */}
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

                  {r && o.status === "active" && r.approved_pallets == null && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={cancelRequest.isPending}
                      onClick={() => cancelRequest.mutate(r.id)}
                    >
                      Скасувати запит
                    </Button>
                  )}

                  {r && (
                    <div className="ml-auto text-right text-sm">
                      <div className="text-muted-foreground">
                        Запит: <b className="text-foreground tabular-nums">{reqQty}</b>
                      </div>
                      {apprQty != null && (
                        <>
                          <div className="text-muted-foreground">
                            Підтверджено:{" "}
                            <b className="text-foreground tabular-nums">
                              {apprQty === reqQty
                                ? `${apprQty}`
                                : apprQty < reqQty
                                ? `${apprQty} з ${reqQty}`
                                : `${apprQty}`}
                            </b>
                          </div>
                          {apprQty > 0 && apprQty < reqQty && (
                            <div className="text-[11px] text-muted-foreground">
                              {reqQty - apprQty} не підтверджено
                            </div>
                          )}
                          {apprQty > reqQty && (
                            <div className="text-[11px] text-warning">
                              Перевірте: підтверджено більше, ніж запит
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

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
  // Suppress "from same to same" noise: only show the change when the
  // post-rounding (2-decimal) delta is actually non-zero.
  const roundedDelta = Math.round(delta * 100) / 100;
  const changed = prev != null && roundedDelta !== 0;
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
              roundedDelta < 0 ? "text-success" : "text-destructive",
            )}
          >
            ({roundedDelta > 0 ? "+" : ""}
            {roundedDelta.toFixed(2)})
          </span>
        </>
      )}
      {changed && linked && (
        <div
          className={cn(
            "mt-0.5 rounded-md px-2 py-1 text-xs font-normal",
            roundedDelta > 0
              ? "bg-destructive/10 text-destructive"
              : "bg-success/10 text-success",
          )}
        >
          <b>Собівартість змінено:</b> було{" "}
          <span className="line-through tabular-nums">${Number(prev).toFixed(2)}</span>{" "}
          → стало <b className="tabular-nums">${curr.toFixed(2)}</b>{" "}
          <b className="tabular-nums">
            ({roundedDelta > 0 ? "+" : ""}
            {roundedDelta.toFixed(2)})
          </b>
        </div>
      )}
    </div>
  );
}
