import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, defaultRoutePerRole } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const { user, loading, primaryRole } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to={defaultRoutePerRole(primaryRole)} />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("Акаунт створено. Вхід…");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Помилка входу";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-primary px-4 py-10 text-primary-foreground">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 50% 0%, oklch(0.58 0.22 25 / 0.55), transparent 70%)",
        }}
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center gap-3 text-center">
          <Logo className="text-4xl text-primary-foreground" />
          <p className="text-xs uppercase tracking-[0.3em] text-primary-foreground/70">
            Supply Distribution
          </p>
        </div>

        <div className="rounded-2xl bg-card p-6 text-card-foreground shadow-pop">
          <h1 className="text-xl font-bold">
            {mode === "signin" ? "Вхід в систему" : "Створити акаунт"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Внутрішній доступ TROPIK"
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
              <Label htmlFor="email">Електронна пошта</Label>
              <Input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@tropik.ua"
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

        <p className="mt-6 text-center text-xs text-primary-foreground/60">
          © {new Date().getFullYear()} TROPIK. Внутрішня система.
        </p>
      </div>
    </div>
  );
}
