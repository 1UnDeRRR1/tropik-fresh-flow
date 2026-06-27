// Build 2A.9 — create-only polished dropdown card used for Клас and Сорт on
// /shipments/new. The dropdown:
//   - matches the trigger width exactly,
//   - stays anchored to the trigger,
//   - opens below by default and flips above when there is no space,
//   - has internal scrolling for long option lists,
//   - selects on click (selection-only, no free text),
//   - reuses shadcn Popover so opening/closing animations match the rest
//     of the app.
//
// Used only by NewShipmentProductCard. The saved editor's VarietyCell /
// class select is intentionally not touched.
import * as React from "react";
import { ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function StrictSelectCard({
  value,
  onChange,
  options,
  placeholder = "—",
  disabled = false,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [triggerWidth, setTriggerWidth] = React.useState<number | undefined>(undefined);

  React.useLayoutEffect(() => {
    if (!open) return;
    const w = triggerRef.current?.getBoundingClientRect().width;
    if (w) setTriggerWidth(w);
  }, [open]);

  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-2 text-left text-[13px]",
            "focus:outline-none focus:ring-2 focus:ring-brand/40",
            !value && "text-muted-foreground",
            disabled && "cursor-not-allowed opacity-60",
            className,
          )}
        >
          <span className="truncate">{value || placeholder}</span>
          <ChevronDown
            className={cn(
              "ml-1 h-4 w-4 shrink-0 opacity-60 transition-transform",
              open && "rotate-180",
            )}
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        collisionPadding={8}
        style={triggerWidth ? { width: triggerWidth } : undefined}
        className="max-h-[240px] overflow-y-auto p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {options.length === 0 ? (
          <div className="px-3 py-2 text-[12px] text-muted-foreground">
            Немає варіантів
          </div>
        ) : (
          <ul className="py-1">
            {options.map((opt) => (
              <li key={opt}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(opt);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center px-3 py-2 text-left text-[13px] hover:bg-accent",
                    opt === value && "bg-accent font-semibold",
                  )}
                >
                  <span className="truncate">{opt}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
