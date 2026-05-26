import { createFileRoute, Outlet, Navigate, Link, useRouter } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { getPersonalAssets, type PersonalAssets } from "@/lib/branch-assets";
import { getLastUserId } from "@/lib/last-user";
import { translateError } from "@/lib/mutation-helpers";
import { initAliasCache } from "@/lib/alias-cache";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
  errorComponent: AuthErrorBoundary,
  notFoundComponent: AuthNotFound,
});

// Minimum visible splash duration (ms). Splash will not disappear before this
// elapses even if data loads instantly. Prevents the "flash-and-gone" effect
// where the user still perceives a white/half-loaded screen.
const MIN_SPLASH_MS = 1000;

// ----- First-screen readiness gate ---------------------------------------
// Routes that own a first-screen data query (e.g. branch dashboard) call
// `requireGate()` on mount and `markReady()` once their first query resolves.
// The splash overlay stays on top until ALL of these are true:
//   (a) minimum visible time elapsed,
//   (b) auth/profile/roles loaded,
//   (c) first-screen ready (default true for routes that don't opt in).
type FirstScreenCtx = {
  requireGate: (key: string) => void;
  markReady: (key: string) => void;
};
const FirstScreenContext = createContext<FirstScreenCtx | null>(null);

export function useFirstScreenGate(key: string, pending: boolean) {
  const ctx = useContext(FirstScreenContext);
  useEffect(() => {
    if (!ctx) return;
    ctx.requireGate(key);
    return () => ctx.markReady(key);
  }, [ctx, key]);
  useEffect(() => {
    if (!ctx) return;
    if (!pending) ctx.markReady(key);
    else ctx.requireGate(key);
  }, [ctx, key, pending]);
}

/**
 * Full-bleed splash overlay. SSR and the very first client render produce
 * identical neutral HTML (spinner on a solid background) so React never
 * detects a hydration mismatch (#418). After mount we swap in the personal
 * full-bleed picture if a package is resolved for this user.
 */
function SplashOverlay({ personal }: { personal: PersonalAssets | null }) {
  return (
    <div className="fixed inset-0 z-[100] h-dvh w-screen overflow-hidden bg-background">
      {personal ? (
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
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        </div>
      )}
    </div>
  );
}

function AuthenticatedLayout() {
  const { user, profile, loading, dataLoaded } = useAuth();

  // Warm DB-backed alias cache once auth is established.
  useEffect(() => { if (user) initAliasCache(); }, [user]);

  // Hydration-safe mount flag — personal splash asset is only resolved after
  // hydration so SSR and first client render produce identical neutral HTML.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Minimum visible splash duration.
  const [minElapsed, setMinElapsed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

  // First-screen readiness gate (set by route children via useFirstScreenGate).
  const pendingGatesRef = useRef<Set<string>>(new Set());
  const [pendingCount, setPendingCount] = useState(0);
  const requireGate = useCallback((key: string) => {
    if (!pendingGatesRef.current.has(key)) {
      pendingGatesRef.current.add(key);
      setPendingCount(pendingGatesRef.current.size);
    }
  }, []);
  const markReady = useCallback((key: string) => {
    if (pendingGatesRef.current.has(key)) {
      pendingGatesRef.current.delete(key);
      setPendingCount(pendingGatesRef.current.size);
    }
  }, []);
  const gateCtx = useMemo<FirstScreenCtx>(() => ({ requireGate, markReady }), [requireGate, markReady]);

  // Safety: never let the first-screen gate hold the splash forever. If a
  // route forgets to clear its gate (or its query hangs), force-open after 8 s.
  const [hardTimeout, setHardTimeout] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setHardTimeout(true), 8000);
    return () => clearTimeout(t);
  }, []);

  // Personal asset lookup — uses live user id, falling back to the last user
  // id remembered on this device so the splash is already personalised on
  // reload before Supabase finishes restoring the session.
  const lookupId = mounted ? (user?.id ?? getLastUserId()) : null;
  const personal = lookupId ? getPersonalAssets(lookupId, profile?.branch_id) : null;

  const authReady = !loading && (!user || dataLoaded);
  const firstScreenReady = pendingCount === 0 || hardTimeout;
  const splashVisible = !(mounted && minElapsed && authReady && firstScreenReady);

  // Pre-auth: send unauthenticated visitors to /login as soon as auth resolves.
  if (mounted && authReady && !user) return <Navigate to="/login" />;

  // Render AppShell underneath the splash overlay once we have a usable
  // identity — this lets the first-screen data query start while the splash
  // still hides the loading state. Splash sits at z-[100] over everything.
  const showShell = !!user && dataLoaded;

  return (
    <FirstScreenContext.Provider value={gateCtx}>
      {showShell ? (
        <AppShell>
          <Outlet />
        </AppShell>
      ) : null}
      {splashVisible ? <SplashOverlay personal={personal} /> : null}
    </FirstScreenContext.Provider>
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
