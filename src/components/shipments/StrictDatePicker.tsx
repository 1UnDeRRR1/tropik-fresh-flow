// Build 2A.8 — create-flow date picker (Ukrainian, validated always).
// Uses shadcn Popover + Calendar with date-fns/locale/uk. Shows compact
// "DD.MM.YYYY" in the trigger so the field never overflows on iPhone.
import * as React from "react";
import { format, parseISO, isValid } from "date-fns";
import { uk } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function StrictDatePicker({
  value,
  onChange,
  minDate,
  placeholder = "—",
  invalid = false,
  ariaLabel,
}: {
  value: string; // YYYY-MM-DD
  onChange: (v: string) => void;
  minDate?: Date;
  placeholder?: string;
  invalid?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const parsed = value ? parseISO(value) : undefined;
  const selected = parsed && isValid(parsed) ? parsed : undefined;

  // Always-on validation: if a saved value falls below minDate (e.g. minDate
  // moves because loadingDate changed), clear it on next interaction.
  React.useEffect(() => {
    if (!selected || !minDate) return;
    if (selected < stripTime(minDate)) onChange("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minDate?.getTime?.(), value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className={cn(
            "flex h-9 w-full min-w-0 items-center justify-between gap-1 rounded-md border border-input bg-background px-2 text-left text-[13px] tabular-nums",
            !selected && "text-muted-foreground",
            invalid && "border-destructive/70 ring-1 ring-destructive/40",
          )}
        >
          <span className="truncate">
            {selected ? format(selected, "dd.MM.yyyy", { locale: uk }) : placeholder}
          </span>
          <CalendarIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(d) => {
            if (!d) return;
            if (minDate && d < stripTime(minDate)) return;
            onChange(toIso(d));
            setOpen(false);
          }}
          disabled={minDate ? { before: stripTime(minDate) } : undefined}
          defaultMonth={selected ?? minDate ?? new Date()}
          locale={uk}
          initialFocus
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
}

function stripTime(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
