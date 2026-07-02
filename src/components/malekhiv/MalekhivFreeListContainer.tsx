import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { MalekhivFreeList, type MalekhivFreeRow } from "./MalekhivFreeList";

/**
 * Stateful wrapper that owns per-row drafts and does the same
 * `branch_requests` insert (request_type='free_offer') that the legacy
 * Dialog performed. Keeps the route file thin.
 */
export function MalekhivFreeListContainer({
  rows,
  userId,
  branchId,
}: {
  rows: MalekhivFreeRow[];
  userId: string;
  branchId: string;
}) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, { pallets: string; price: string; currency: string }>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Record<string, { pallets: boolean; price: boolean } | undefined>>({});
  const [shake, setShake] = useState<string | null>(null);

  const onDraftChange = (
    itemId: string,
    patch: Partial<{ pallets: string; price: string; currency: string }>,
  ) => {
    setDrafts((prev) => {
      const row = rows.find((r) => r.itemId === itemId);
      const defaults = { pallets: String(row?.free ?? ""), price: "", currency: "UAH" };
      const current = prev[itemId] ?? defaults;
      return { ...prev, [itemId]: { ...current, ...patch } };
    });
    if (patch.pallets != null) setInvalid((s) => ({ ...s, [itemId]: { ...(s[itemId] ?? { pallets: false, price: false }), pallets: false } }));
    if (patch.price != null) setInvalid((s) => ({ ...s, [itemId]: { ...(s[itemId] ?? { pallets: false, price: false }), price: false } }));
  };

  const onSubmit = async (r: MalekhivFreeRow) => {
    const d = drafts[r.itemId] ?? { pallets: String(r.free), price: "", currency: "UAH" };
    const p = Number(d.pallets);
    const pr = Number(d.price);
    const badPallets = !p || p <= 0 || p > r.free;
    const badPrice = !pr || pr <= 0;
    if (badPallets || badPrice) {
      setInvalid((s) => ({ ...s, [r.itemId]: { pallets: badPallets, price: badPrice } }));
      setShake(r.itemId);
      window.setTimeout(() => setShake(null), 600);
      return;
    }
    setSubmitting(r.itemId);
    const { error } = await supabase.from("branch_requests").insert({
      branch_id: branchId,
      shipment_id: r.shipmentId,
      shipment_item_id: r.itemId,
      pallets: p,
      qty: p * r.palletWeight,
      sale_price: pr,
      sale_currency: d.currency,
      request_type: "free_offer",
      status: "pending",
      requested_by: userId,
      notes: `Пропозиція по ${r.product} (${r.code}): ${p}п × ${pr} ${d.currency}/кг`,
    });
    setSubmitting(null);
    if (error) {
      if (typeof error.message === "string" && error.message.includes("BSR_INSERT_NO_POSITION_FOR_ITEM")) {
        toast.error("Позиція недоступна для заявки. Оновіть список або зверніться до менеджера.");
      } else {
        toast.error(error.message);
      }
    } else {
      toast.success("Пропозицію відправлено імпорт-менеджеру");
      setDrafts((prev) => ({ ...prev, [r.itemId]: { pallets: "", price: "", currency: d.currency } }));
    }
    qc.invalidateQueries({ queryKey: ["branch-free-items"] });
    qc.invalidateQueries({ queryKey: ["branch-free-ships"] });
    qc.invalidateQueries({ queryKey: ["branch-free-pending"] });
  };

  return (
    <MalekhivFreeList
      rows={rows}
      drafts={drafts}
      onDraftChange={onDraftChange}
      onSubmit={onSubmit}
      submitting={submitting}
      invalid={invalid}
      shake={shake}
    />
  );
}
