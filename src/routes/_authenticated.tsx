import { createFileRoute, Outlet, Navigate, Link, useRouter } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { Logo } from "@/components/Logo";
import { translateError } from "@/lib/mutation-helpers";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
  errorComponent: AuthErrorBoundary,
  notFoundComponent: AuthNotFound,
});

function AuthenticatedLayout() {
  const { user, loading, dataLoaded } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-6">
        <div className="flex flex-col items-center gap-4">
          <Logo size={220} className="animate-pulse" />
        </div>
      </div>
    );
  }
  // Never redirect to /login until the auth/session restore path has finished,
  // otherwise iPhone orientation changes can briefly bounce authenticated users.
  if (!user && !dataLoaded) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-6">
        <div className="flex flex-col items-center gap-4">
          <Logo size={220} className="animate-pulse" />
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

function AuthErrorBoundary({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h2 className="text-lg font-semibold text-foreground">Не вдалося завантажити розділ</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{translateError(error)}</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Спробувати ще
        </button>
        <Link
          to="/"
          className="inline-flex items-center justify-center rounded-xl border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
        >
          На головну
        </Link>
      </div>
    </div>
  );
}

function AuthNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h2 className="text-lg font-semibold text-foreground">Розділ не знайдено</h2>
      <p className="mt-2 text-sm text-muted-foreground">Перевірте адресу або поверніться на головну.</p>
      <Link
        to="/"
        className="mt-4 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        На головну
      </Link>
    </div>
  );
}
