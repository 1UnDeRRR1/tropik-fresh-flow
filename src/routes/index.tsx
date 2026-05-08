import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth, defaultRoutePerRole } from "@/lib/auth";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { loading, user, primaryRole } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <Logo className="text-3xl animate-pulse" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;
  return <Navigate to={defaultRoutePerRole(primaryRole)} />;
}
// trigger
