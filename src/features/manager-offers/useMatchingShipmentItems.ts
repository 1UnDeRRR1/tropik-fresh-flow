import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export type MatchingShipmentItem = {
  shipment_item_id: string;
  shipment_id: string;
  shipment_code: string;
  shipment_eta: string | null;
  shipment_arrived_at: string | null;
  product_name: string;
  origin_country: string | null;
  caliber: string | null;
  pallet_count: number;
  available_pallets: number;
  caliber_match: "green" | "yellow"; // green = caliber match or both empty; yellow = differs
};

type Offer = {
  id: string;
  product_name: string;
  origin_country: string | null;
  caliber: string | null;
  created_by: string;
};

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Finds shipment_items eligible to receive a manager_offer link.
 *
 * Rules (Tropik Safe Development Rules):
 *  - match by product_name (required) + origin_country (when offer sets it).
 *  - green = caliber match (or both empty); yellow = both set and differ.
 *  - available_pallets = shipment_item.pallet_count
 *      − Σ GREATEST(distribution_items.pallets, distribution_items.reserved_pallets)
 *      computed PER EXACT shipment_item (NEVER truck-capacity-based).
 *  - available_pallets ≤ 0 → item is hidden.
 *  - shipment.status NOT IN (cancelled, archived).
 *  - shipment_item.linked_offer_id must be NULL or equal to current offer.id.
 */
export function useMatchingShipmentItems(offer: Offer | null) {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole(["admin", "super_admin"]);

  return useQuery<MatchingShipmentItem[]>({
    queryKey: [
      "pull-matching-shipment-items",
      offer?.id,
      offer?.product_name,
      offer?.origin_country,
      offer?.caliber,
      user?.id,
      isAdmin,
    ],
    enabled: !!offer && !!user,
    queryFn: async () => {
      if (!offer || !user) return [];

      let shipQ = supabase
        .from("shipments")
        .select(
          "id,code,eta,arrived_at,status,created_by,shipment_items(id,product_name,origin_country,caliber,pallet_count,linked_offer_id)",
        )
        .not("status", "in", "(cancelled,archived)")
        .order("created_at", { ascending: false })
        .limit(300);
      if (!isAdmin) shipQ = shipQ.eq("created_by", user.id);

      const { data: shipments, error } = await shipQ;
      if (error) throw error;

      const target = norm(offer.product_name);
      const tCountry = norm(offer.origin_country);
      const tCaliber = norm(offer.caliber);

      type SI = {
        id: string;
        product_name: string;
        origin_country: string | null;
        caliber: string | null;
        pallet_count: number | null;
        linked_offer_id: string | null;
      };
      type SH = {
        id: string;
        code: string;
        eta: string | null;
        arrived_at: string | null;
        shipment_items: SI[] | null;
      };

      const candidates: Array<{
        shipment: SH;
        item: SI;
        caliber_match: "green" | "yellow";
      }> = [];

      for (const s of (shipments ?? []) as SH[]) {
        for (const i of s.shipment_items ?? []) {
          if (norm(i.product_name) !== target) continue;
          // Country: if offer has a country, require match
          if (tCountry && norm(i.origin_country) !== tCountry) continue;
          // linked_offer_id: must be free or already this offer
          if (i.linked_offer_id && i.linked_offer_id !== offer.id) continue;

          // Caliber gate
          const ic = norm(i.caliber);
          let match: "green" | "yellow";
          if (!tCaliber && !ic) match = "green";
          else if (tCaliber && ic && tCaliber === ic) match = "green";
          else if (tCaliber && ic && tCaliber !== ic) match = "yellow";
          else match = "green"; // one side empty → not a hard mismatch
          candidates.push({ shipment: s, item: i, caliber_match: match });
        }
      }

      if (!candidates.length) return [];

      const itemIds = candidates.map((c) => c.item.id);
      const { data: dis, error: e2 } = await supabase
        .from("distribution_items")
        .select("shipment_item_id,pallets,reserved_pallets")
        .in("shipment_item_id", itemIds);
      if (e2) throw e2;

      const used = new Map<string, number>();
      for (const d of (dis ?? []) as {
        shipment_item_id: string;
        pallets: number | null;
        reserved_pallets: number | null;
      }[]) {
        const v = Math.max(Number(d.pallets ?? 0), Number(d.reserved_pallets ?? 0));
        used.set(d.shipment_item_id, (used.get(d.shipment_item_id) ?? 0) + v);
      }

      const out: MatchingShipmentItem[] = [];
      for (const c of candidates) {
        const total = Number(c.item.pallet_count ?? 0);
        const u = used.get(c.item.id) ?? 0;
        const available = Math.max(total - u, 0);
        if (available <= 0) continue; // hide fully-distributed items
        out.push({
          shipment_item_id: c.item.id,
          shipment_id: c.shipment.id,
          shipment_code: c.shipment.code,
          shipment_eta: c.shipment.eta,
          shipment_arrived_at: c.shipment.arrived_at,
          product_name: c.item.product_name,
          origin_country: c.item.origin_country,
          caliber: c.item.caliber,
          pallet_count: total,
          available_pallets: available,
          caliber_match: c.caliber_match,
        });
      }

      // green first, then by ETA ascending
      out.sort((a, b) => {
        if (a.caliber_match !== b.caliber_match)
          return a.caliber_match === "green" ? -1 : 1;
        const ae = a.shipment_arrived_at ?? a.shipment_eta ?? "";
        const be = b.shipment_arrived_at ?? b.shipment_eta ?? "";
        return ae < be ? -1 : ae > be ? 1 : 0;
      });

      return out;
    },
  });
}
