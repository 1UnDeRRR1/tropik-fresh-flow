import { cn } from "@/lib/utils";

export type BoardView = "active" | "unloaded";

export function MainBoardToggle({
  value,
  onChange,
  className,
}: {
  value: BoardView;
  onChange: (v: BoardView) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="Перемикач табло"
      className={cn(
        "relative z-10 grid w-full max-w-sm grid-cols-2 rounded-xl border border-border bg-muted/70 p-1 text-xs",
        className,
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === "active"}
        aria-pressed={value === "active"}
        onClick={() => onChange("active")}
        className={cn(
          "flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 font-semibold transition touch-manipulation select-none",
          value === "active"
            ? "bg-card text-foreground shadow-sm ring-1 ring-border"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "h-2 w-2 rounded-full transition",
            value === "active" ? "bg-brand" : "bg-border",
          )}
          aria-hidden="true"
        />
        Активні
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === "unloaded"}
        aria-pressed={value === "unloaded"}
        onClick={() => onChange("unloaded")}
        className={cn(
          "flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 font-semibold transition touch-manipulation select-none",
          value === "unloaded"
            ? "bg-card text-foreground shadow-sm ring-1 ring-border"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        <span
          className={cn(
            "h-2 w-2 rounded-full transition",
            value === "unloaded" ? "bg-brand" : "bg-border",
          )}
          aria-hidden="true"
        />
        Розвантажено
      </button>
    </div>
  );
}
