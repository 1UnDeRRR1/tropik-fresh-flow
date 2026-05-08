import { cn } from "@/lib/utils";

export function Logo({ className, mark = false }: { className?: string; mark?: boolean }) {
  if (mark) {
    return (
      <div
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground",
          className,
        )}
      >
        <span className="text-base font-black tracking-tight">T</span>
        <span className="-ml-0.5 mb-2 h-1.5 w-1.5 rounded-full bg-brand" />
      </div>
    );
  }
  return (
    <div className={cn("inline-flex items-baseline gap-0.5 font-black tracking-tight", className)}>
      <span>TROP</span>
      <span className="relative">
        I
        <span className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-brand" />
      </span>
      <span>K</span>
    </div>
  );
}
