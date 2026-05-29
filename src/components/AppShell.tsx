import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Package, Truck, BarChart3, Calendar, Settings, Send, LineChart, Megaphone, Inbox, CalendarDays, Shield, Route as RouteIcon, Archive } from "lucide-react";
import { FruitIcon, labelToFruit } from "@/components/FruitIcon";
import { useAuth, defaultRoutePerRole } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { FxRateBadge } from "@/components/FxRateBadge";
import { getPersonalAssets } from "@/lib/branch-assets";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, type ReactNode } from "react";
import { useKeyboardInset } from "@/hooks/useKeyboardInset";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  badge?: number;
}

export function AppShell({ children }: { children: ReactNode }) {
  useKeyboardInset();
  const { profile, primaryRole, hasRole } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const dashHref = defaultRoutePerRole(primaryRole);

  const isBranch = primaryRole === "branch";
  const isAdmin = hasRole(["admin", "super_admin"]);
  const isSuper = hasRole("super_admin");
  const isManager = primaryRole === "import_manager";
  const isLogisticsRole = primaryRole === "logistics";
  const isOwner = primaryRole === "owner";
  const canSeeLogistics = isAdmin || isManager || hasRole("logistics");

  const branchId = profile?.branch_id ?? null;
  const userId = profile?.id ?? null;
  const qc = useQueryClient();
  const { data: pendingOffers = 0 } = useQuery({
    queryKey: ["nav-pending-incoming-offers", branchId],
    enabled: isBranch && !!branchId,
    queryFn: async () => {
      const { count } = await (supabase as any)
        .from("branch_transfer_offers")
        .select("id", { count: "exact", head: true })
        .eq("to_branch_id", branchId!)
        .eq("status", "pending");
      return count ?? 0;
    },
    refetchInterval: 30000,
  });

  const { data: pendingManagerResponses = 0 } = useQuery({
    queryKey: ["nav-pending-manager-responses", userId, isAdmin],
    enabled: (isManager || isAdmin) && !!userId,
    queryFn: async () => {
      let q = (supabase as any)
        .from("manager_offers")
        .select("id")
        .in("status", ["active", "in_work", "confirmed"]);
      if (!isAdmin) q = q.eq("created_by", userId!);
      const { data: offers } = await q;
      const ids = (offers ?? []).map((o: any) => o.id);
      if (!ids.length) return 0;
      const { count } = await (supabase as any)
        .from("manager_offer_responses")
        .select("id", { count: "exact", head: true })
        .in("offer_id", ids)
        .is("approved_pallets", null);
      return count ?? 0;
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (!isBranch || !branchId) return;
    const ch = supabase
      .channel(`bto-nav-${branchId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "branch_transfer_offers", filter: `to_branch_id=eq.${branchId}` },
        () => {
          qc.invalidateQueries({ queryKey: ["nav-pending-incoming-offers", branchId] });
          qc.invalidateQueries({ queryKey: ["offers"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [isBranch, branchId, qc]);

  useEffect(() => {
    if (!(isManager || isAdmin) || !userId) return;
    const ch = supabase
      .channel(`mor-nav-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "manager_offer_responses" },
        () => {
          qc.invalidateQueries({ queryKey: ["nav-pending-manager-responses", userId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [isManager, isAdmin, userId, qc]);

  // Global shipments realtime: keep status across all sections (manager offers,
  // branches, dashboards, shipments list) in sync without page reload.
  useEffect(() => {
    if (!userId) return;
    const ch = supabase
      .channel(`shipments-global-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shipments" },
        () => {
          const keys = [
            ["shipments-list"],
            ["manager-offers"],
            ["manager-offer-linked-shipments"],
            ["manager-offer-targets"],
            ["shipments-link-options"],
            ["branch-requests-full"],
            ["branch-free"],
            ["branch-incoming-ships-v3"],
            ["branch-incoming-dists"],
            ["branch-offer-shipments"],
            ["branch-active-offers"],
            ["offers"],
            ["offers-ships"],
            ["dash-manager"],
            ["dash-admin"],
            ["dash-branch"],
            ["logistics-rows"],
          ];
          for (const key of keys) qc.invalidateQueries({ queryKey: key });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, qc]);

  const items: NavItem[] = isOwner
    ? [
        { to: "/owner/calendar", label: "Календар", icon: Calendar },
        { to: "/owner/analytics", label: "Аналітика", icon: BarChart3 },
        { to: "/owner/statistics", label: "Статистика", icon: LineChart },
        { to: "/settings", label: "Профіль", icon: Settings },
      ]
    : isBranch
    ? [
        { to: dashHref, label: "Головна", icon: Home },
        { to: "/distribution", label: "Вільно", icon: Package },
        { to: "/branch-offers", label: "Про. ЗЕД", icon: Inbox },
        { to: "/branch-calendar", label: "Календар", icon: CalendarDays },
        { to: "/offers", label: "Переміщення", icon: Send, badge: pendingOffers },
        { to: "/archive", label: "Архів", icon: Archive },
        { to: "/settings", label: "Профіль", icon: Settings },
      ]
    : isLogisticsRole
    ? [
        { to: "/logistics", label: "Логістика", icon: RouteIcon },
        { to: "/archive", label: "Архів", icon: Archive },
        { to: "/settings", label: "Профіль", icon: Settings },
      ]
    : [
        ...(isSuper
          ? [
              { to: "/dashboard/super-admin", label: "Головна SA", icon: Shield },
              { to: "/dashboard/admin", label: "Головна", icon: Home },
            ]
          : [{ to: dashHref, label: "Головна", icon: Home }]),
        { to: "/shipments", label: "Поставки", icon: Package },
        ...(canSeeLogistics ? [{ to: "/logistics", label: "Логістика", icon: RouteIcon }] : []),
        ...(isAdmin ? [] : [{ to: "/distribution", label: "Розподіл", icon: Truck }]),
        ...(isManager || isAdmin
          ? [{ to: "/manager-offers", label: "Запропонувати", icon: Megaphone, badge: pendingManagerResponses }]
          : []),
        { to: "/analytics", label: "Аналітика", icon: BarChart3 },
        ...(isAdmin ? [{ to: "/statistics", label: "Статистика", icon: LineChart }] : []),
        { to: "/calendar", label: "Календар", icon: Calendar },
        
        ...(isSuper ? [{ to: "/super-admin", label: "Супер", icon: Shield }] : []),
        { to: "/archive", label: "Архів", icon: Archive },
        { to: "/settings", label: "Профіль", icon: Settings },
      ];

  const isActive = (to: string, label: string) => {
    if (label === "Головна SA") return pathname === "/dashboard/super-admin";
    if (label === "Головна" && isSuper) return pathname === "/dashboard/admin";
    return (
      pathname === to ||
      (to !== "/" && pathname.startsWith(to)) ||
      (label === "Головна" && pathname.startsWith("/dashboard"))
    );
  };

  const displayName = profile?.display_name ?? profile?.full_name ?? "";
  const showRedT = profile?.visual_mark === "red_tereshchenko_t" && displayName.length > 0;

  // Personal asset package, keyed by user_id (then branch_id). Returns null
  // for users without a package — they get neutral chrome, never another
  // user's branding.
  const personalAssets = getPersonalAssets(profile?.id, profile?.branch_id);

  return (
    <div className="relative min-h-dvh">
      {/* Global decorative background lives on <body> (see styles.css). */}
      <header className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/70">
        {personalAssets?.headerDesktopWebp ? (
          /* Full-bleed personal header banner — only for users with a package.
             width/height attributes on each <source> + <img> let the browser
             reserve the correct aspect-ratio box before the image decodes,
             so the header never pops in late and shoves nav down. */
          <div className="relative w-full pt-safe">
            <picture>
              <source
                media="(max-width: 767px)"
                type="image/webp"
                srcSet={personalAssets.headerMobileWebp}
                width={personalAssets.headerMobileWidth}
                height={personalAssets.headerMobileHeight}
              />
              <source
                media="(max-width: 767px)"
                type="image/png"
                srcSet={personalAssets.headerMobilePng}
                width={personalAssets.headerMobileWidth}
                height={personalAssets.headerMobileHeight}
              />
              <source
                media="(min-width: 768px)"
                type="image/webp"
                srcSet={personalAssets.headerDesktopWebp}
                width={personalAssets.headerDesktopWidth}
                height={personalAssets.headerDesktopHeight}
              />
              <source
                media="(min-width: 768px)"
                type="image/png"
                srcSet={personalAssets.headerDesktopPng}
                width={personalAssets.headerDesktopWidth}
                height={personalAssets.headerDesktopHeight}
              />
              <img
                src={personalAssets.headerDesktopPng}
                width={personalAssets.headerDesktopWidth}
                height={personalAssets.headerDesktopHeight}
                alt=""
                className="block h-auto w-full"
                loading="eager"
                decoding="async"
                draggable={false}
              />
            </picture>
            {primaryRole && displayName && (
              <div className="pointer-events-none absolute right-3 top-3 max-w-[60%] text-right leading-tight md:right-6 md:top-5">
                <div className="text-base font-extrabold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)] md:text-2xl">
                  {showRedT ? (
                    <>
                      <span className="text-red-500">{displayName.charAt(0)}</span>
                      {displayName.slice(1)}
                    </>
                  ) : (
                    displayName
                  )}
                </div>
                {profile?.job_title && (
                  <div className="mt-0.5 text-[0.65rem] font-semibold text-white/95 drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)] md:text-sm">
                    {profile.job_title}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* Neutral chrome — no personal package installed for this user */
          <div className="flex items-center justify-between gap-3 px-4 py-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] md:px-6">
            <Link to={dashHref} className="text-sm font-bold tracking-tight text-foreground">
              Tropik
            </Link>
            {primaryRole && displayName && (
              <div className="truncate text-right text-sm font-semibold text-foreground">
                {showRedT ? (
                  <>
                    <span className="text-red-500">{displayName.charAt(0)}</span>
                    {displayName.slice(1)}
                  </>
                ) : (
                  displayName
                )}
              </div>
            )}
          </div>
        )}
        {/* FX badge: thin strip below header, outside the picture, non-branch only */}
        {!isBranch && (
          <div className="flex justify-center border-t border-border/60 bg-card/70 px-4 py-1">
            <FxRateBadge />
          </div>
        )}
        {/* Top nav for tablet/desktop */}
        <div className="mx-auto w-full max-w-[1600px] px-4 md:px-6 lg:px-10">
          <nav className="hidden md:flex md:items-center md:gap-1 md:py-2 lg:gap-2">
            {items.map((it) => {
              const active = isActive(it.to, it.label);
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  className={cn(
                    "fruit-tap relative inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition lg:text-sm",
                    active
                      ? "bg-secondary text-brand fruit-active"
                      : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  <span className="relative">
                    <FruitIcon name={labelToFruit(it.label)} className="h-5 w-5 text-[18px]" />
                    {it.badge && it.badge > 0 ? (
                      <span className="absolute -right-2 -top-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground">
                        {it.badge > 99 ? "99+" : it.badge}
                      </span>
                    ) : null}
                  </span>
                  <span>{it.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      </header>


      <main className="relative z-10 mx-auto w-full max-w-3xl px-4 pb-28 pt-4 md:max-w-[1600px] md:px-6 md:pb-10 lg:px-10">
        {children}
      </main>

      {/* Bottom nav: mobile only */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur pb-safe md:hidden">
        {isBranch ? (
          <div className={cn("mx-auto grid max-w-3xl", items.length === 4 ? "grid-cols-4" : items.length === 6 ? "grid-cols-6" : items.length === 7 ? "grid-cols-7" : "grid-cols-5")}>
            {items.map((it) => {
              const active = isActive(it.to, it.label);
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  className={cn(
                    "fruit-tap relative flex flex-col items-center justify-center py-1 text-[10px] font-medium leading-tight transition",
                    active ? "text-brand fruit-active" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="relative">
                    <FruitIcon name={labelToFruit(it.label)} className="h-9 w-9 text-[30px]" />
                    {it.badge && it.badge > 0 ? (
                      <span className="absolute -right-2 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[9px] font-bold leading-none text-destructive-foreground">
                        {it.badge > 99 ? "99+" : it.badge}
                      </span>
                    ) : null}
                  </span>
                  <span>{it.label}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [-webkit-overflow-scrolling:auto] [&::-webkit-scrollbar]:hidden">
            <div className="flex w-max gap-1 px-2">
              {items.map((it) => {
                const active = isActive(it.to, it.label);
                return (
                  <Link
                    key={it.to}
                    to={it.to}
                    className={cn(
                      "fruit-tap relative flex w-[64px] shrink-0 flex-col items-center justify-center py-1 text-[10px] font-medium leading-tight transition",
                      active ? "text-brand fruit-active" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span className="relative">
                      <FruitIcon name={labelToFruit(it.label)} className="h-9 w-9 text-[30px]" />
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
            </div>
          </div>
        )}
      </nav>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-black tracking-tight md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
