import { createFileRoute, Outlet, Navigate, Link, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { APP_SPLASH_ASSETS } from "@/lib/branch-assets";
import { translateError } from "@/lib/mutation-helpers";
import { initAliasCache } from "@/lib/alias-cache";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
  errorComponent: AuthErrorBoundary,
  notFoundComponent: AuthNotFound,
});

function SplashScreen() {
  return (
    <div className="fixed inset-0 z-50 flex h-dvh w-screen items-center justify-center overflow-hidden bg-background">
      <picture>
        <source media="(max-width: 767px)" type="image/webp" srcSet={APP_SPLASH_ASSETS.mobileWebp} />
        <source media="(max-width: 767px)" type="image/png" srcSet={APP_SPLASH_ASSETS.mobilePng} />
        <source media="(min-width: 768px)" type="image/webp" srcSet={APP_SPLASH_ASSETS.desktopWebp} />
        <source media="(min-width: 768px)" type="image/png" srcSet={APP_SPLASH_ASSETS.desktopPng} />
        <img
          src={APP_SPLASH_ASSETS.desktopPng}
          alt=""
          className="h-full w-full object-cover"
          loading="eager"
          decoding="async"
          draggable={false}
        />
      </picture>
    </div>
  );
}

function AuthenticatedLayout() {
  const { user, loading, dataLoaded } = useAuth();
  // Phase 0 — warm DB-backed alias cache once auth is established.
  useEffect(() => { if (user) initAliasCache(); }, [user]);
  if (loading) return <SplashScreen />;
  if (!user && !dataLoaded) return <SplashScreen />;
  if (!user) return <Navigate to="/login" />;
  // External calendar accounts intentionally disabled — fall through to main shell.
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
