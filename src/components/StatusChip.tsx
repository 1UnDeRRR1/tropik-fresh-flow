import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";

export type ShipmentStatus = Database["public"]["Enums"]["shipment_status"];
export type DistributionStatus = Database["public"]["Enums"]["distribution_status"];
export type TransferStatus = Database["public"]["Enums"]["transfer_status"];

export const SHIPMENT_LABEL: Record<ShipmentStatus, string> = {
  draft: "Чернетка",
  in_transit: "У дорозі",
  customs: "Митниця",
  arrived: "Прибуло",
  distributing: "Розподіл",
  completed: "Завершено",
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

export function StatusChip({
  status,
  kind = "shipment",
}: {
  status: string;
  kind?: "shipment" | "distribution" | "transfer";
}) {
  const label =
    kind === "shipment"
      ? SHIPMENT_LABEL[status as ShipmentStatus] ?? status
      : kind === "distribution"
        ? DIST_LABEL[status as DistributionStatus] ?? status
        : TRANSFER_LABEL[status as TransferStatus] ?? status;

  const tone =
    status === "completed" || status === "received" || status === "approved"
      ? "bg-success/15 text-success"
      : status === "in_transit" || status === "dispatched" || status === "distributing"
        ? "bg-info/15 text-info"
        : status === "customs" || status === "arrived" || status === "planned" || status === "requested"
          ? "bg-warning/15 text-warning"
          : status === "cancelled"
            ? "bg-destructive/15 text-destructive"
            : "bg-muted text-muted-foreground";

  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", tone)}>
      {label}
    </span>
  );
}
