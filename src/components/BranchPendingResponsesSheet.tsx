// Focused sheet for import-manager Головна → "Заявки філій".
// Shows ONLY pending branch responses to this manager's offers
// (requested_pallets > 0, approved_pallets IS NULL, refused_at IS NULL,
//  manager_offers.status != 'deleted', scoped via current_import_manager_id()
//  with created_by fallback for legacy rows).
//
// Inline Підтвердити / Відмовити reuse the EXACT same Supabase update
// shape and guardrails as manager-offers.tsx (full confirm =
// approved_pallets := requested_pallets; refuse = refused_at + refused_by;
// .is('approved_pallets', null).is('refused_at', null) guardrail at DB).
//
// No DB / RLS / RPC / migration changes.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toUaCountry } from "@/lib/countries";
import { STATUS_LABEL, type ManagerOfferStatus } from "@/lib/manager-offers";

type Row = {
  responseId: string;
  offerId: string;
  branchId: string;
  branchName: string;
  product: string;
  country: string;
  variety: string | null;
  caliber: string | null;
  requested: number;
  eta: string | null;
  status: ManagerOfferStatus;
};

export type BranchPendingSummary = {
  branches: number;
  positions: number;
  pallets: number;
  rows: Row[];
};

const QUERY_KEY = ["dash-manager", "branch-pending-responses"] as const;

export function useBranchPendingResponses() {
  const { user } = useAuth();
  return useQuery({
    enabled: !!user?.id,
    queryKey: [...QUERY_KEY, user?.id],
    queryFn: async (): Promise<BranchPendingSummary> => {
      const uid = user!.id;
      const { data: mgrIdRaw } = await supabase.rpc("current_import_manager_id");
      const mgrId = (mgrIdRaw ?? null) as string | null;

      // 1. Fetch own/responsible offers (not deleted).
      const ownerFilter = mgrId
        ? `import_manager_id.eq.${mgrId},created_by.eq.${uid}`
        : `created_by.eq.${uid}`;
      const { data: offers, error: oErr } = await supabase
        .from("manager_offers")
        .select(
          "id, status, product_name, origin_country, variety, caliber, expected_eta, import_manager_id, created_by",
        )
        .neq("status", "deleted")
        .or(ownerFilter);
      if (oErr) throw oErr;
      const offerList = (offers ?? []) as Array<{
        id: string;
        status: ManagerOfferStatus;
        product_name: string;
        origin_country: string | null;
        variety: string | null;
        caliber: string | null;
        expected_eta: string | null;
      }>;
      if (!offerList.length) return { branches: 0, positions: 0, pallets: 0, rows: [] };

      const offerIds = offerList.map((o) => o.id);
      const offerMap = new Map(offerList.map((o) => [o.id, o]));

      // 2. Pending responses on those offers.
      const { data: resps, error: rErr } = await supabase
        .from("manager_offer_responses")
        .select("id, offer_id, branch_id, requested_pallets, approved_pallets, refused_at")
        .in("offer_id", offerIds)
        .gt("requested_pallets", 0)
        .is("approved_pallets", null)
        .is("refused_at", null);
      if (rErr) throw rErr;
      const respList = (resps ?? []) as Array<{
        id: string;
        offer_id: string;
        branch_id: string;
        requested_pallets: number;
      }>;
      if (!respList.length) return { branches: 0, positions: 0, pallets: 0, rows: [] };

      // 3. Branch names.
      const branchIds = [...new Set(respList.map((r) => r.branch_id))];
      const { data: branches } = await supabase
        .from("branches")
        .select("id, name")
        .in("id", branchIds);
      const bMap = new Map((branches ?? []).map((b) => [b.id, b.name as string]));

      const rows: Row[] = respList.map((r) => {
        const o = offerMap.get(r.offer_id)!;
        return {
          responseId: r.id,
          offerId: r.offer_id,
          branchId: r.branch_id,
          branchName: bMap.get(r.branch_id) ?? "—",
          product: o.product_name,
          country: toUaCountry(o.origin_country),
          variety: o.variety,
          caliber: o.caliber,
          requested: Number(r.requested_pallets) || 0,
          eta: o.expected_eta,
          status: o.status,
        };
      });

      const branchSet = new Set(rows.map((r) => r.branchId));
      const positionSet = new Set(rows.map((r) => r.offerId));
      const pallets = rows.reduce((s, r) => s + r.requested, 0);

      // Stable sort: newest-ish first by offer eta NULLS LAST, then product.
      rows.sort((a, b) => {
        const ea = a.eta ?? "9999";
        const eb = b.eta ?? "9999";
        if (ea !== eb) return ea.localeCompare(eb);
        return a.product.localeCompare(b.product, "uk");
      });

      return { branches: branchSet.size, positions: positionSet.size, pallets, rows };
    },
    refetchInterval: 60_000,
  });
}

