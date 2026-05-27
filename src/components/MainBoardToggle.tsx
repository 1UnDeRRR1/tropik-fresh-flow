import { cn } from "@/lib/utils";

export type BoardView = "active" | "unloaded" | "summary";

const OPTIONS: { value: BoardView; label: string }[] = [
  { value: "active", label: "Активні" },
  { value: "unloaded", label: "Розвантажено" },
  { value: "summary", label: "Підсумок" },
];

export function MainBoardToggle({
  value,
  onChange,
  className,
  showSummary = false,
}: {
  value: BoardView;
  onChange: (v: BoardView) => void;
  className?: string;
  showSummary?: boolean;
}) {
  const opts = showSummary ? OPTIONS : OPTIONS.filter((o) => o.value !== "summary");
  return (
    <div
      role="tablist"
      aria-label="Перемикач табло"
      className={cn(
        "relative z-10 grid w-full max-w-md rounded-xl border border-border bg-muted/70 p-1 text-xs",
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${opts.length}, minmax(0, 1fr))` }}
    >
      {opts.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 font-medium transition touch-manipulation select-none",
              active
                ? "bg-card/60 text-foreground border border-destructive shadow-sm"
                : "border border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full transition",
                active ? "bg-brand" : "bg-border",
              )}
              aria-hidden="true"
            />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
