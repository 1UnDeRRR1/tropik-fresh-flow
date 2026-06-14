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
 * LimelightNav — shared nav with the same limelight mechanism and visual
 * style as `MalekhivBottomNav.tsx`. Used for:
 *   - mobile bottom nav on ALL non-Malekhiv, non-owner roles
 *   - desktop top nav for ALL roles (including Malekhiv desktop)
 *
 * Malekhiv MOBILE nav itself remains `MalekhivBottomNav.tsx` (unchanged).
 *
 * Icons: the original 7 SVGs from `MalekhivBottomNav` are kept verbatim;
 * additional icons (Аналітика / Статистика / Логістика / Поставки /
 * Запропонувати / Супер / Головна SA / Розподіл / Налаштування) are drawn
 * in the SAME stroke style (24 viewBox, currentColor, round caps/joins,
 * 1.6–2 stroke width via `strokeWidth` prop) so the row stays cohesive.
 */

type IconProps = SVGProps<SVGSVGElement>;

const iconBaseProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

// === Existing Malekhiv set (verbatim) ===
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
const LLPackageIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <path d="M16.5 9.4 7.55 4.24" />
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="M3.27 6.96 12 12.01l8.73-5.05" />
    <path d="M12 22.08V12" />
  </svg>
);
const LLSendIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <path d="m22 2-7 20-4-9-9-4 20-7z" />
    <path d="M22 2 11 13" />
  </svg>
);

// === Extensions drawn in the same style ===
// Аналітика — bar chart.
const LLBarChartIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <path d="M3 21h18" />
    <rect x="5" y="13" width="3" height="7" rx="0.5" />
    <rect x="10.5" y="9" width="3" height="11" rx="0.5" />
    <rect x="16" y="5" width="3" height="15" rx="0.5" />
  </svg>
);
// Статистика — line chart.
const LLLineChartIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <path d="M3 3v18h18" />
    <path d="M7 15l4-4 3 3 5-7" />
  </svg>
);
// Логістика — route pin.
const LLRouteIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M6 8.5v3a4 4 0 0 0 4 4h2a4 4 0 0 1 4 4v0" />
  </svg>
);
// Поставки — truck.
const LLTruckIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <path d="M3 7h11v9H3z" />
    <path d="M14 10h4l3 3v3h-7z" />
    <circle cx="7" cy="18" r="2" />
    <circle cx="17" cy="18" r="2" />
  </svg>
);
// Запропонувати — megaphone.
const LLMegaphoneIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <path d="M3 11v2a1 1 0 0 0 1 1h2l6 4V6L6 10H4a1 1 0 0 0-1 1z" />
    <path d="M16 8a5 5 0 0 1 0 8" />
    <path d="M19 5a9 9 0 0 1 0 14" />
  </svg>
);
// Супер / Головна SA — shield.
const LLShieldIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3z" />
  </svg>
);
// Розподіл — split arrows (distribution).
const LLDistributeIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <path d="M12 4v6" />
    <path d="M12 10l-5 5" />
    <path d="M12 10l5 5" />
    <path d="M4 17h6" />
    <path d="M14 17h6" />
  </svg>
);
// Налаштування / fallback for Профіль alt — gear.
const LLGearIcon = (p: IconProps) => (
  <svg {...iconBaseProps} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

const ICON_BY_LABEL: Record<string, ComponentType<IconProps>> = {
  // Original Malekhiv mappings
  "Головна": LLHomeIcon,
  "Вільно": LLPackageIcon,
  "Розподіл": LLDistributeIcon,
  "Про. ЗЕД": LLRequestsIcon,
  "Календар": LLCalendarIcon,
  "Переміщення": LLSendIcon,
  "Архів": LLArchiveIcon,
  "Профіль": LLProfileIcon,
  // Extensions
  "Головна SA": LLShieldIcon,
  "Аналітика": LLBarChartIcon,
  "Статистика": LLLineChartIcon,
  "Логістика": LLRouteIcon,
  "Поставки": LLTruckIcon,
  "Запропонувати": LLMegaphoneIcon,
  "Супер": LLShieldIcon,
  "Налаштування": LLGearIcon,
};

export type LimelightNavItem = {
  to: string;
  label: string;
  badge?: number;
};

interface Props {
  items: LimelightNavItem[];
  isActive: (to: string, label: string) => boolean;
  variant?: "mobile" | "desktop";
}

export function LimelightNav({ items, isActive, variant = "mobile" }: Props) {
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

  const isDesktop = variant === "desktop";

  return (
    <div className={cn("w-full", isDesktop ? "py-1" : "mx-auto max-w-3xl px-2 py-1.5")}>
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-border bg-card/80 backdrop-blur",
        )}
      >
        <div
          ref={scrollerRef}
          className="overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [-webkit-overflow-scrolling:auto] [&::-webkit-scrollbar]:hidden"
        >
          <div
            className={cn(
              "relative mx-auto flex w-max items-stretch gap-1",
              isDesktop ? "px-1.5" : "px-2",
            )}
          >
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
                    "relative z-20 shrink-0 transition-opacity duration-150",
                    isDesktop
                      ? "flex w-[88px] flex-col items-center justify-center gap-1 px-2 py-2 text-xs font-semibold"
                      : "flex w-[64px] flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium leading-tight tracking-tight",
                    active
                      ? "text-foreground opacity-100"
                      : "text-muted-foreground opacity-60 hover:opacity-100",
                  )}
                >
                  <span className="relative inline-flex">
                    <Icon
                      className={isDesktop ? "h-8 w-8" : "h-[22px] w-[22px]"}
                      strokeWidth={active ? 2 : 1.6}
                      aria-hidden="true"
                    />
                    {it.badge && it.badge > 0 ? (
                      <span className="absolute -right-2 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground">
                        {it.badge > 99 ? "99+" : it.badge}
                      </span>
                    ) : null}
                  </span>
                  <span className="whitespace-nowrap text-[11px] leading-tight">{it.label}</span>
                </Link>
              );
            })}

            {/* Limelight: 3px bar + soft conical glow. */}
            <div
              ref={limelightRef}
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute top-0 z-10 h-[3px] rounded-full bg-foreground/85 shadow-[0_24px_18px_-4px_hsl(var(--foreground)/0.35)]",
                isDesktop ? "w-12" : "w-10",
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
