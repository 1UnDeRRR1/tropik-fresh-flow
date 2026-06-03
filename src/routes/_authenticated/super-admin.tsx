import { createFileRoute, Outlet, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { SuperAdminTabs } from "./super-admin/-super-admin-tabs";

export const Route = createFileRoute("/_authenticated/super-admin")({
  component: SuperAdminLayout,
});

function SuperAdminLayout() {
  const { hasRole, loading } = useAuth();
  if (loading) return null;
  if (!hasRole("super_admin")) return <Navigate to="/" />;
  return (
    <div className="space-y-4">
      <SuperAdminTabs />
      <Outlet />
    </div>
  );
}
