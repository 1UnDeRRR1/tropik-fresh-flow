import { Link, useRouterState } from "@tanstack/react-router";
import { Bell, Home, Package, Truck, BarChart3, Calendar, Settings } from "lucide-react";
import { Logo } from "./Logo";
import { useAuth, defaultRoutePerRole, ROLE_LABEL_UK } from "@/lib/auth";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
}

export function AppShell({ children }: { children: ReactNode }) {
  const { profile, primaryRole } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const dashHref = defaultRoutePerRole(primaryRole);

  const isBranch = primaryRole === "branch";
  const items: NavItem[] = isBranch
    ? [
        { to: dashHref, label: "Головна", icon: Home },
        { to: "/distribution", label: "Вільно", icon: Package },
        { to: "/transfers", label: "Трансфери", icon: BarChart3 },
        { to: "/settings", label: "Профіль", icon: Settings },
      ]
    : [
        { to: dashHref, label: "Головна", icon: Home },
        { to: "/shipments", label: "Поставки", icon: Package },
        { to: "/distribution", label: "Розподіл", icon: Truck },
        { to: "/analytics", label: "Аналітика", icon: BarChart3 },
        { to: "/calendar", label: "Календар", icon: Calendar },
        { to: "/settings", label: "Профіль", icon: Settings },
      ];

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 pt-safe">
          <Link to={dashHref} className="flex items-center gap-2">
            <Logo mark />
            <div className="flex flex-col leading-tight">
              <Logo className="text-sm" />
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Supply Distribution
              </span>
            </div>
          </Link>
          <Link
            to="/notifications"
            className="relative rounded-full p-2 text-foreground hover:bg-secondary"
            aria-label="Сповіщення"
          >
            <Bell className="h-5 w-5" />
          </Link>
        </div>
        {primaryRole && (
          <div className="mx-auto max-w-3xl px-4 pb-2 text-xs text-muted-foreground">
            {profile?.full_name ?? ""} · <span className="text-brand">{ROLE_LABEL_UK[primaryRole]}</span>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-28 pt-4">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-card/95 backdrop-blur pb-safe">
        <div className={cn("mx-auto grid max-w-3xl", items.length === 4 ? "grid-cols-4" : items.length === 6 ? "grid-cols-6" : "grid-cols-5")}>
          {items.map((it) => {
            const active =
              pathname === it.to ||
              (it.to !== "/" && pathname.startsWith(it.to)) ||
              (it.label === "Головна" && pathname.startsWith("/dashboard"));
            const Icon = it.icon;
            return (
              <Link
                key={it.to}
                to={it.to}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition",
                  active ? "text-brand" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className={cn("h-5 w-5", active && "stroke-[2.4]")} />
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
        <h1 className="text-2xl font-black tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
