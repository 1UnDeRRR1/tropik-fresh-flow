// Counter hook for import-manager Головна → "Заявки філій" card.
//
// The custom Sheet/form UI that previously lived here was rejected:
// clicking the card now navigates to the standard manager-offers table
// filtered via ?mode=branchRequests. Only the read-only counter hook
// remains (distinct branches, distinct offers/positions, sum requested).
//
// No DB / RLS / RPC / migration changes.

import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toUaCountry } from "@/lib/countries";
import type { ManagerOfferStatus } from "@/lib/manager-offers";

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

      return { branches: branchSet.size, positions: positionSet.size, pallets, rows };
    },
    refetchInterval: 60_000,
  });
}
