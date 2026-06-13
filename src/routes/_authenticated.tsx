import { createFileRoute, Outlet, Navigate, Link, useRouter, useRouterState } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/AppShell";
import { translateError } from "@/lib/mutation-helpers";
import { initAliasCache } from "@/lib/alias-cache";
import { isOwnerAllowedPath, OWNER_HOME } from "@/lib/owner-route-guard";
import { useActivityHeartbeat } from "@/hooks/useActivityHeartbeat";
import { getOwnerBannerAssets, getPersonalAssets, type PersonalAssets } from "@/lib/branch-assets";

const MALEKHIV_BRANCH_ID = "3bb65cb3-27a1-5f18-839a-340271d711fd";
const ENABLE_MALEKHIV_VISUAL_EXPERIMENTS = false;


export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
  errorComponent: AuthErrorBoundary,
  notFoundComponent: AuthNotFound,
});

// Minimum visible splash duration (ms). Splash will not disappear before this
// elapses even if data loads instantly. Prevents the "flash-and-gone" effect
// where the user still perceives a white/half-loaded screen.
const MIN_SPLASH_MS = 1200;

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
  // One-shot: once this gate has released for the lifetime of this mounted
  // screen, later refetches / pending toggles must NOT re-show the global
  // splash. The splash is for the initial first-screen load only.
  const hasReleasedRef = useRef(false);
  useEffect(() => {
    if (!ctx) return;
    if (!hasReleasedRef.current) ctx.requireGate(key);
    return () => ctx.markReady(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, key]);
  useEffect(() => {
    if (!ctx) return;
    if (hasReleasedRef.current) return;
    if (!pending) {
      hasReleasedRef.current = true;
      ctx.markReady(key);
    } else {
      ctx.requireGate(key);
    }
  }, [ctx, key, pending]);
}

/**
 * Full-bleed splash overlay. SSR and the very first client render produce
 * identical neutral HTML (spinner on a solid background) so React never
 * detects a hydration mismatch (#418). After mount we can swap in the
 * personal full-bleed picture when a package is resolved for this user.
 */
function SplashOverlay({ personal, isOwner }: { personal: PersonalAssets | null; isOwner: boolean }) {
  const ownerAssets = isOwner ? getOwnerBannerAssets() : null;
  const splashMobileWebp = ownerAssets?.splashMobile ?? personal?.splashMobileWebp;
  const splashMobilePng = ownerAssets?.splashDesktop ?? personal?.splashMobilePng;
  const splashDesktopPng = ownerAssets?.splashDesktop ?? personal?.splashDesktopPng;

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] h-dvh w-screen overflow-hidden bg-background">
      {splashDesktopPng || splashMobilePng || splashMobileWebp ? (
        <picture>
          {splashMobileWebp ? <source media="(max-width: 767px)" type="image/webp" srcSet={splashMobileWebp} /> : null}
          {splashMobilePng ? <source media="(max-width: 767px)" type="image/png" srcSet={splashMobilePng} /> : null}
          {personal?.splashDesktopWebp ? <source media="(min-width: 768px)" type="image/webp" srcSet={personal.splashDesktopWebp} /> : null}
          {splashDesktopPng ? <source media="(min-width: 768px)" type="image/png" srcSet={splashDesktopPng} /> : null}
          <img
            src={splashDesktopPng ?? splashMobilePng}
            alt=""
            className="h-full w-full object-cover object-top"
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
  const { user, profile, loading, dataLoaded, primaryRole } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useActivityHeartbeat();

  useEffect(() => { if (user) initAliasCache(); }, [user]);

  const isMalekhivBranch =
    primaryRole === "branch" && profile?.branch_id === MALEKHIV_BRANCH_ID;
  useEffect(() => {
    if (ENABLE_MALEKHIV_VISUAL_EXPERIMENTS && isMalekhivBranch) {
      document.body.setAttribute("data-branch-test", "malekhiv");
    } else {
      document.body.removeAttribute("data-branch-test");
    }
  }, [isMalekhivBranch, pathname]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [minElapsed, setMinElapsed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinElapsed(true), MIN_SPLASH_MS);
    return () => clearTimeout(t);
  }, []);

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

  const authReady = !loading && (!user || dataLoaded);
  const firstScreenReady = pendingCount === 0;
  const splashVisible = !(mounted && minElapsed && authReady && firstScreenReady);
  const splashPersonal = useMemo(() => getPersonalAssets(user?.id, profile?.branch_id), [user?.id, profile?.branch_id]);
  const isOwner = primaryRole === "owner";

  // Pre-auth: send unauthenticated visitors to /login as soon as auth resolves.
  if (mounted && authReady && !user) return <Navigate to="/login" />;

  // Owner / Director shell: redirect any operational URL back to the owner
  // home. Allow-list lives in src/lib/owner-route-guard.ts. This is the
  // primary URL gate — OwnerLinkGuard is a defence-in-depth cosmetic layer.
  if (mounted && authReady && user && primaryRole === "owner" && !isOwnerAllowedPath(pathname)) {
    return <Navigate to={OWNER_HOME} replace />;
  }

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
      {splashVisible ? <SplashOverlay personal={splashPersonal} isOwner={isOwner} /> : null}
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
