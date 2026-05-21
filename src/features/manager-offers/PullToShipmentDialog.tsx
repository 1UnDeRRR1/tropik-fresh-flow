import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
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
 * Phase 2b pre-work (split allocations):
 * - one offer → many shipment_items.
 * - per-row pallets input; attach is ADDITIVE (UPSERT in RPC).
 * - "Вільних палет" = exact shipment_item.pallet_count − Σ distribution_items.pallets.
 *   NEVER truck/vehicle capacity.
 * - "Вже з цієї пропозиції" shown when this offer already has pallets on the item.
 * - Server RPC enforces capacity AND remaining offer demand.
 * - Yellow caliber: one-time confirm → allow_caliber_mismatch=true.
 * - shipment_item.caliber is never overwritten.
 */
export function PullToShipmentDialog({
  offer,
  remainingForOffer,
  onClose,
  onLinked,
}: {
  offer: OfferLike | null;
  remainingForOffer: number;
  onClose: () => void;
  onLinked: () => void;
}) {
  const qc = useQueryClient();
  const open = !!offer;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});

  const { data: items, isLoading } = useMatchingShipmentItems(offer);
  const visible = useMemo(() => items ?? [], [items]);

  // Initialize default pallets per row whenever results change
  useEffect(() => {
    if (!visible.length) return;
    setQty((prev) => {
      const next = { ...prev };
      for (const it of visible) {
        if (next[it.shipment_item_id] == null) {
          const def = Math.max(
            0,
            Math.min(remainingForOffer, it.available_pallets),
          );
          next[it.shipment_item_id] = def > 0 ? String(def) : "";
        }
      }
      return next;
    });
  }, [visible, remainingForOffer]);

  const link = useMutation({
    mutationFn: async (args: {
      shipment_item_id: string;
      pallets: number;
      allow_caliber_mismatch: boolean;
    }) => {
      if (!offer) throw new Error("no_offer");
      const { data, error } = await supabase.rpc(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        "link_manager_offer_to_shipment_item" as any,
        {
          p_offer_id: offer.id,
          p_shipment_item_id: args.shipment_item_id,
          p_pallets: args.pallets,
          p_allow_caliber_mismatch: args.allow_caliber_mismatch,
        },
      );
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return row as { remaining_to_load: number; shipment_id: string } | null;
    },
    onSuccess: (row, vars) => {
      const remaining = Number(row?.remaining_to_load ?? 0);
      toast.success(
        remaining > 0
          ? `Прив'язано ${vars.pallets}п. Залишилось: ${remaining}п`
          : `Прив'язано ${vars.pallets}п. Пропозиція завантажена повністю`,
      );
      qc.invalidateQueries({ queryKey: ["manager-offers"] });
      qc.invalidateQueries({ queryKey: ["manager-offer-responses"] });
      qc.invalidateQueries({ queryKey: ["manager-offer-linked-shipments"] });
      qc.invalidateQueries({ queryKey: ["pull-matching-shipment-items"] });
      setBusyId(null);
      if (remaining <= 0) onLinked();
    },
    onError: (e: Error) => {
      setBusyId(null);
      toast.error(humanizeRpcError(e.message));
    },
  });

  const handleAttach = (it: MatchingShipmentItem) => {
    if (link.isPending) return;
    const raw = qty[it.shipment_item_id] ?? "";
    const p = Number(raw);
    if (!Number.isFinite(p) || p <= 0) {
      toast.error("Вкажіть кількість палет більше 0");
      return;
    }
    if (p > it.available_pallets) {
      toast.error(`Максимум для цієї позиції: ${it.available_pallets}п`);
      return;
    }
    if (p > remainingForOffer) {
      toast.error(`Перевищено залишок пропозиції: ${remainingForOffer}п`);
      return;
    }
    setBusyId(it.shipment_item_id);
    if (it.caliber_match === "yellow") {
      const ok = window.confirm(
        `Калібр у поставці (${it.caliber ?? "—"}) відрізняється від калібру пропозиції (${offer?.caliber ?? "—"}). Прив'язати ${p}п все одно?`,
      );
      if (!ok) {
        setBusyId(null);
        return;
      }
      link.mutate({
        shipment_item_id: it.shipment_item_id,
        pallets: p,
        allow_caliber_mismatch: true,
      });
      return;
    }
    link.mutate({
      shipment_item_id: it.shipment_item_id,
      pallets: p,
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
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold">{offer.product_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {offer.origin_country ?? "—"}
                    {offer.caliber ? ` · калібр ${offer.caliber}` : ""}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold tabular-nums">
                    {remainingForOffer}п
                  </div>
                  <div className="text-[10px] uppercase text-muted-foreground">
                    залишок
                  </div>
                </div>
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
                const maxAttach = Math.min(
                  it.available_pallets,
                  Math.max(remainingForOffer, 0),
                );
                return (
                  <li
                    key={it.shipment_item_id}
                    className={cn(
                      "rounded-xl border p-3 transition",
                      it.caliber_match === "green"
                        ? "border-success/40 bg-success/5"
                        : "border-warning/40 bg-warning/5",
                      isBusy && "ring-2 ring-primary",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold">{it.shipment_code}</div>
                        <div className="text-xs text-muted-foreground">
                          {it.product_name}
                          {it.origin_country ? ` · ${it.origin_country}` : ""}
                          {it.caliber ? ` · калібр ${it.caliber}` : ""}
                          {eta
                            ? ` · ${new Date(eta).toLocaleDateString("uk-UA")}`
                            : ""}
                        </div>
                        {it.already_linked_to_this_offer > 0 && (
                          <div className="mt-1 text-[11px] font-semibold text-primary">
                            Вже прив'язано з цієї пропозиції:{" "}
                            {it.already_linked_to_this_offer}п
                          </div>
                        )}
                        {it.caliber_match === "yellow" && (
                          <div className="mt-1 text-[11px] font-semibold text-warning">
                            Калібр не співпадає
                          </div>
                        )}
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

                    <div className="mt-3 flex items-center gap-2">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.5"
                        value={qty[it.shipment_item_id] ?? ""}
                        onChange={(e) =>
                          setQty((q) => ({
                            ...q,
                            [it.shipment_item_id]: e.target.value,
                          }))
                        }
                        disabled={link.isPending}
                        className="h-9 w-24"
                        placeholder="п"
                      />
                      <Button
                        type="button"
                        size="sm"
                        disabled={link.isPending || maxAttach <= 0}
                        onClick={() => handleAttach(it)}
                      >
                        {isBusy ? "…" : "Прив'язати"}
                      </Button>
                      <span className="text-[11px] text-muted-foreground">
                        макс {maxAttach}п
                      </span>
                    </div>
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
  if (msg.includes("not_enough_capacity_on_item"))
    return "Перевищено вільні палети поставки";
  if (msg.includes("exceeds_offer_remaining"))
    return "Перевищено залишок пропозиції";
  if (msg.includes("invalid_pallets")) return "Невірна кількість палет";
  if (msg.includes("shipment_not_active")) return "Поставка не активна";
  if (msg.includes("forbidden")) return "Немає прав";
  return msg || "Не вдалося прив'язати";
}
