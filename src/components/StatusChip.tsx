import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

export type ShipmentStatus = Database["public"]["Enums"]["shipment_status"];
export type DistributionStatus = Database["public"]["Enums"]["distribution_status"];
export type TransferStatus = Database["public"]["Enums"]["transfer_status"];

export const SHIPMENT_LABEL: Record<ShipmentStatus, string> = {
  draft: "Чернетка",
  loading: "Завантаження",
  in_transit: "У дорозі",
  customs: "Митниця",
  arrived: "Прибуло",
  distributing: "Розподіл",
  completed: "Завершено",
  delayed: "Затримка",
  cancelled: "Скасовано",
};

export const DIST_LABEL: Record<DistributionStatus, string> = {
  planned: "Заплановано",
  dispatched: "Відправлено",
  received: "Отримано",
  cancelled: "Скасовано",
};

export const TRANSFER_LABEL: Record<TransferStatus, string> = {
  requested: "Запит",
  approved: "Підтверджено",
  in_transit: "У дорозі",
  received: "Отримано",
  cancelled: "Скасовано",
};

export const BR_LABEL: Record<string, string> = {
  pending: "На розгляді",
  approved: "Затверджено",
  rejected: "Відхилено",
  fulfilled: "Виконано",
  cancelled: "Скасовано",
};

export function statusTone(status: string): string {
  if (status === "delayed" || status === "rejected" || status === "cancelled")
    return "bg-destructive/15 text-destructive";
  if (status === "completed" || status === "received" || status === "approved" || status === "fulfilled")
    return "bg-success/15 text-success";
  if (status === "arrived" || status === "customs" || status === "pending" || status === "loading" || status === "planned" || status === "requested")
    return "bg-warning/15 text-warning";
  if (status === "in_transit" || status === "dispatched" || status === "distributing")
    return "bg-info/15 text-info";
  return "bg-muted text-muted-foreground";
}

export function StatusChip({
  status,
  kind = "shipment",
}: {
  status: string;
  kind?: "shipment" | "distribution" | "transfer" | "branch_request";
}) {
  const label =
    kind === "shipment"
      ? SHIPMENT_LABEL[status as ShipmentStatus] ?? status
      : kind === "distribution"
        ? DIST_LABEL[status as DistributionStatus] ?? status
        : kind === "branch_request"
          ? BR_LABEL[status] ?? status
          : TRANSFER_LABEL[status as TransferStatus] ?? status;

  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", statusTone(status))}>
      {label}
    </span>
  );
}
