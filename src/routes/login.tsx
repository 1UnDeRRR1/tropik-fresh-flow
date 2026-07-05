import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, usePostLoginTarget } from "@/lib/auth";
import { getPersonalAssets } from "@/lib/branch-assets";
import { getLastUserId } from "@/lib/last-user";
import { PENDING_SHARE_REDIRECT_KEY } from "@/lib/share-link";

// Consume a pending /o/<token> redirect saved before the login bounce.
// Only forwards to whitelisted in-app paths to prevent open-redirect abuse.
function consumePendingShareRedirect(): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_SHARE_REDIRECT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_SHARE_REDIRECT_KEY);
    if (raw.startsWith("/o/") && !raw.includes("//") && raw.length < 200) {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return null;
}

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/login")({
  // Same-origin relative-path only: starts with "/", no protocol-relative
  // "//", capped length. Prevents open-redirect abuse via ?next=.
  validateSearch: (s: Record<string, unknown>): { next?: string } => {
    const raw = s.next;
    if (
      typeof raw === "string" &&
      raw.startsWith("/") &&
      !raw.startsWith("//") &&
      raw.length < 500
    ) {
      return { next: raw };
    }
    return {};
  },
  component: LoginPage,
});

function LoginPage() {
  const { user, loading, dataLoaded } = useAuth();
  const { ready, target } = usePostLoginTarget();
  const { next } = Route.useSearch();
  // Post-login navigation is handled entirely by the render-time <Navigate>
  // branch below (which respects ?next=, then pending /o/<token> share redirects).
  // Public self-registration is disabled — accounts are created by an admin
  // via supabase/functions/admin-users (super-admin → Users screen).
  // (signup mode removed; admins create accounts via super-admin → Users)
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Single source of truth for post-login destination.
  if (user && ready) {
    if (next) return <Navigate to={next} />;
    const pending = consumePendingShareRedirect();
    if (pending) return <Navigate to={pending} />;
    return <Navigate to={target} />;
  }
  // Only hide the form while we already know a user exists and are waiting
  // for their profile/roles to load (so we can redirect them). For
  // unauthenticated visitors, render the form immediately even if
  // AuthProvider.loading is still true — otherwise a stalled getSession()
  // would leave /login completely blank.
  if (user && !dataLoaded) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4 py-10" />
    );
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      // Lightweight calendar accounts log in with a username (no `@`).
      // Convert to the synthetic email used at account creation.
      const loginEmail = email.includes("@")
        ? email.trim()
        : `${email.trim().toLowerCase()}@calendar.tropik.local`;
      const { error } = await supabase.auth.signInWithPassword({
        email: loginEmail,
        password,
      });
      if (error) throw error;
      // Do NOT navigate("/") here — the render-time <Navigate> branch
      // above consumes any pending /o/<token> share redirect first, then
      // falls back to the role-specific post-login target. Forcing "/"
      // here would race the auth listener and drop /o/<token> deep-links
      // back to branch home.
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Помилка входу";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // Show the last signed-in user's personal splash as the login backdrop.
  // First visit / cleared storage → neutral background (no Tereshchenko leak).
  const lastUserAssets = getPersonalAssets(getLastUserId());

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10 text-foreground">

      {lastUserAssets && (
        <picture>
          <source media="(max-width: 767px)" type="image/webp" srcSet={lastUserAssets.splashMobileWebp} />
          <source media="(max-width: 767px)" type="image/png" srcSet={lastUserAssets.splashMobilePng} />
          <source media="(min-width: 768px)" type="image/webp" srcSet={lastUserAssets.splashDesktopWebp} />
          <source media="(min-width: 768px)" type="image/png" srcSet={lastUserAssets.splashDesktopPng} />
          <img
            src={lastUserAssets.splashDesktopPng}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            loading="eager"
            decoding="async"
            draggable={false}
          />
        </picture>
      )}
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-sm">
        <div className="rounded-2xl border border-border bg-card/95 p-6 text-card-foreground shadow-xl backdrop-blur">

          <h1 className="text-xl font-bold">Вхід в систему</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Обліковий запис створює адміністратор
          </p>

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">Логін</Label>
              <Input
                id="email"
                type="text"
                autoCapitalize="none"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Логін"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Пароль</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <Button
              type="submit"
              disabled={submitting}
              className="h-11 w-full bg-brand text-brand-foreground hover:bg-brand/90"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Увійти"}
            </Button>
          </form>


        </div>


        <p className="mt-6 text-center text-xs text-white/80 drop-shadow">
          © {new Date().getFullYear()} Внутрішня система.
        </p>
      </div>
    </div>
  );
}
