import { Link } from "@tanstack/react-router";
import {
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Malekhiv-only bottom navigation: "limelight" indicator + compact tunnel.
 *
 * - Icons live inside a compact rounded tunnel; the tunnel itself is fixed
 *   by the parent <nav> in AppShell. Only icons scroll left/right.
 * - A 3px bar + soft conical glow slides over the active icon (limelight),
 *   measured via offsetLeft/offsetWidth after layout.
 * - Active tab auto-centers inside the tunnel.
 *
 * Icon set comes from the Ruixen limelight nav pack (extended) provided by
 * the user. Missing items (Package / Send) are drawn in the same stroke
 * style so the row stays visually cohesive.
 */

type IconProps = SVGProps<SVGSVGElement>;

const iconBaseProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const LLHomeIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <path d="m3 9 9-7 9 7" />
    <path d="M5 10v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10" />
    <path d="M9 22V12h6v10" />
  </svg>
);
const LLCalendarIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <path d="M8 2v4" />
    <path d="M16 2v4" />
    <rect width="18" height="18" x="3" y="4" rx="2" />
    <path d="M3 10h18" />
    <path d="M8 14h.01" />
    <path d="M12 14h.01" />
    <path d="M16 14h.01" />
    <path d="M8 18h.01" />
    <path d="M12 18h.01" />
  </svg>
);
const LLArchiveIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <rect width="20" height="5" x="2" y="3" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
    <path d="M10 12h4" />
  </svg>
);
const LLRequestsIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <path d="M9 3h6" />
    <path d="M10 3v3h4V3" />
    <rect width="14" height="18" x="5" y="3" rx="2" />
    <path d="M8 11h8" />
    <path d="M8 15h5" />
    <path d="M8 19h8" />
  </svg>
);
const LLProfileIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21a8 8 0 0 1 16 0" />
  </svg>
);
// Package — drawn in the same stroke style for "Вільно" / "Розподіл".
const LLPackageIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <path d="M16.5 9.4 7.55 4.24" />
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="M3.27 6.96 12 12.01l8.73-5.05" />
    <path d="M12 22.08V12" />
  </svg>
);
// Send — paper plane for "Переміщення".
const LLSendIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <path d="m22 2-7 20-4-9-9-4 20-7z" />
    <path d="M22 2 11 13" />
  </svg>
);

const ICON_BY_LABEL: Record<string, ComponentType<IconProps>> = {
  "Головна": LLHomeIcon,
  "Вільно": LLPackageIcon,
  "Розподіл": LLPackageIcon,
  "Про. ЗЕД": LLRequestsIcon,
  "Календар": LLCalendarIcon,
  "Переміщення": LLSendIcon,
  "Архів": LLArchiveIcon,
  "Профіль": LLProfileIcon,
};

export type MalekhivNavItem = {
  to: string;
  label: string;
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
    <div className="mx-auto w-full max-w-3xl px-2 py-1.5" data-malekhiv-bottom-nav="">
      {/* Compact tunnel: rounded bordered pill containing the scroller. */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card/80 backdrop-blur">
        <div
          ref={scrollerRef}
          className="overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [-webkit-overflow-scrolling:auto] [&::-webkit-scrollbar]:hidden"
        >
          <div className="relative mx-auto flex w-max items-stretch gap-1 px-2">
            {items.map((it, i) => {
              const Icon = ICON_BY_LABEL[it.label] ?? LLHomeIcon;
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
                    "relative z-20 flex w-[64px] shrink-0 flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium leading-tight tracking-tight transition-opacity duration-150",
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

            {/* Limelight: 3px bar on top + soft conical glow. */}
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
      </div>
    </div>
  );
}
