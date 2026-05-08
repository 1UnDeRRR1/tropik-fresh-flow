import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth, defaultRoutePerRole } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/")({
  component: () => {
    const { primaryRole } = useAuth();
    return <Navigate to={defaultRoutePerRole(primaryRole)} />;
  },
});
