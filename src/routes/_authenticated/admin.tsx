import { createFileRoute, Outlet, Link, useRouterState, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

const TABS = [
  { to: "/admin/branches", label: "Філії" },
  { to: "/admin/managers", label: "Менеджери" },
  { to: "/admin/suppliers", label: "Постачальники" },
  { to: "/admin/products", label: "Товари" },
  { to: "/admin/loading-plan", label: "План" },
  { to: "/admin/countries", label: "Логістика" },
  { to: "/admin/customs", label: "Митниця" },
  { to: "/admin/qa", label: "QA" },
] as const;

function AdminLayout() {
  const { hasRole, loading } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (loading) return null;
  if (!hasRole(["admin", "super_admin"])) return <Navigate to="/" />;
  return (
    <div className="space-y-4">
      <div className="-mx-4 overflow-x-auto px-4">
        <div className="flex gap-2 pb-1">
          {TABS.map((t) => {
            const active = pathname.startsWith(t.to);
            return (
              <Link
                key={t.to}
                to={t.to}
                className={cn(
                  "shrink-0 rounded-full border px-4 py-2 text-xs font-semibold transition",
                  active
                    ? "border-brand bg-brand text-brand-foreground"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
      <Outlet />
    </div>
  );
}
