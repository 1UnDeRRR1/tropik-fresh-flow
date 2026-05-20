import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Link2, Trash2, Bell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { EmptyState } from "@/components/cards";
import { TableScroller } from "@/components/TableScroller";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  STATUS_LABEL,
  STATUS_CLASS,
  formatRemaining,
  type ManagerOffer,
  type ManagerOfferResponse,
  type ManagerOfferStatus,
  type ManagerOfferTarget,
} from "@/lib/manager-offers";
import { Checkbox } from "@/components/ui/checkbox";
import { useCountryOptions } from "@/hooks/useCountryOptions";
import { computeOfferCost, fetchCustomsRef, type CustomsRefRow } from "@/lib/offer-cost";
import { getLatestEurUsdRate } from "@/lib/currency";
import { COUNTRY_ALIASES, resolveCountry, suggestCountries } from "@/lib/country-search";

function resolveOption(
  value: string,
  options: string[],
  aliases?: Record<string, string>,
): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const direct = options.find((o) => o.toLowerCase() === v);
  if (direct) return direct;
  if (aliases && aliases[v]) {
    const target = aliases[v].toLowerCase();
    const aliased = options.find((o) => o.toLowerCase() === target);
    if (aliased) return aliased;
    return aliases[v];
  }
  return null;
}

