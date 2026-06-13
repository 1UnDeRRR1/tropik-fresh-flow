import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef, useState, type ComponentType, type SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Malekhiv-only bottom navigation with a "limelight" indicator.
 *
 * The mechanic mirrors the reference component from
 * `ruixen-limelight-nav-files.zip` (`limelight-nav.tsx`):
 *  - measure the active item with `offsetLeft / offsetWidth` after layout,
 *  - move a 3px bar + soft conical glow to that x position,
 *  - keep the same DOM-measurement approach, just adapted to a horizontally
 *    scrollable container that centers the active tab on change.
 *
 * The outer fixed wrapper (with auto-hide / safe-area / reveal-handle) lives
 * in AppShell and is unchanged — this component renders only the inner row.
 */
export type MalekhivNavItem = {
  to: string;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  badge?: number;
};

interface Props {
  items: MalekhivNavItem[];
  isActive: (to: string, label: string) => boolean;
}

export function MalekhivBottomNav({ items, isActive }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const limelightRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  let activeIdx = items.findIndex((it) => isActive(it.to, it.label));
  if (activeIdx < 0) activeIdx = 0;

  useLayoutEffect(() => {
    const el = itemRefs.current[activeIdx];
    const limelight = limelightRef.current;
    const scroller = scrollerRef.current;
    if (!el || !limelight) return;

    const left = el.offsetLeft + el.offsetWidth / 2 - limelight.offsetWidth / 2;
    limelight.style.left = `${left}px`;

    if (scroller) {
      const target = el.offsetLeft - (scroller.clientWidth - el.offsetWidth) / 2;
      scroller.scrollTo({
        left: Math.max(0, target),
        behavior: ready ? "smooth" : "auto",
      });
    }

    if (!ready) {
      const t = window.setTimeout(() => setReady(true), 60);
      return () => window.clearTimeout(t);
    }
  }, [activeIdx, items.length, ready]);

  return (
    <div
      ref={scrollerRef}
      className="overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [-webkit-overflow-scrolling:auto] [&::-webkit-scrollbar]:hidden"
    >
      <div className="relative mx-auto flex w-max items-stretch gap-1 px-2">
        {items.map((it, i) => {
          const Icon = it.Icon;
          const active = i === activeIdx;
          return (
            <Link
              key={it.to}
              to={it.to}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative z-20 flex w-[68px] shrink-0 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium leading-tight tracking-tight transition-opacity duration-150",
                active
                  ? "text-foreground opacity-100"
                  : "text-muted-foreground opacity-60 hover:opacity-100",
              )}
            >
              <span className="relative">
                <Icon
                  className="h-[22px] w-[22px]"
                  strokeWidth={active ? 2 : 1.6}
                  aria-hidden="true"
                />
                {it.badge && it.badge > 0 ? (
                  <span className="absolute -right-2 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground">
                    {it.badge > 99 ? "99+" : it.badge}
                  </span>
                ) : null}
              </span>
              <span className="whitespace-nowrap">{it.label}</span>
            </Link>
          );
        })}

        {/* Limelight: 3px bar on top of the active tab + soft conical glow. */}
        <div
          ref={limelightRef}
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-0 z-10 h-[3px] w-10 rounded-full bg-foreground/85 shadow-[0_24px_18px_-4px_hsl(var(--foreground)/0.35)]",
            ready ? "transition-[left] duration-[400ms] ease-out" : "",
          )}
          style={{ left: "-999px" }}
        >
          <div className="pointer-events-none absolute left-[-30%] top-[3px] h-12 w-[160%] bg-gradient-to-b from-foreground/25 to-transparent [clip-path:polygon(5%_100%,25%_0,75%_0,95%_100%)]" />
        </div>
      </div>
    </div>
  );
}
