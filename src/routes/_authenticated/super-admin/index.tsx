import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/super-admin/")({
  component: () => {
    const { hasRole, loading } = useAuth();
    if (loading) return null;
    if (!hasRole("super_admin")) return <Navigate to="/" />;
    return <Navigate to="/super-admin/users" />;
  },
});
