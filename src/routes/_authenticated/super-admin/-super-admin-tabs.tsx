import { Link, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const SUPER_ADMIN_TABS = [
  { to: "/super-admin/users", label: "Користувачі" },
  { to: "/super-admin/activity", label: "Журнал активності" },
  { to: "/super-admin/logs", label: "Системні логи" },
] as const;

export function SuperAdminTabs() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <div className="flex gap-2 pb-1">
        {SUPER_ADMIN_TABS.map((tab) => {
          const active = pathname.startsWith(tab.to);

          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                "shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition",
                active
                  ? "border-brand bg-brand text-brand-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}