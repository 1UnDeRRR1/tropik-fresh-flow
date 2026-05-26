import { createFileRoute, Outlet, Navigate, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { getPersonalAssets } from "@/lib/branch-assets";
import { translateError } from "@/lib/mutation-helpers";
import { initAliasCache } from "@/lib/alias-cache";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
  errorComponent: AuthErrorBoundary,
  notFoundComponent: AuthNotFound,
});

/**
 * Splash shown while auth state is hydrating. If the user has a personal
 * asset package, render their full-bleed splash. Otherwise show a neutral
 * spinner — never the old Tropik logo card.
 */
function SplashScreen({ userId, branchId }: { userId?: string | null; branchId?: string | null }) {
  // SSR and the very first client render MUST produce identical HTML — render
  // the neutral spinner unconditionally on both. After hydration we flip to the
  // personal full-bleed splash if a package is resolved. This prevents the
  // hydration mismatch (React minified error #418) that previously discarded
  // the splash subtree and let AppShell flash through during reload.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  const personal = mounted ? getPersonalAssets(userId, branchId) : null;
  if (!personal) {
    return (
      <div className="fixed inset-0 z-50 flex h-dvh w-screen items-center justify-center bg-background">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-muted border-t-foreground" />
      </div>
    );
  }
  return (
    <div className="fixed inset-0 z-50 h-dvh w-screen overflow-hidden bg-background">
      <picture>
        <source media="(max-width: 767px)" type="image/webp" srcSet={personal.splashMobileWebp} />
        <source media="(max-width: 767px)" type="image/png" srcSet={personal.splashMobilePng} />
        <source media="(min-width: 768px)" type="image/webp" srcSet={personal.splashDesktopWebp} />
        <source media="(min-width: 768px)" type="image/png" srcSet={personal.splashDesktopPng} />
        <img
          src={personal.splashDesktopPng}
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
  const { user, profile, loading, dataLoaded } = useAuth();
  // Phase 0 — warm DB-backed alias cache once auth is established.
  useEffect(() => { if (user) initAliasCache(); }, [user]);
  // Show splash while auth is hydrating OR while a known user's profile/roles
  // are still loading. This prevents the empty "Поки немає підтвердженого
  // товару" flash on branch pages during reload, when cached session restores
  // instantly but profile/branch_id arrive a tick later.
  if (loading || (user && !dataLoaded)) {
    return <SplashScreen userId={user?.id} branchId={profile?.branch_id} />;
  }
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
