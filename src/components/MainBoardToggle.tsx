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
    <div className={cn("inline-flex rounded-full border border-border bg-card p-1 text-xs", className)}>
      <button
        type="button"
        onClick={() => onChange("active")}
        className={cn(
          "rounded-full px-3 py-1.5 font-semibold transition",
          value === "active"
            ? "bg-brand text-brand-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Активні
      </button>
      <button
        type="button"
        onClick={() => onChange("unloaded")}
        className={cn(
          "rounded-full px-3 py-1.5 font-semibold transition",
          value === "unloaded"
            ? "bg-brand text-brand-foreground"
            : "text-muted-foreground hover:text-foreground",
        )}
      >
        Розвантажено
      </button>
    </div>
  );
}