export function BranchPendingResponsesSheet({
  open,
  onOpenChange,
  rows,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  rows: Row[];
}) {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["dash-manager"] }),
      qc.invalidateQueries({ queryKey: ["manager-offers"] }),
      qc.invalidateQueries({ queryKey: ["manager-offer-responses"] }),
      qc.invalidateQueries({ queryKey: ["branch-active-offers"] }),
      qc.invalidateQueries({ queryKey: ["nav-pending-manager-responses"] }),
    ]);
  };

  const confirm = useMutation({
    mutationFn: async ({ id, requested }: { id: string; requested: number }) => {
      // Exact same shape + guardrail as manager-offers.tsx approveAllPending.
      const { error } = await supabase
        .from("manager_offer_responses")
        .update({ approved_pallets: requested })
        .eq("id", id)
        .is("approved_pallets", null)
        .is("refused_at", null);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Підтверджено");
      await invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setBusyId(null),
  });

  const refuse = useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error("Сесія втрачена — увійдіть знову");
      const { error } = await supabase
        .from("manager_offer_responses")
        .update({
          refused_at: new Date().toISOString(),
          refused_by: user.id,
        })
        .eq("id", id)
        .is("approved_pallets", null)
        .is("refused_at", null);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("Відмовлено");
      await invalidateAll();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setBusyId(null),
  });

  const visible = useMemo(() => rows, [rows]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="text-base">Заявки філій · очікують підтвердження</SheetTitle>
        </SheetHeader>
        <div className="max-h-[calc(100vh-56px)] overflow-y-auto px-3 py-2">
          {!visible.length ? (
            <EmptyState title="Немає заявок" hint="Усі відгуки опрацьовано" />
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((r) => {
                const busy = busyId === r.responseId;
                return (
                  <li key={r.responseId} className="py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">
                          {r.product}
                          {r.country ? <span className="text-muted-foreground"> · {r.country}</span> : null}
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {[r.variety, r.caliber].filter(Boolean).join(" · ") || "—"}
                        </div>
                        <div className="mt-0.5 text-[11px]">
                          <span className="font-medium text-foreground">{r.branchName}</span>
                          {r.eta ? <span className="text-muted-foreground"> · ETA {r.eta}</span> : null}
                          {r.status && r.status !== "active" ? (
                            <span className="ml-1 align-middle">
                              <StatusChip label={STATUS_LABEL[r.status] ?? r.status} tone="muted" />
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="shrink-0 rounded-full bg-brand/15 px-2.5 py-0.5 text-xs font-bold text-brand">
                        {r.requested}п
                      </div>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        className="h-7 flex-1 bg-emerald-600 text-white hover:bg-emerald-600/90"
                        disabled={busy}
                        onClick={() => {
                          setBusyId(r.responseId);
                          confirm.mutate({ id: r.responseId, requested: r.requested });
                        }}
                      >
                        {busy && confirm.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        Підтвердити
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 flex-1 border-destructive text-destructive hover:bg-destructive/10"
                        disabled={busy}
                        onClick={() => {
                          setBusyId(r.responseId);
                          refuse.mutate({ id: r.responseId });
                        }}
                      >
                        {busy && refuse.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                        Відмовити
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
