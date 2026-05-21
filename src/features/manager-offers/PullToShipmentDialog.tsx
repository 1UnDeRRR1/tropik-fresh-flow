import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  useMatchingShipmentItems,
  type MatchingShipmentItem,
} from "./useMatchingShipmentItems";

type OfferLike = {
  id: string;
  product_name: string;
  origin_country: string | null;
  caliber: string | null;
  created_by: string;
};

/**
 * PullToShipmentDialog — clean isolated replacement for the old LinkShipmentDialog.
 *
 * - Lists matching shipment_items only (NEVER truck/vehicle capacity).
 * - "Вільних палет" = exact shipment_item.pallet_count − Σ GREATEST(pallets, reserved_pallets).
 * - Click attaches via atomic RPC link_manager_offer_to_shipment_item to the EXACT shipment_item_id.
 * - On caliber mismatch (yellow), asks once to confirm; retries with allow_caliber_mismatch=true.
 * - No second step. No "Прив'язати до поставки" intermediate dialog. No auto-reopen.
 * - On success: closes itself, invalidates queries, and calls onLinked().
 */
export function PullToShipmentDialog({
  offer,
  onClose,
  onLinked,
}: {
  offer: OfferLike | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const qc = useQueryClient();
  const open = !!offer;
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: items, isLoading } = useMatchingShipmentItems(offer);

  const visible = useMemo(() => items ?? [], [items]);

  const link = useMutation({
    mutationFn: async (args: {
      shipment_item_id: string;
      allow_caliber_mismatch: boolean;
    }) => {
      if (!offer) throw new Error("no_offer");
      const { data, error } = await supabase.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "link_manager_offer_to_shipment_item" as any,
        {
          p_offer_id: offer.id,
          p_shipment_item_id: args.shipment_item_id,
          p_allow_caliber_mismatch: args.allow_caliber_mismatch,
        },
      );
      if (error) throw error;
      // RPC returns a table; supabase-js returns array
      const row = Array.isArray(data) ? data[0] : data;
      return row as { remaining_to_load: number; shipment_id: string } | null;
    },
    onSuccess: (row) => {
      const remaining = Number(row?.remaining_to_load ?? 0);
      toast.success(
        remaining > 0
          ? `Прив'язано. Залишилось завантажити: ${remaining}п`
          : "Прив'язано повністю",
      );
      qc.invalidateQueries({ queryKey: ["manager-offers"] });
      qc.invalidateQueries({ queryKey: ["manager-offer-responses"] });
      qc.invalidateQueries({ queryKey: ["manager-offer-linked-shipments"] });
      qc.invalidateQueries({ queryKey: ["pull-matching-shipment-items"] });
      setBusyId(null);
      onLinked();
    },
    onError: (e: Error) => {
      setBusyId(null);
      toast.error(humanizeRpcError(e.message));
    },
  });

  const handleClick = (it: MatchingShipmentItem) => {
    if (link.isPending) return;
    setBusyId(it.shipment_item_id);
    if (it.caliber_match === "yellow") {
      const ok = window.confirm(
        `Калібр у поставці (${it.caliber ?? "—"}) відрізняється від калібру пропозиції (${offer?.caliber ?? "—"}). Прив'язати все одно?`,
      );
      if (!ok) {
        setBusyId(null);
        return;
      }
      link.mutate({
        shipment_item_id: it.shipment_item_id,
        allow_caliber_mismatch: true,
      });
      return;
    }
    link.mutate({
      shipment_item_id: it.shipment_item_id,
      allow_caliber_mismatch: false,
    });
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && !link.isPending && onClose()}>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] overflow-y-auto rounded-t-2xl"
      >
        <SheetHeader className="text-left">
          <SheetTitle>Підтягнути до поставки</SheetTitle>
        </SheetHeader>

        {offer && (
          <div className="mt-3 space-y-3">
            <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
              <div className="font-semibold">{offer.product_name}</div>
              <div className="text-xs text-muted-foreground">
                {offer.origin_country ?? "—"}
                {offer.caliber ? ` · калібр ${offer.caliber}` : ""}
              </div>
            </div>

            {isLoading && (
              <p className="text-sm text-muted-foreground">Завантаження…</p>
            )}

            {!isLoading && visible.length === 0 && (
              <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
                Немає підходящої поставки з вільними палетами для цього товару.
              </div>
            )}

            <ul className="space-y-2">
              {visible.map((it) => {
                const isBusy = busyId === it.shipment_item_id && link.isPending;
                const eta = it.shipment_arrived_at ?? it.shipment_eta;
                return (
                  <li key={it.shipment_item_id}>
                    <button
                      type="button"
                      disabled={link.isPending}
                      onClick={() => handleClick(it)}
                      className={cn(
                        "w-full rounded-xl border p-3 text-left transition",
                        it.caliber_match === "green"
                          ? "border-success/40 bg-success/5 hover:bg-success/10"
                          : "border-warning/40 bg-warning/5 hover:bg-warning/10",
                        link.isPending && "opacity-60",
                        isBusy && "ring-2 ring-primary",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold">
                            {it.shipment_code}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {it.product_name}
                            {it.origin_country ? ` · ${it.origin_country}` : ""}
                            {it.caliber ? ` · калібр ${it.caliber}` : ""}
                            {eta
                              ? ` · ${new Date(eta).toLocaleDateString("uk-UA")}`
                              : ""}
                          </div>
                        </div>
                        <div className="text-right">
                          <div
                            className={cn(
                              "text-sm font-bold tabular-nums",
                              it.caliber_match === "green"
                                ? "text-success"
                                : "text-warning",
                            )}
                          >
                            {it.available_pallets}п
                          </div>
                          <div className="text-[10px] uppercase text-muted-foreground">
                            вільно
                          </div>
                        </div>
                      </div>
                      {it.caliber_match === "yellow" && (
                        <div className="mt-1 text-[11px] font-semibold text-warning">
                          Калібр не співпадає
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function humanizeRpcError(msg: string): string {
  if (msg.includes("caliber_mismatch")) return "Калібр поставки не співпадає";
  if (msg.includes("product_mismatch")) return "Товар не співпадає";
  if (msg.includes("country_mismatch")) return "Країна не співпадає";
  if (msg.includes("shipment_item_already_linked"))
    return "Цю позицію вже прив'язано до іншої пропозиції";
  if (msg.includes("shipment_not_active")) return "Поставка не активна";
  if (msg.includes("forbidden")) return "Немає прав";
  return msg || "Не вдалося прив'язати";
}
