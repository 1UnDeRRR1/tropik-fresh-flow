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
  component: LoginPage,
});

function LoginPage() {
  const { user, loading, dataLoaded } = useAuth();
  const { ready, target } = usePostLoginTarget();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Single source of truth for post-login destination.
  if (user && ready) {
    const pending = consumePendingShareRedirect();
    if (pending) return <Navigate to={pending} />;
    return <Navigate to={target} />;
  }
  if (loading || (user && !dataLoaded)) {
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
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: loginEmail,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("Акаунт створено. Вхід…");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: loginEmail,
          password,
        });
        if (error) throw error;
      }
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

          <h1 className="text-xl font-bold">
            {mode === "signin" ? "Вхід в систему" : "Створити акаунт"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Внутрішній доступ"
              : "Нові користувачі отримують роль «Філія»"}
          </p>

          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            {mode === "signup" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Ім'я та прізвище</Label>
                <Input
                  id="name"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Іван Петренко"
                />
              </div>
            )}
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
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === "signin" ? (
                "Увійти"
              ) : (
                "Зареєструватись"
              )}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
            className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
          >
            {mode === "signin" ? "Немає акаунту? Створити" : "Вже є акаунт? Увійти"}
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-white/80 drop-shadow">
          © {new Date().getFullYear()} Внутрішня система.
        </p>
      </div>
    </div>
  );
}
