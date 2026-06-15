import { cn } from "@/lib/utils";

/**
 * Уніфіковане відображення собівартості:
 * зелена індикативна / червона інвойсна. Завжди обидві.
 */
export function CostPair({
  indicative,
  invoice,
  suffix = "",
  prefix = "$",
  className,
  size = "sm",
}: {
  indicative: number | null | undefined;
  invoice: number | null | undefined;
  suffix?: string;
  prefix?: string;
  className?: string;
  size?: "xs" | "sm" | "md";
}) {
  const ind = Number(indicative ?? 0).toFixed(2);
  const inv = Number(invoice ?? 0).toFixed(2);
  const sizeCls = size === "xs" ? "text-[10px]" : size === "md" ? "text-sm" : "text-xs";
  return (
    <span className={cn("whitespace-nowrap font-bold tabular-nums num-soft", sizeCls, className)}>
      <span className="text-success">{prefix}{ind}{suffix}</span>
      <span className="text-muted-foreground font-normal"> / </span>
      <span className="text-destructive">{prefix}{inv}{suffix}</span>
    </span>
  );
}
