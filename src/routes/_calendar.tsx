import {
  createFileRoute,
  Outlet,
  Navigate,
  Link,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useAuth, ROLE_LABEL_UK } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Logo } from "@/components/Logo";
import logoSrc from "@/assets/tropik-logo.png";
import { LogOut } from "lucide-react";

export const Route = createFileRoute("/_calendar")({
  component: CalendarLayout,
});

function CalendarLayout() {
  const { user, loading, dataLoaded, profile, primaryRole, signOut } = useAuth();
  const router = useRouter();

  if (loading || (user && !dataLoaded)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background px-6">
        <Logo size={220} className="animate-pulse" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" />;

  const onLogout = async () => {
    await signOut();
    router.navigate({ to: "/login" });
  };

  // Conservative expiry check: every 10 minutes ask the server whether this
  // calendar account is still active. Only sign out on an explicit `false`
  // — never on network errors, RLS hiccups, or transient mobile sleep — so
  // orientation changes / brief offline moments cannot trigger a false logout.
  const signedOutRef = useRef(false);
  useEffect(() => {
    if (!user) return;
    if (primaryRole !== "calendar_branch" && primaryRole !== "calendar_tropik") return;

    let cancelled = false;
    const check = async () => {
      try {
        const { data, error } = await supabase.rpc("is_calendar_active", {
          _user_id: user.id,
        });
        if (cancelled || error) return;
        if (data === false && !signedOutRef.current) {
          signedOutRef.current = true;
          await signOut();
          router.navigate({ to: "/login", search: { reason: "expired" } as never });
        }
      } catch {
        /* ignore — never sign out on transient errors */
      }
    };
    const id = window.setInterval(check, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [user, primaryRole, signOut, router]);


  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/85 backdrop-blur supports-[backdrop-filter]:bg-card/70">
        <div className="mx-auto flex h-16 w-full max-w-[1280px] items-center justify-between gap-3 px-4 pt-safe md:px-6">
          <Link to="/" aria-label="TROPIK" className="flex items-center">
            <img
              src={logoSrc}
              alt="TROPIK"
              className="h-12 w-auto object-contain"
              draggable={false}
            />
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-right leading-tight">
              <div className="text-sm font-semibold text-foreground">
                {profile?.full_name ?? ""}
              </div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {primaryRole ? ROLE_LABEL_UK[primaryRole] : ""}
              </div>
            </div>
            <button
              onClick={onLogout}
              className="rounded-full p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Вийти"
              title="Вийти"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 pb-10 pt-4 md:max-w-[1280px] md:px-6">
        <Outlet />
      </main>
    </div>
  );
}
