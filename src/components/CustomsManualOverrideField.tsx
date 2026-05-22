// Patch 6B — RED manual customs duty field with confirm button.
// On confirm the parent decides whether to (a) call the relevant RPC
// (existing offer / shipment_item already persisted) or (b) just store
// the pending duty locally (new offer Path A — RPC runs at insert time).
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CUSTOMS_STRINGS } from "@/lib/customs-status";
import { cn } from "@/lib/utils";

export function CustomsManualOverrideField({
  confirmedDuty,
  onConfirm,
  pending = false,
  disabled = false,
  className,
}: {
  /** Value already confirmed against the current product/country, or null. */
  confirmedDuty: number | null;
  /** Called when the user clicks the confirm button with a positive number. */
  onConfirm: (duty: number) => void | Promise<void>;
  pending?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const [value, setValue] = useState<string>(
    confirmedDuty != null ? String(confirmedDuty) : "",
  );

  // Keep the visible value in sync when the parent confirms a new override
  // (e.g. RPC succeeded → confirmedDuty changed from null to number).
  useEffect(() => {
    if (confirmedDuty != null) setValue(String(confirmedDuty));
  }, [confirmedDuty]);

  const num = Number(value);
  const isValid = Number.isFinite(num) && num > 0;
  const canConfirm = isValid && !pending && !disabled;

  return (
    <div
      className={cn(
        "rounded-md border border-destructive/30 bg-destructive/5 p-2 space-y-2",
        className,
      )}
    >
      <label className="block text-[11px] font-medium text-destructive">
        {CUSTOMS_STRINGS.manualLabel}
      </label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          step="0.0001"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled || pending}
          className="h-8 text-xs"
          placeholder="0.0000"
          inputMode="decimal"
        />
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="h-8 whitespace-nowrap text-[11px]"
          disabled={!canConfirm}
          onClick={() => {
            if (!canConfirm) return;
            void onConfirm(num);
          }}
        >
          {CUSTOMS_STRINGS.manualConfirm}
        </Button>
      </div>
      {confirmedDuty != null && (
        <div className="text-[10px] font-medium text-success">
          {CUSTOMS_STRINGS.manualConfirmedPrefix} {confirmedDuty.toFixed(4)} USD/кг
        </div>
      )}
    </div>
  );
}
