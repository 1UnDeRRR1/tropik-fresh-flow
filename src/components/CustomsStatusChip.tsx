// Patch 6B — three-variant customs status chip.
import { cn } from "@/lib/utils";
import { CUSTOMS_STRINGS, type CustomsStatus } from "@/lib/customs-status";

export function CustomsStatusChip({
  status,
  className,
  compact = false,
}: {
  status: CustomsStatus;
  className?: string;
  compact?: boolean;
}) {
  const base =
    "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-tight";
  if (status === "green") {
    return (
      <span
        className={cn(
          base,
          "border-success/40 bg-success/10 text-success",
          className,
        )}
      >
        {CUSTOMS_STRINGS.green}
      </span>
    );
  }
  if (status === "yellow") {
    return (
      <span
        className={cn(
          base,
          "border-warning/40 bg-warning/10 text-warning",
          className,
        )}
        title={CUSTOMS_STRINGS.yellow}
      >
        {compact
          ? "Митна база: країну не знайдено"
          : CUSTOMS_STRINGS.yellow}
      </span>
    );
  }
  // RED
  return (
    <div className={cn("inline-flex flex-col items-start gap-0.5", className)}>
      <span
        className={cn(
          base,
          "border-destructive/40 bg-destructive/10 text-destructive",
        )}
      >
        {CUSTOMS_STRINGS.redTitle}
      </span>
      <span className="text-[10px] font-medium text-destructive/90">
        {CUSTOMS_STRINGS.redSubtitle}
      </span>
    </div>
  );
}
