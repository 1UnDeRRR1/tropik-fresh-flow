import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Home, Package, Truck, BarChart3, Calendar, Settings, Send, LineChart, Database, Megaphone, Inbox, CalendarDays, Shield, Route as RouteIcon, Archive } from "lucide-react";
import logoSrc from "@/assets/tropik-logo.png";
import { useAuth, defaultRoutePerRole, ROLE_LABEL_UK } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { FxRateBadge } from "@/components/FxRateBadge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, type ReactNode } from "react";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  badge?: number;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, primaryRole, hasRole } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const dashHref = defaultRoutePerRole(primaryRole);

  const isBranch = primaryRole === "branch";
  const isAdmin = hasRole(["admin", "super_admin"]);
  const isSuper = hasRole("super_admin");
  const isManager = primaryRole === "import_manager";
  const isLogisticsRole = primaryRole === "logistics";
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
    queryKey: ["nav-pending-manager-responses", userId],
    enabled: (isManager || isAdmin) && !!userId,
    queryFn: async () => {
      const { data: offers } = await (supabase as any)
        .from("manager_offers")
        .select("id")
        .eq("created_by", userId!)
        .eq("status", "active");
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

  const items: NavItem[] = isBranch
    ? [
        { to: dashHref, label: "Головна", icon: Home },
        { to: "/distribution", label: "Вільно", icon: Package },
        { to: "/branch-offers", label: "Про. ЗЕД", icon: Inbox },
        { to: "/branch-calendar", label: "Календар", icon: CalendarDays },
        { to: "/offers", label: "Переказ", icon: Send, badge: pendingOffers },
        { to: "/archive", label: "Архів", icon: Archive },
        { to: "/settings", label: "Профіль", icon: Settings },
      ]
    : isLogisticsRole
    ? [
        { to: "/logistics", label: "Логістика", icon: RouteIcon },
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
        ...(isAdmin ? [{ to: "/master-data", label: "Master", icon: Database }] : []),
        ...(isSuper ? [{ to: "/super-admin", label: "Супер", icon: Shield }] : []),
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

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <div className="relative mx-auto flex h-16 w-full max-w-[1600px] items-center justify-between gap-3 px-4 pt-safe md:px-6 lg:px-10">
          <div className="flex items-center gap-3 lg:gap-4">
            <Link to={dashHref} aria-label="TROPIK" className="flex items-center">
              <span className="logo-shimmer">
                <img
                  src={logoSrc}
                  alt="TROPIK Ukraine — Fruit, Vegetables, Import, Export"
                  className="h-14 w-auto max-h-full object-contain md:h-16"
                  draggable={false}
                />
              </span>
            </Link>
            {/* Top nav for tablet/desktop */}
            <nav className="hidden md:flex md:items-center md:gap-1 lg:gap-2">
              {items.map((it) => {
                const active = isActive(it.to, it.label);
                const Icon = it.icon;
                return (
                  <Link
                    key={it.to}
                    to={it.to}
                    className={cn(
                      "relative inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition lg:text-sm",
                      active
                        ? "bg-secondary text-brand"
                        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                    )}
                  >
                    <span className="relative">
                      <Icon className={cn("h-4 w-4", active && "stroke-[2.4]")} />
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
          {!isBranch && (
            <div className="pointer-events-none absolute bottom-1 left-1/2 -translate-x-1/2">
              <div className="pointer-events-auto">
                <FxRateBadge />
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            {primaryRole && (
              <div className="text-right leading-tight">
                <div className="text-sm font-semibold text-foreground">
                  {profile?.full_name ?? ""}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {ROLE_LABEL_UK[primaryRole]}
                </div>
              </div>
            )}
            <Link
              to="/notifications"
              className="relative rounded-full p-2 text-foreground hover:bg-secondary"
              aria-label="Сповіщення"
            >
              <Bell className="h-5 w-5" />
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4 md:max-w-[1600px] md:px-6 md:pb-10 lg:px-10">
        {children}
      </main>

      {/* Bottom nav: mobile only */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur pb-safe md:hidden">
        <div className={cn("mx-auto grid max-w-3xl", items.length === 4 ? "grid-cols-4" : items.length === 6 ? "grid-cols-6" : items.length === 7 ? "grid-cols-7" : "grid-cols-5")}>
          {items.map((it) => {
            const active = isActive(it.to, it.label);
            const Icon = it.icon;
            return (
              <Link
                key={it.to}
                to={it.to}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition",
                  active ? "text-brand" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="relative">
                  <Icon className={cn("h-5 w-5", active && "stroke-[2.4]")} />
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
