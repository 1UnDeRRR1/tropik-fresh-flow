import { createFileRoute, Outlet, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-6">
        <div className="flex flex-col items-center gap-4">
          <Logo size={220} className="animate-pulse" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.25em] text-muted-foreground">
            Supply Distribution
          </span>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