function ValidatedAutocomplete({
  value,
  onChange,
  options,
  aliases,
  placeholder,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  aliases?: Record<string, string>;
  placeholder?: string;
  required?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  const canonical = resolveOption(trimmed, options, aliases);
  const isInvalid = trimmed.length > 0 && !canonical;
  const showRequired = required && trimmed.length === 0;

  const suggestions =
    trimmed.length >= 2 && (!canonical || canonical.toLowerCase() !== lower)
      ? aliases
        ? suggestCountries(trimmed, options, aliases, 8)
        : Array.from(
            new Set(options.filter((o) => o.toLowerCase().includes(lower))),
          ).slice(0, 8)
      : [];

  return (
    <div className="relative">
      <Input
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // auto-normalize alias to canonical
          const c = resolveOption(trimmed, options, aliases);
          if (c && c !== trimmed) onChange(c);
          setTimeout(() => setFocused(false), 150);
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === "Tab") && suggestions[0]) {
            e.preventDefault();
            onChange(suggestions[0]);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        className={cn(
          (isInvalid || showRequired) &&
            "border-destructive bg-destructive/10 focus-visible:ring-destructive",
        )}
      />
      {focused && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-xl">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(s);
              }}
              className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {isInvalid && (
        <div className="mt-1 text-xs text-destructive">Значення відсутнє в базі</div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/manager-offers")({
  component: ManagerOffersPage,
});

type OfferWithResponses = ManagerOffer & {
  responses: (ManagerOfferResponse & { branch_name?: string })[];
  targetBranchIds: string[];
};

const EMPTY_TARGET_IDS: string[] = [];

function toBranchSelection(branchIds: string[]) {
  const next: Record<string, boolean> = {};
  for (const branchId of branchIds) next[branchId] = true;
  return next;
}

function ManagerOffersPage() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole(["admin", "super_admin"]);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ManagerOffer | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<string>("active");
  
  const [linkOffer, setLinkOffer] = useState<ManagerOffer | null>(null);
  const [publishOffer, setPublishOffer] = useState<ManagerOffer | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  function focusOffer(offerId: string, offerStatus: ManagerOfferStatus) {
    // Switch to the tab that contains this offer
    if (["active", "in_work", "confirmed", "closed"].includes(offerStatus)) setTab("active");
    else if (offerStatus === "draft") setTab("drafts");
    else if (offerStatus === "linked") setTab("linked");
    else if (offerStatus === "expired") setTab("archive");
    
    setHighlightedId(offerId);
    setDetailOfferId(offerId);
    setTimeout(() => setHighlightedId((cur) => (cur === offerId ? null : cur)), 2600);
  }

  const { data: branches } = useQuery({
    queryKey: ["branches-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("branches").select("id,name").order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: offers, isLoading } = useQuery({
    queryKey: ["manager-offers", user?.id, isAdmin],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase
        .from("manager_offers")
        .select("*")
        .neq("status", "deleted")
        .order("created_at", { ascending: false });
      if (!isAdmin) q = q.eq("created_by", user!.id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ManagerOffer[];
    },
  });

  const offerIds = useMemo(() => (offers ?? []).map((o) => o.id), [offers]);

  const { data: responses } = useQuery({
    queryKey: ["manager-offer-responses", offerIds],
    enabled: offerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_offer_responses")
        .select("*")
        .in("offer_id", offerIds);
      if (error) throw error;
      return (data ?? []) as ManagerOfferResponse[];
    },
  });

  const { data: targets } = useQuery({
    queryKey: ["manager-offer-targets", offerIds],
    enabled: offerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_offer_targets")
        .select("*")
        .in("offer_id", offerIds);
      if (error) throw error;
      return (data ?? []) as ManagerOfferTarget[];
    },
  });

  const linkedShipmentIds = useMemo(
    () =>
      Array.from(
        new Set(
          (offers ?? [])
            .map((o) => o.linked_shipment_id)
            .filter((v): v is string => !!v),
        ),
      ),
    [offers],
  );

  const { data: linkedShipments } = useQuery({
    queryKey: ["manager-offer-linked-shipments", linkedShipmentIds],
    enabled: linkedShipmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id,code,eta,arrived_at")
        .in("id", linkedShipmentIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const shipmentEtaById = useMemo(() => {
    const m: Record<string, { code: string; eta: string | null; arrived_at: string | null }> = {};
    for (const s of linkedShipments ?? []) {
      m[s.id] = { code: s.code, eta: s.eta, arrived_at: (s as { arrived_at: string | null }).arrived_at };
    }
    return m;
  }, [linkedShipments]);

  const creatorIds = useMemo(
    () => Array.from(new Set((offers ?? []).map((o) => o.created_by).filter(Boolean))),
    [offers],
  );

  const { data: creators } = useQuery({
    queryKey: ["manager-offer-creators", creatorIds],
    enabled: creatorIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name")
        .in("id", creatorIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  const creatorById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of creators ?? []) m[c.id] = c.full_name ?? "—";
    return m;
  }, [creators]);

  const branchById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const b of branches ?? []) m[b.id] = b.name;
    return m;
  }, [branches]);

  const merged: OfferWithResponses[] = useMemo(() => {
    return (offers ?? []).map((o) => ({
      ...o,
      responses: (responses ?? [])
        .filter((r) => r.offer_id === o.id)
        .map((r) => ({ ...r, branch_name: branchById[r.branch_id] })),
      targetBranchIds: (targets ?? [])
        .filter((t) => t.offer_id === o.id)
        .map((t) => t.branch_id),
    }));
  }, [offers, responses, targets, branchById]);

  const filtered = useMemo(() => {
    if (tab === "all") return merged;
    if (tab === "drafts") return merged.filter((o) => o.status === "draft");
    if (tab === "active")
      return merged.filter((o) =>
        ["active", "in_work", "confirmed", "closed"].includes(o.status),
      );
    if (tab === "linked") return merged.filter((o) => o.status === "linked");
    if (tab === "archive")
      return merged.filter((o) => o.status === "expired");
    return merged;
  }, [merged, tab]);

  // New responses from branches that the manager hasn't acted on yet
  const pendingItems = useMemo(() => {
    const items: {
      offerId: string;
      offerStatus: ManagerOfferStatus;
      productName: string;
      originCountry: string | null;
      branchName: string;
      requested: number;
      createdAt: string;
    }[] = [];
    for (const o of merged) {
      for (const r of o.responses) {
        if (r.approved_pallets == null) {
          items.push({
            offerId: o.id,
            offerStatus: o.status,
            productName: o.product_name,
            originCountry: o.origin_country ?? null,
            branchName: r.branch_name ?? "Філія",
            requested: Number(r.requested_pallets ?? 0),
            createdAt: (r as { created_at?: string }).created_at ?? "",
          });
        }
      }
    }
    return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [merged]);

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ManagerOfferStatus }) => {
      const { error } = await supabase.from("manager_offers").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manager-offers"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateApproved = useMutation({
    mutationFn: async ({ id, approved }: { id: string; approved: number | null }) => {
      const { error } = await supabase
        .from("manager_offer_responses")
        .update({ approved_pallets: approved })
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, approved }) => {
      // Optimistic update so the UI (input value + status pill) updates instantly
      await qc.cancelQueries({ queryKey: ["manager-offer-responses"] });
      const prev = qc.getQueriesData<ManagerOfferResponse[]>({ queryKey: ["manager-offer-responses"] });
      for (const [key, data] of prev) {
        if (!data) continue;
        qc.setQueryData<ManagerOfferResponse[]>(key, data.map((r) =>
          r.id === id ? { ...r, approved_pallets: approved } : r,
        ));
      }
      return { prev };
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.prev) for (const [key, data] of ctx.prev) qc.setQueryData(key, data);
      toast.error(e.message);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["manager-offer-responses"] }),
  });

  const approveAllPending = useMutation({
    mutationFn: async () => {
      const pending: { id: string; requested: number }[] = [];
      for (const o of merged) {
        const inScope = (branchId: string) =>
          o.target_mode === "all" || o.targetBranchIds.includes(branchId);
        for (const r of o.responses) {
          if (r.approved_pallets == null && inScope(r.branch_id)) {
            pending.push({ id: r.id, requested: Number(r.requested_pallets ?? 0) });
          }
        }
      }
      if (!pending.length) return { ok: 0, failed: 0 };
      const results = await Promise.all(
        pending.map((p) =>
          supabase
            .from("manager_offer_responses")
            .update({ approved_pallets: p.requested })
            .eq("id", p.id),
        ),
      );
      const failed = results.filter((r) => r.error).length;
      return { ok: pending.length - failed, failed };
    },
    onSuccess: ({ ok, failed }) => {
      if (ok > 0) toast.success(`Підтверджено відгуків: ${ok}`);
      if (failed > 0) toast.error(`Не вдалося підтвердити: ${failed}`);
      qc.invalidateQueries({ queryKey: ["manager-offer-responses"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [showAllPending, setShowAllPending] = useState(false);

  const [detailOfferId, setDetailOfferId] = useState<string | null>(null);
  const detailOffer = useMemo(
    () => merged.find((o) => o.id === detailOfferId) ?? null,
    [merged, detailOfferId],
  );

  return (
    <div>
      <PageHeader
        title="Запропонувати"
        subtitle="Пропозиції товарів для філій до створення поставки"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> Створити
          </Button>
        }
      />

      {pendingItems.length > 0 && (
        <div className="mb-4 rounded-2xl border border-amber-300/60 bg-amber-50 p-3 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200">
              <Bell className="h-4 w-4" />
              Нові відгуки від філій ({pendingItems.length})
            </div>
            <Button
              size="sm"
              onClick={() => approveAllPending.mutate()}
              disabled={approveAllPending.isPending}
            >
              Підтвердити все
            </Button>
          </div>
          <div className="space-y-1.5">
            {(showAllPending ? pendingItems : pendingItems.slice(0, 6)).map((p, i) => (
              <button
                key={`${p.offerId}-${i}`}
                type="button"
                onClick={() => focusOffer(p.offerId, p.offerStatus)}
                className="flex w-full items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2 text-left text-xs transition hover:bg-white dark:bg-amber-500/5 dark:hover:bg-amber-500/10"
              >
                <span className="min-w-0 truncate">
                  <b>{p.branchName}</b>
                  <span className="text-muted-foreground"> · </span>
                  {p.productName}
                  {p.originCountry && (
                    <span className="text-muted-foreground"> · {p.originCountry}</span>
                  )}
                </span>
                <span className="shrink-0 rounded-full bg-amber-200/80 px-2 py-0.5 text-[11px] font-bold text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
                  {p.requested} пал.
                </span>
              </button>
            ))}
            {pendingItems.length > 6 && (
              <button
                type="button"
                onClick={() => setShowAllPending((v) => !v)}
                className="w-full rounded-lg px-1 py-1 text-left text-[11px] font-medium text-amber-900 hover:underline dark:text-amber-200"
              >
                {showAllPending ? "Згорнути" : `Показати ще ${pendingItems.length - 6}…`}
              </button>
            )}
          </div>
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active">Активні</TabsTrigger>
          <TabsTrigger value="drafts">Чернетки</TabsTrigger>
          <TabsTrigger value="linked">Прив'язані</TabsTrigger>
          <TabsTrigger value="archive">Архів</TabsTrigger>
          <TabsTrigger value="all">Усі</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4 space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">Завантаження…</p>}
          {!isLoading && filtered.length === 0 && (
            <EmptyState title="Немає пропозицій" hint="Натисніть «Створити», щоб додати першу" />
          )}
          {filtered.length > 0 && (
            <TableScroller className="rounded-2xl border border-border bg-card shadow-sm">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="text-xs uppercase text-muted-foreground [&_th]:bg-table-head [&_th]:backdrop-blur [&_th]:font-bold">
                  <tr>
                    <th className="px-3 py-2 text-left">Товар</th>
                    <th className="px-3 py-2 text-left">Країна</th>
                    <th className="px-3 py-2 text-left">Калібр</th>
                    <th className="px-3 py-2 text-right">Собівартість</th>
                    <th className="px-3 py-2 text-left">Дата поставки</th>
                    <th className="px-3 py-2 text-left">Менеджер</th>
                    <th className="px-3 py-2 text-right">Палети</th>
                    <th className="px-3 py-2 text-left">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o) => {
                    const inScope = (branchId: string) =>
                      o.target_mode === "all" || o.targetBranchIds.includes(branchId);
                    const activeResponses = o.responses.filter((r) => inScope(r.branch_id));
                    const totalApproved = activeResponses.reduce(
                      (s, r) => s + Number(r.approved_pallets ?? r.requested_pallets ?? 0),
                      0,
                    );
                    const totalLinked = activeResponses.reduce(
                      (s, r) => s + Number((r as ManagerOfferResponse & { linked_pallets?: number }).linked_pallets ?? 0),
                      0,
                    );
                    const pendingLinked = o.status === "linked"
                      ? Math.max(totalApproved - totalLinked, 0)
                      : 0;
                    const hasPending = o.responses.some((r) => r.approved_pallets == null);
                    const ship = o.linked_shipment_id ? shipmentEtaById[o.linked_shipment_id] : null;
                    const realEta = ship?.arrived_at ?? ship?.eta ?? null;
                    const etaShow = realEta ?? o.expected_eta;
                    return (
                      <tr
                        key={o.id}
                        id={`offer-${o.id}`}
                        onClick={() => setDetailOfferId(o.id)}
                        className={cn(
                          "cursor-pointer border-t border-border transition hover:bg-accent/40",
                          hasPending && "bg-amber-50/60 dark:bg-amber-500/5",
                          highlightedId === o.id && "ring-2 ring-amber-400",
                        )}
                      >
                        <td className="px-3 py-2 font-semibold">
                          {o.product_name}
                          {hasPending && (
                            <span className="ml-2 inline-block h-2 w-2 rounded-full bg-amber-500" />
                          )}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{o.origin_country ?? "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{o.caliber ?? "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <span className="text-success">${Number(o.indicative_cost_usd ?? 0).toFixed(2)}</span>
                          <span className="text-muted-foreground"> · </span>
                          <span className="text-destructive">${Number(o.invoice_cost_usd ?? 0).toFixed(2)}</span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {etaShow ? new Date(etaShow).toLocaleDateString("uk-UA") : "—"}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {creatorById[o.created_by] ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {o.offered_pallets != null
                            ? `${totalApproved}/${o.offered_pallets}`
                            : totalApproved}
                          {pendingLinked > 0 && (
                            <span className="ml-1 text-[10px] font-semibold text-warning">
                              (+{pendingLinked} очік.)
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {pendingLinked > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase bg-primary/15 text-primary">
                                Замовлено · {totalLinked}
                              </span>
                              <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase bg-warning/15 text-warning">
                                Підтв. · {pendingLinked}
                              </span>
                            </div>
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroller>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!detailOffer} onOpenChange={(v) => !v && setDetailOfferId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {detailOffer && (() => {
            const o = detailOffer;
            const inScope = (branchId: string) =>
              o.target_mode === "all" || o.targetBranchIds.includes(branchId);
            const activeResponses = o.responses.filter((r) => inScope(r.branch_id));
            const excludedResponses = o.responses.filter((r) => !inScope(r.branch_id));
            const totalRequested = activeResponses.reduce(
              (s, r) => s + Number(r.requested_pallets || 0),
              0,
            );
            const totalApproved = activeResponses.reduce(
              (s, r) => s + Number(r.approved_pallets ?? r.requested_pallets ?? 0),
              0,
            );
            const totalLinked = activeResponses.reduce(
              (s, r) => s + Number((r as ManagerOfferResponse & { linked_pallets?: number }).linked_pallets ?? 0),
              0,
            );
            const pendingLinked = o.status === "linked"
              ? Math.max(totalApproved - totalLinked, 0)
              : 0;
            const over = o.offered_pallets != null && totalApproved > o.offered_pallets;
            const canEditTargeting = !["closed", "expired", "linked"].includes(o.status);
            const ship = o.linked_shipment_id ? shipmentEtaById[o.linked_shipment_id] : null;
            const realEta = ship?.arrived_at ?? ship?.eta ?? null;
            const showEta = realEta ?? o.expected_eta;
            const isReal = !!realEta;
            const details = [o.packaging, o.specification, o.variety].filter(Boolean).join(" • ");
            return (
              <div>
                <DialogHeader>
                  <DialogTitle className="flex flex-wrap items-center gap-2">
                    {o.product_name}
                    {o.origin_country && (
                      <span className="text-sm text-muted-foreground">{o.origin_country}</span>
                    )}
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                        STATUS_CLASS[o.status],
                      )}
                    >
                      {STATUS_LABEL[o.status]}
                    </span>
                  </DialogTitle>
                </DialogHeader>

                <div className="mt-3 space-y-2 text-sm">
                  {o.caliber && (
                    <div>
                      <span className="text-muted-foreground">Калібр: </span>
                      <b>{o.caliber}</b>
                    </div>
                  )}
                  {details && (
                    <div className="text-muted-foreground">
                      {details}
                    </div>
                  )}
                  <div>
                    <span className="text-success">Інд: <b>${Number(o.indicative_cost_usd ?? 0).toFixed(2)}</b></span>
                    <span className="text-muted-foreground"> · </span>
                    <span className="text-destructive">Інв: <b>${Number(o.invoice_cost_usd ?? 0).toFixed(2)}</b></span>
                    {o.expires_at && (
                      <span className="ml-2 text-muted-foreground">
                        Залишок: {formatRemaining(o.expires_at)}
                      </span>
                    )}
                  </div>
                  {showEta && (
                    <div>
                      <span className="text-muted-foreground">{isReal ? "ETA поставки:" : "Очікувана дата:"}</span>{" "}
                      <b className={isReal ? "text-success" : ""}>
                        {new Date(showEta).toLocaleDateString("uk-UA")}
                      </b>
                      {!isReal && (
                        <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">(план)</span>
                      )}
                    </div>
                  )}
                  {o.linked_shipment_id && ship && (
                    <div>
                      <span className="text-muted-foreground">Поставка: </span>
                      <Link
                        to="/shipments/$id"
                        params={{ id: o.linked_shipment_id }}
                        className="font-semibold text-primary underline-offset-2 hover:underline"
                        onClick={() => setDetailOfferId(null)}
                      >
                        {ship.code}
                      </Link>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">Менеджер: </span>
                    <b>{creatorById[o.created_by] ?? "—"}</b>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">Цільові філії:</span>
                    {o.target_mode === "all" ? (
                      <b>Всі філії</b>
                    ) : (
                      <b>
                        Вибірково:{" "}
                        {o.targetBranchIds.length === 0
                          ? "—"
                          : o.targetBranchIds.map((id) => branchById[id] ?? id).join(", ")}
                      </b>
                    )}
                    {canEditTargeting && o.status !== "draft" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={() => setPublishOffer(o)}
                      >
                        <Pencil className="mr-1 h-3 w-3" /> Змінити
                      </Button>
                    )}
                  </div>
                  <div className={cn("text-sm font-semibold", over && "text-destructive")}>
                    {o.offered_pallets != null
                      ? `${o.offered_pallets} / ${totalApproved} палет`
                      : `${totalApproved} палет`}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      запит: {totalRequested}
                    </span>
                    {pendingLinked > 0 && (
                      <span className="ml-2 text-xs font-normal text-warning">
                        · у поставці: {totalLinked} · чекають номер поставки: {pendingLinked}
                      </span>
                    )}
                  </div>
                  {pendingLinked > 0 && (
                    <div className="rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
                      <div className="mb-1">
                        <b>{pendingLinked}п</b> підтверджено, але не помістились у поставку{ship ? <> <b>{ship.code}</b></> : null}. Створіть нову поставку — решта розподілиться автоматично.
                      </div>
                      <Link
                        to="/shipments/new"
                        search={{ fromOffer: o.id } as never}
                        onClick={() => setDetailOfferId(null)}
                      >
                        <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
                          <Plus className="mr-1 h-3 w-3" /> Створити поставку для решти
                        </Button>
                      </Link>
                    </div>
                  )}
                  {o.notes && (
                    <div className="rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">
                      {o.notes}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  {o.status === "draft" && (
                    <Button size="sm" onClick={() => setPublishOffer(o)}>
                      Запропонувати
                    </Button>
                  )}
                  {o.status === "active" && (
                    <Button size="sm" onClick={() => setStatus.mutate({ id: o.id, status: "in_work" })}>
                      Взяти в роботу
                    </Button>
                  )}
                  {o.status === "closed" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setLinkOffer(o)}>
                        <Link2 className="mr-1 h-3.5 w-3.5" /> Підтягнути
                      </Button>
                      <Link
                        to="/shipments/new"
                        search={{ fromOffer: o.id } as never}
                        onClick={() => setDetailOfferId(null)}
                      >
                        <Button size="sm">
                          <Plus className="mr-1 h-3.5 w-3.5" /> Створити нову поставку
                        </Button>
                      </Link>
                    </>
                  )}
                  {(o.status === "confirmed" || o.status === "in_work") && (
                    <Button size="sm" variant="outline" onClick={() => setLinkOffer(o)}>
                      <Link2 className="mr-1 h-3.5 w-3.5" /> Прив'язати до поставки
                    </Button>
                  )}
                  {!["closed", "expired", "linked"].includes(o.status) && (
                    <Button size="sm" variant="outline" onClick={() => setEditing(o)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Редагувати
                    </Button>
                  )}
                  {!["closed", "expired", "linked"].includes(o.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setStatus.mutate({ id: o.id, status: "closed" })}
                    >
                      Закрити
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setStatus.mutate({ id: o.id, status: "deleted" });
                      setDetailOfferId(null);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="mt-4">
                  <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                    Відгуки ({activeResponses.length}
                    {excludedResponses.length > 0 && ` +${excludedResponses.length}`})
                  </div>
                  {o.responses.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Поки немає відгуків</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase text-muted-foreground">
                            <th className="py-1">Філія</th>
                            <th className="py-1">Запит</th>
                            <th className="py-1">Підтверджено</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...activeResponses, ...excludedResponses].map((r) => {
                            const excluded = !inScope(r.branch_id);
                            const rejected = r.approved_pallets === 0;
                            const linkedP = Number((r as ManagerOfferResponse & { linked_pallets?: number }).linked_pallets ?? 0);
                            const apprP = r.approved_pallets ?? Number(r.requested_pallets ?? 0);
                            const pendingP = o.status === "linked" ? Math.max(apprP - linkedP, 0) : 0;
                            return (
                              <tr
                                key={r.id}
                                className={cn(
                                  "border-t border-border",
                                  (excluded || rejected) && "opacity-60",
                                )}
                              >
                                <td className="py-1">
                                  {r.branch_name ?? r.branch_id}
                                  {excluded && (
                                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                                      виключено з таргетингу
                                    </span>
                                  )}
                                  {rejected && !excluded && (
                                    <span className="ml-2 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-destructive">
                                      Відмовлено
                                    </span>
                                  )}
                                </td>
                                <td className="py-1">{Number(r.requested_pallets)}</td>
                                <td className="py-1">
                                  <div className="flex items-center gap-1">
                                    <Input
                                      key={`${r.id}-${r.approved_pallets ?? "null"}`}
                                      className="h-8 w-20"
                                      type="number"
                                      min={0}
                                      disabled={excluded || rejected}
                                      defaultValue={r.approved_pallets ?? r.requested_pallets}
                                      onBlur={(e) => {
                                        const v = e.target.value === "" ? null : Number(e.target.value);
                                        if (v !== r.approved_pallets) {
                                          updateApproved.mutate({ id: r.id, approved: v });
                                        }
                                      }}
                                    />
                                    {pendingP > 0 && (
                                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                                        у поставці: {linkedP}
                                      </span>
                                    )}
                                    {pendingP > 0 && (
                                      <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                                        чекає: {pendingP}
                                      </span>
                                    )}
                                    {!rejected && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-8 px-2 text-[11px] text-destructive hover:text-destructive"
                                        disabled={excluded || updateApproved.isPending}
                                        onClick={() => updateApproved.mutate({ id: r.id, approved: 0 })}
                                      >
                                        Відмовити
                                      </Button>
                                    )}
                                  </div>
                                </td>

                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>


      <OfferEditor
        open={creating || !!editing}
        offer={editing}
        branches={branches ?? []}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["manager-offers"] });
          qc.invalidateQueries({ queryKey: ["manager-offer-targets"] });
        }}
      />

      <LinkShipmentDialog
        offer={linkOffer}
        onClose={() => setLinkOffer(null)}
        onLinked={() => {
          setLinkOffer(null);
          qc.invalidateQueries({ queryKey: ["manager-offers"] });
        }}
      />

      <PublishOfferDialog
        offer={publishOffer}
        branches={branches ?? []}
        onClose={() => setPublishOffer(null)}
        onPublished={() => {
          setPublishOffer(null);
          qc.invalidateQueries({ queryKey: ["manager-offers"] });
          qc.invalidateQueries({ queryKey: ["manager-offer-targets"] });
          qc.invalidateQueries({ queryKey: ["manager-offer-targets-edit"] });
        }}
      />
    </div>
  );
}

type FormState = {
  product_name: string;
  origin_country: string;
  caliber: string;
  packaging: string;
  specification: string;
  variety: string;
  price_per_kg: string;
  price_currency: "EUR" | "USD";
  freight_amount: string;
  freight_currency: "EUR" | "USD";
  pallet_weight: string;
  offered_pallets: string;
  expires_in_hours: string;
  expected_eta: string;
  notes: string;
};

const emptyForm = (): FormState => ({
  product_name: "",
  origin_country: "",
  caliber: "",
  packaging: "",
  specification: "",
  variety: "",
  price_per_kg: "",
  price_currency: "EUR",
  freight_amount: "",
  freight_currency: "EUR",
  pallet_weight: "",
  offered_pallets: "",
  expires_in_hours: "",
  expected_eta: "",
  notes: "",
});

function offerToForm(offer: ManagerOffer): FormState {
  const o = offer as ManagerOffer & {
    price_per_kg?: number | null;
    price_currency?: "EUR" | "USD" | null;
    freight_amount?: number | null;
    freight_currency?: "EUR" | "USD" | null;
    pallet_weight?: number | null;
  };
  return {
    product_name: o.product_name ?? "",
    origin_country: o.origin_country ?? "",
    caliber: o.caliber ?? "",
    packaging: o.packaging ?? "",
    specification: o.specification ?? "",
    variety: o.variety ?? "",
    price_per_kg: o.price_per_kg != null ? String(o.price_per_kg) : "",
    price_currency: (o.price_currency ?? "EUR") as "EUR" | "USD",
    freight_amount: o.freight_amount != null ? String(o.freight_amount) : "",
    freight_currency: (o.freight_currency ?? "EUR") as "EUR" | "USD",
    pallet_weight: o.pallet_weight != null ? String(o.pallet_weight) : "",
    offered_pallets: o.offered_pallets != null ? String(o.offered_pallets) : "",
    expires_in_hours: "",
    expected_eta: o.expected_eta ?? "",
    notes: o.notes ?? "",
  };
}

type ItemEntry = { id: number; form: FormState; payload: Record<string, unknown> | null };
let _itemSeq = 1;
const nextItemId = () => _itemSeq++;

function OfferEditor({
  open,
  offer,
  branches,
  onClose,
  onSaved,
}: {
  open: boolean;
  offer: ManagerOffer | null;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const dbCountries = useCountryOptions();
  const COUNTRY_OPTIONS = useMemo(() => dbCountries, [dbCountries]);

  const [items, setItems] = useState<ItemEntry[]>([]);
  const [selectiveOpen, setSelectiveOpen] = useState(false);
  const [selectedBranches, setSelectedBranches] = useState<Record<string, boolean>>({});

  const { data: productOptions = [] } = useQuery({
    queryKey: ["products-active-names"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((p) => p.name as string);
    },
  });

  const { data: fxRow } = useQuery({
    queryKey: ["latest-eur-usd-rate"],
    queryFn: () => getLatestEurUsdRate(),
    enabled: open,
    staleTime: 60_000,
  });

  const { data: existingTargets = EMPTY_TARGET_IDS } = useQuery({
    queryKey: ["manager-offer-editor-targets", offer?.id],
    enabled: !!offer && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_offer_targets")
        .select("branch_id")
        .eq("offer_id", offer!.id);
      if (error) throw error;
      return (data ?? []).map((item) => item.branch_id as string);
    },
  });

  useEffect(() => {
    if (open) {
      setItems([
        { id: nextItemId(), form: offer ? offerToForm(offer) : emptyForm(), payload: null },
      ]);
      setSelectiveOpen(false);
    } else {
      setItems([]);
    }
  }, [open, offer?.id]);

  useEffect(() => {
    if (!open) {
      setSelectedBranches({});
      return;
    }
    if (offer?.target_mode === "selected") {
      setSelectedBranches(toBranchSelection(existingTargets));
    } else {
      setSelectedBranches({});
    }
  }, [open, offer?.id, offer?.target_mode, existingTargets]);

  const updateForm = (id: number, form: FormState) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, form } : it)));
  const updatePayload = (id: number, payload: Record<string, unknown> | null) =>
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        // Avoid update if identical to prevent loops
        const same = JSON.stringify(it.payload) === JSON.stringify(payload);
        return same ? it : { ...it, payload };
      }),
    );
  const removeItem = (id: number) =>
    setItems((prev) => (prev.length <= 1 ? prev : prev.filter((it) => it.id !== id)));
  const addNew = () =>
    setItems((prev) => [...prev, { id: nextItemId(), form: emptyForm(), payload: null }]);
  const addSimilar = () =>
    setItems((prev) => {
      const last = prev[prev.length - 1];
      const clone: FormState = last
        ? { ...last.form, offered_pallets: "", expires_in_hours: "" }
        : emptyForm();
      return [...prev, { id: nextItemId(), form: clone, payload: null }];
    });

  const allValid = items.length > 0 && items.every((it) => it.payload !== null);

  const publish = useMutation({
    mutationFn: async ({
      mode,
      branchIds,
    }: {
      mode: "all" | "selected";
      branchIds: string[];
    }) => {
      if (!user) throw new Error("Користувача не знайдено");
      if (!allValid) throw new Error("Заповніть усі товари");
      if (mode === "selected" && branchIds.length === 0) {
        throw new Error("Виберіть хоча б одну філію");
      }

      if (offer) {
        const payload = items[0].payload!;
        const { error: offerError } = await supabase
          .from("manager_offers")
          .update({ ...(payload as any), status: "active", target_mode: mode } as any)
          .eq("id", offer.id);
        if (offerError) throw offerError;

        const { error: deleteError } = await supabase
          .from("manager_offer_targets")
          .delete()
          .eq("offer_id", offer.id);
        if (deleteError) throw deleteError;

        if (mode === "selected") {
          const { error: targetError } = await supabase
            .from("manager_offer_targets")
            .insert(branchIds.map((branch_id) => ({ offer_id: offer.id, branch_id })));
          if (targetError) throw targetError;
        }
        return items.length;
      }

      const createdIds: string[] = [];
      try {
        for (const it of items) {
          const payload = it.payload!;
          const initialStatus = mode === "all" ? "active" : "draft";
          const { data: created, error: createError } = await supabase
            .from("manager_offers")
            .insert({
              ...(payload as any),
              created_by: user.id,
              status: initialStatus,
              target_mode: mode,
            } as any)
            .select("id")
            .single();
          if (createError) throw createError;
          createdIds.push(created.id);

          if (mode === "selected") {
            const { error: targetError } = await supabase
              .from("manager_offer_targets")
              .insert(branchIds.map((branch_id) => ({ offer_id: created.id, branch_id })));
            if (targetError) throw targetError;
            const { error: activateError } = await supabase
              .from("manager_offers")
              .update({ status: "active", target_mode: "selected" })
              .eq("id", created.id);
            if (activateError) throw activateError;
          }
        }
      } catch (error) {
        if (createdIds.length) {
          await supabase.from("manager_offers").delete().in("id", createdIds);
        }
        throw error;
      }
      return items.length;
    },
    onSuccess: (count, variables) => {
      toast.success(
        variables.mode === "all"
          ? `Пропозицій відправлено всім філіям: ${count}`
          : `Пропозицій відправлено вибраним філіям: ${count}`,
      );
      onSaved();
      setSelectiveOpen(false);
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{offer ? "Редагувати пропозицію" : "Нова пропозиція"}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {items.map((it, idx) => (
            <OfferItemEditor
              key={it.id}
              index={idx}
              total={items.length}
              form={it.form}
              productOptions={productOptions}
              countryOptions={COUNTRY_OPTIONS}
              fxRow={fxRow ?? null}
              existingExpiresAt={idx === 0 ? offer?.expires_at ?? null : null}
              onFormChange={(f) => updateForm(it.id, f)}
              onPayloadChange={(p) => updatePayload(it.id, p)}
              onRemove={!offer && items.length > 1 ? () => removeItem(it.id) : undefined}
            />
          ))}

          {!offer && (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button variant="secondary" className="flex-1" onClick={addNew}>
                <Plus className="mr-1 h-4 w-4" /> Новий товар
              </Button>
              <Button variant="secondary" className="flex-1" onClick={addSimilar}>
                <Plus className="mr-1 h-4 w-4" /> Новий товар аналогічний
              </Button>
            </div>
          )}

          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button
              onClick={() => publish.mutate({ mode: "all", branchIds: [] })}
              disabled={publish.isPending || !allValid}
            >
              Відправити всім{!offer && items.length > 1 ? ` (${items.length})` : ""}
            </Button>
            <Button
              variant="outline"
              onClick={() => setSelectiveOpen(true)}
              disabled={publish.isPending || !allValid}
            >
              Відправити вибірково
            </Button>
            <Button variant="outline" onClick={onClose}>
              Скасувати
            </Button>
          </div>
        </div>
      </SheetContent>

      <Dialog open={selectiveOpen} onOpenChange={setSelectiveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Виберіть філії для пропозиції</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-border p-3">
              {branches.map((branch) => (
                <label key={branch.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={!!selectedBranches[branch.id]}
                    onCheckedChange={(checked) =>
                      setSelectedBranches((prev) => ({
                        ...prev,
                        [branch.id]: !!checked,
                      }))
                    }
                  />
                  <span>{branch.name}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSelectiveOpen(false)}>
                Скасувати
              </Button>
              <Button
                onClick={() =>
                  publish.mutate({
                    mode: "selected",
                    branchIds: Object.entries(selectedBranches)
                      .filter(([, checked]) => checked)
                      .map(([branchId]) => branchId),
                  })
                }
                disabled={publish.isPending}
              >
                Відправити вибірково
                {!offer && items.length > 1 ? ` (${items.length})` : ""}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Sheet>
  );
}

function OfferItemEditor({
  index,
  total,
  form,
  productOptions,
  countryOptions,
  fxRow,
  existingExpiresAt,
  onFormChange,
  onPayloadChange,
  onRemove,
}: {
  index: number;
  total: number;
  form: FormState;
  productOptions: string[];
  countryOptions: string[];
  fxRow: { rate: number; date: string } | null;
  existingExpiresAt: string | null;
  onFormChange: (f: FormState) => void;
  onPayloadChange: (p: Record<string, unknown> | null) => void;
  onRemove?: () => void;
}) {
  const update = (patch: Partial<FormState>) => onFormChange({ ...form, ...patch });

  const productCanonical = resolveOption(form.product_name, productOptions);
  const productValid = !!productCanonical;
  const countryCanonical = resolveCountry(form.origin_country, countryOptions, COUNTRY_ALIASES);
  const countryValid = !!countryCanonical;

  const priceNum = Number(form.price_per_kg);
  const freightNum = Number(form.freight_amount);
  const palletWeightNum = Number(form.pallet_weight);
  const priceValid = form.price_per_kg !== "" && Number.isFinite(priceNum) && priceNum > 0;
  const freightValid = form.freight_amount !== "" && Number.isFinite(freightNum) && freightNum > 0;
  const palletValid =
    form.pallet_weight !== "" && Number.isFinite(palletWeightNum) && palletWeightNum > 0;

  const fxRate = fxRow?.rate ?? null;

  const { data: customsRef } = useQuery<CustomsRefRow | null>({
    queryKey: ["offer-customs-ref", productCanonical, countryCanonical],
    enabled: !!productCanonical && !!countryCanonical,
    queryFn: () => fetchCustomsRef(productCanonical!, countryCanonical!),
  });

  const calc = useMemo(() => {
    if (!priceValid || !freightValid || !palletValid || !countryCanonical) return null;
    return computeOfferCost({
      pricePerKg: priceNum,
      priceCurrency: form.price_currency,
      freight: freightNum,
      freightCurrency: form.freight_currency,
      palletWeight: palletWeightNum,
      fxRate,
      country: countryCanonical,
      ref: customsRef ?? null,
    });
  }, [
    priceValid,
    freightValid,
    palletValid,
    countryCanonical,
    priceNum,
    form.price_currency,
    freightNum,
    form.freight_currency,
    palletWeightNum,
    fxRate,
    customsRef,
  ]);

  const payload = useMemo(() => {
    if (
      !productCanonical ||
      !countryCanonical ||
      !priceValid ||
      !freightValid ||
      !palletValid ||
      !calc
    )
      return null;
    return {
      product_name: productCanonical,
      origin_country: countryCanonical,
      caliber: form.caliber.trim() || null,
      packaging: form.packaging.trim() || null,
      specification: form.specification.trim() || null,
      variety: form.variety.trim() || null,
      price_per_kg: priceNum,
      price_currency: form.price_currency,
      freight_amount: freightNum,
      freight_currency: form.freight_currency,
      pallet_weight: palletWeightNum,
      fx_rate_snapshot: fxRate,
      fx_rate_date: fxRow?.date ?? null,
      indicative_cost_usd: Number(calc.indicativeCost.toFixed(4)),
      invoice_cost_usd: Number(calc.invoiceCost.toFixed(4)),
      offered_pallets: form.offered_pallets === "" ? null : Number(form.offered_pallets),
      expires_at:
        form.expires_in_hours === ""
          ? existingExpiresAt
          : new Date(Date.now() + Number(form.expires_in_hours) * 3600_000).toISOString(),
      expected_eta: form.expected_eta || null,
      notes: form.notes.trim() || null,
    } as Record<string, unknown>;
  }, [
    productCanonical,
    countryCanonical,
    priceValid,
    freightValid,
    palletValid,
    calc,
    form.caliber,
    form.packaging,
    form.specification,
    form.variety,
    priceNum,
    form.price_currency,
    freightNum,
    form.freight_currency,
    palletWeightNum,
    fxRate,
    fxRow?.date,
    form.offered_pallets,
    form.expires_in_hours,
    existingExpiresAt,
    form.expected_eta,
    form.notes,
  ]);

  const payloadKey = payload ? JSON.stringify(payload) : null;
  useEffect(() => {
    onPayloadChange(payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey]);

  return (
    <div className="rounded-2xl border border-border bg-card/40 p-3 space-y-3">
      {total > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            Товар {index + 1} з {total}
          </div>
          {onRemove && (
            <Button size="sm" variant="ghost" onClick={onRemove}>
              <Trash2 className="mr-1 h-3 w-3" /> Видалити
            </Button>
          )}
        </div>
      )}

      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Товар *</span>
        <ValidatedAutocomplete
          value={form.product_name}
          onChange={(v) => update({ product_name: v })}
          options={productOptions}
          placeholder="Почніть вводити назву товару"
          required
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Країна походження *</span>
        <ValidatedAutocomplete
          value={form.origin_country}
          onChange={(v) => update({ origin_country: v })}
          options={countryOptions}
          aliases={COUNTRY_ALIASES}
          placeholder="Почніть вводити країну"
          required
        />
      </label>
      {(
        [
          ["caliber", "Калібр"],
          ["packaging", "Упаковка"],
          ["specification", "Специфікація"],
          ["variety", "Сорт / асортимент"],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="block text-sm">
          <span className="mb-1 block text-muted-foreground">{label}</span>
          <Input value={form[k]} onChange={(e) => update({ [k]: e.target.value } as Partial<FormState>)} />
        </label>
      ))}
      <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-3">
        <div className="text-xs font-semibold uppercase text-muted-foreground">
          Розрахунок собівартості (внутрішнє)
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Ціна за кг *</span>
            <Input
              type="number"
              step="0.0001"
              value={form.price_per_kg}
              placeholder="напр. 1.50"
              onChange={(e) => update({ price_per_kg: e.target.value })}
              className={cn(!priceValid && "border-destructive bg-destructive/10")}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Валюта</span>
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={form.price_currency}
              onChange={(e) => update({ price_currency: e.target.value as "EUR" | "USD" })}
            >
              <option value="EUR">€ EUR</option>
              <option value="USD">$ USD</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Фрахт *</span>
            <Input
              type="number"
              step="0.01"
              value={form.freight_amount}
              placeholder="напр. 3500"
              onChange={(e) => update({ freight_amount: e.target.value })}
              className={cn(!freightValid && "border-destructive bg-destructive/10")}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted-foreground">Валюта</span>
            <select
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
              value={form.freight_currency}
              onChange={(e) => update({ freight_currency: e.target.value as "EUR" | "USD" })}
            >
              <option value="EUR">€ EUR</option>
              <option value="USD">$ USD</option>
            </select>
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-muted-foreground">Вага палети, кг *</span>
          <Input
            type="number"
            step="0.1"
            value={form.pallet_weight}
            placeholder="напр. 750"
            onChange={(e) => update({ pallet_weight: e.target.value })}
            className={cn(!palletValid && "border-destructive bg-destructive/10")}
          />
        </label>

        <div className="rounded-lg border border-border bg-background p-3 text-xs space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">FX EUR/USD</span>
            <span className="tabular-nums">
              {fxRate ? fxRate.toFixed(4) : "—"}
              {fxRow?.date && <span className="ml-1 text-muted-foreground">({fxRow.date})</span>}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Митниця</span>
            <span>
              {customsRef
                ? "знайдено"
                : productCanonical && countryCanonical
                  ? "не знайдено"
                  : "—"}
            </span>
          </div>
          {calc && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Очік. палет / фура</span>
                <span className="tabular-nums">{calc.expectedPallets}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Транспорт, $/кг</span>
                <span className="tabular-nums">${calc.transportPerKg.toFixed(4)}</span>
              </div>
              <div className="mt-2 flex justify-between border-t border-border pt-2">
                <span className="font-semibold text-success">Індикативна</span>
                <span className="font-bold tabular-nums text-success">
                  ${calc.indicativeCost.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-destructive">Інвойсна</span>
                <span className="font-bold tabular-nums text-destructive">
                  ${calc.invoiceCost.toFixed(2)}
                </span>
              </div>
            </>
          )}
          {!calc && (
            <div className="text-muted-foreground">
              Заповніть товар, країну, ціну, фрахт та вагу палети для розрахунку.
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Палет (опціонально)</span>
          <Input
            type="number"
            value={form.offered_pallets}
            onChange={(e) => update({ offered_pallets: e.target.value })}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted-foreground">Термін дії, год</span>
          <Input
            type="number"
            placeholder={existingExpiresAt ? "не змінювати" : "без обмеження"}
            value={form.expires_in_hours}
            onChange={(e) => update({ expires_in_hours: e.target.value })}
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Очікувана дата прибуття (ETA)</span>
        <Input
          type="date"
          value={form.expected_eta}
          onChange={(e) => update({ expected_eta: e.target.value })}
        />
        <span className="mt-1 block text-[11px] text-muted-foreground">
          Орієнтовна дата для філій. Після прив'язки до поставки використовується реальний ETA авто.
        </span>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-muted-foreground">Примітки</span>
        <Textarea value={form.notes} onChange={(e) => update({ notes: e.target.value })} />
      </label>

      {(!productValid || !countryValid) && (form.product_name || form.origin_country) && (
        <div className="text-xs text-destructive">
          {!productValid && form.product_name ? "Товар має відповідати базі. " : ""}
          {!countryValid && form.origin_country ? "Країна має відповідати базі." : ""}
        </div>
      )}
    </div>
  );
}

function LinkShipmentDialog({
  offer,
  onClose,
  onLinked,
}: {
  offer: ManagerOffer | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (offer) setShowAll(false);
  }, [offer?.id]);

  const { user } = useAuth();
  const { data: shipments } = useQuery({
    queryKey: ["shipments-link-options", offer?.id, user?.id],
    enabled: !!offer && !!user,
    queryFn: async () => {
      // Only this manager's own shipments
      const { data, error } = await supabase
        .from("shipments")
        .select("id,code,country,eta,created_by,import_manager_id,shipment_items(product_name,origin_country)")
        .or(`created_by.eq.${user!.id},import_manager_id.eq.${user!.id}`)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        code: string;
        country: string | null;
        eta: string | null;
        shipment_items: { product_name: string; origin_country: string | null }[] | null;
      }>;
    },
  });

  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const target = offer ? norm(offer.product_name) : "";
  const targetCountry = offer ? norm(offer.origin_country) : "";
  const itemMatches = (i: { product_name: string; origin_country: string | null }) =>
    norm(i.product_name) === target &&
    (!targetCountry || norm(i.origin_country) === targetCountry);
  const matching = useMemo(
    () =>
      (shipments ?? []).filter((s) =>
        (s.shipment_items ?? []).some(itemMatches),
      ),
    [shipments, target, targetCountry],
  );

  const list = showAll ? (shipments ?? []) : matching;

  const link = useMutation({
    mutationFn: async (shipmentId: string) => {
      if (!offer) return;
      const { error } = await supabase
        .from("manager_offers")
        .update({ status: "linked", linked_shipment_id: shipmentId })
        .eq("id", offer.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Прив'язано. Розподіл створено автоматично.");
      onLinked();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet open={!!offer} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Прив'язати до поставки</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          {offer && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-xs space-y-1.5">
              <div>
                <div className="text-muted-foreground">Товар пропозиції</div>
                <div className="font-semibold text-sm">{offer.product_name}</div>
              </div>
              {(() => {
                const rows: Array<[string, string | null | undefined]> = [
                  ["Країна", offer.origin_country],
                  ["Сорт", offer.variety],
                  ["Калібр", offer.caliber],
                  ["Пакування", offer.packaging],
                  ["Специфікація", offer.specification],
                ];
                const visible = rows.filter(([, v]) => v && String(v).trim());
                if (!visible.length) return null;
                return (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 pt-1 border-t border-primary/15">
                    {visible.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="font-medium text-foreground">{v}</dd>
                      </div>
                    ))}
                  </dl>
                );
              })()}
            </div>
          )}
          <Link to="/shipments/new" onClick={() => onClose()} className="block">
            <Button size="sm" className="w-full bg-brand text-brand-foreground hover:bg-brand/90">
              <Plus className="mr-1 h-4 w-4" /> Нова поставка
            </Button>
          </Link>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {showAll
                ? "Показано всі поставки."
                : "Показано лише поставки з цим товаром."}
            </p>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Тільки з товаром" : "Показати всі"}
            </Button>
          </div>

          {list.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              {showAll
                ? "Немає поставок."
                : `Немає поставок з товаром «${offer?.product_name ?? ""}». Натисніть «Показати всі», щоб побачити решту.`}
            </div>
          ) : (
            list.map((s) => {
              const items = s.shipment_items ?? [];
              const has = items.some(itemMatches);
              const productOnly =
                !has && items.some((i) => norm(i.product_name) === target);
              const uniqueProducts = Array.from(
                new Set(items.map((i) => i.product_name)),
              );
              return (
                <button
                  key={s.id}
                  onClick={() => link.mutate(s.id)}
                  disabled={!has}
                  className={cn(
                    "flex w-full flex-col gap-1 rounded-lg border p-3 text-left transition",
                    has
                      ? "border-success/50 bg-success/5 hover:bg-success/10"
                      : productOnly
                        ? "border-warning/40 bg-warning/5 opacity-70 cursor-not-allowed"
                        : "border-border opacity-70 cursor-not-allowed",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold">{s.code}</div>
                    {has ? (
                      <span className="rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                        є товар
                      </span>
                    ) : productOnly ? (
                      <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                        інша країна
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.country ?? "—"} · ETA {s.eta ?? "—"}
                  </div>
                  {uniqueProducts.length > 0 && (
                    <div className="text-[11px] text-muted-foreground line-clamp-2">
                      {uniqueProducts.join(", ")}
                    </div>
                  )}
                </button>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PublishOfferDialog({
  offer,
  branches,
  onClose,
  onPublished,
}: {
  offer: ManagerOffer | null;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onPublished: () => void;
}) {
  const isDraft = offer?.status === "draft";
  const [mode, setMode] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  // Load existing targets when opening for an offer that's already published
  const { data: existingTargets = EMPTY_TARGET_IDS } = useQuery({
    queryKey: ["manager-offer-targets-edit", offer?.id],
    enabled: !!offer,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_offer_targets")
        .select("branch_id")
        .eq("offer_id", offer!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.branch_id as string);
    },
  });

  // reset state when opening, then merge in existing targets once loaded
  useEffect(() => {
    if (offer) {
      setMode(offer.target_mode ?? "all");
      setSelected({});
    }
  }, [offer?.id]);

  useEffect(() => {
    if (!offer) {
      setSelected({});
      return;
    }

    if (offer.target_mode === "selected") {
      setSelected(toBranchSelection(existingTargets));
      return;
    }

    setSelected({});
  }, [offer?.id, existingTargets]);

  const publish = useMutation({
    mutationFn: async () => {
      if (!offer) return;
      const branchIds =
        mode === "selected"
          ? Object.entries(selected)
              .filter(([, v]) => v)
              .map(([k]) => k)
          : [];
      if (mode === "selected" && branchIds.length === 0) {
        throw new Error("Виберіть хоча б одну філію");
      }

      // Reset existing targets for this offer
      const { error: delErr } = await supabase
        .from("manager_offer_targets")
        .delete()
        .eq("offer_id", offer.id);
      if (delErr) throw delErr;

      if (mode === "selected" && branchIds.length > 0) {
        const { error: insErr } = await supabase
          .from("manager_offer_targets")
          .insert(branchIds.map((branch_id) => ({ offer_id: offer.id, branch_id })));
        if (insErr) throw insErr;
      }

      const update: { target_mode: "all" | "selected"; status?: ManagerOfferStatus } = {
        target_mode: mode,
      };
      if (isDraft) update.status = "active";
      const { error } = await supabase
        .from("manager_offers")
        .update(update)
        .eq("id", offer.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(isDraft ? "Пропозицію опубліковано" : "Цільові філії оновлено");
      onPublished();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const allBranchIds = branches.map((b) => b.id);
  const allSelected = allBranchIds.length > 0 && allBranchIds.every((id) => selected[id]);

  return (
    <Sheet open={!!offer} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {isDraft
              ? "Запропонувати всім філіям чи вибірково?"
              : "Змінити цільові філії"}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {!isDraft && (
            <p className="text-xs text-muted-foreground">
              Зміни застосовуються миттєво. Філії, які буде вилучено, втратять доступ до
              цієї пропозиції; їх відгуки збережуться як історія, але не враховуються в
              підсумках.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant={mode === "all" ? "default" : "outline"}
              onClick={() => setMode("all")}
              className="flex-1"
            >
              Всім
            </Button>
            <Button
              variant={mode === "selected" ? "default" : "outline"}
              onClick={() => setMode("selected")}
              className="flex-1"
            >
              Вибірково
            </Button>
          </div>

          {mode === "selected" && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Виберіть філії ({selectedCount} обрано)
                </span>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => {
                    if (allSelected) setSelected({});
                    else {
                      const m: Record<string, boolean> = {};
                      for (const id of allBranchIds) m[id] = true;
                      setSelected(m);
                    }
                  }}
                >
                  {allSelected ? "Зняти всі" : "Вибрати всі"}
                </button>
              </div>
              {branches.map((b) => (
                <label
                  key={b.id}
                  className="flex cursor-pointer items-center gap-2 py-1 text-sm"
                >
                  <Checkbox
                    checked={!!selected[b.id]}
                    onCheckedChange={(v) =>
                      setSelected((p) => ({ ...p, [b.id]: !!v }))
                    }
                  />
                  <span>{b.name}</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              Скасувати
            </Button>
            <Button
              onClick={() => publish.mutate()}
              disabled={publish.isPending}
            >
              {isDraft ? "Запропонувати" : "Зберегти"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
