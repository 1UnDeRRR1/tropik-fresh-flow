import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PENDING_SHARE_REDIRECT_KEY } from "@/lib/share-link";
import { Loader2 } from "lucide-react";

// Pilot share-link entry point. Lives OUTSIDE _authenticated so we can
// intercept the click before login. The token never grants access on its
// own — it only addresses a row; RLS on manager_offers
// (`can_access_manager_offer`) decides whether the signed-in user can see it.
export const Route = createFileRoute("/o/$token")({
  component: ShareLinkLandingPage,
});

const GENERIC_UNAVAILABLE = "Пропозиція недоступна або неактивна";

// Statuses where the offer is still meaningful to a branch.
const OPEN_STATUSES = new Set(["active", "in_work", "confirmed", "linked"]);

function ShareLinkLandingPage() {
  const { token } = Route.useParams();
  const { user, loading, dataLoaded, hasRole, profile } = useAuth();
  const navigate = useNavigate();
  const [forwarded, setForwarded] = useState(false);

  // 1) Not logged in → remember target and bounce to /login.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      try {
        sessionStorage.setItem(PENDING_SHARE_REDIRECT_KEY, `/o/${token}`);
      } catch {
        /* ignore */
      }
    }
  }, [loading, user, token]);

  // 2) Logged in → look up the offer by token. RLS gates visibility per branch.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["share-link-offer", token],
    enabled: !!user && dataLoaded,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_offers")
        .select("id, status, expires_at, target_mode")
        .eq("share_token", token)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    staleTime: 0,
  });

  // 3) Once we have a visible + open offer, hand off to the existing branch
  // offers screen with the offer auto-selected. No data mutation here.
  useEffect(() => {
    if (forwarded) return;
    if (!user || !dataLoaded || isLoading) return;
    if (!data) return;
    if (!OPEN_STATUSES.has(data.status)) return;
    if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return;
    const isBranch = hasRole("branch");
    const isStaff = hasRole(["admin", "super_admin", "import_manager"]);
    // Branch users → land on /branch-offers with this offer opened.
    // Staff (for testing) → land on /manager-offers with same id surfaced.
    if (isBranch && profile?.branch_id) {
      setForwarded(true);
      navigate({
        to: "/branch-offers",
        search: { openOffer: data.id } as never,
        replace: true,
      });
    } else if (isStaff) {
      setForwarded(true);
      navigate({
        to: "/manager-offers",
        search: { openOffer: data.id } as never,
        replace: true,
      });
    }
  }, [forwarded, user, dataLoaded, isLoading, data, hasRole, profile, navigate]);

  if (loading || (user && !dataLoaded)) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" />;
  }

  const expired =
    !!data?.expires_at && new Date(data.expires_at).getTime() < Date.now();
  const inaccessible =
    !isLoading && !isError && (!data || !OPEN_STATUSES.has(data.status) || expired);

  // Roles without branch access (e.g. owner, calendar_*) — show generic msg.
  const noRoleMatch =
    !!data &&
    !hasRole("branch") &&
    !hasRole(["admin", "super_admin", "import_manager"]);

  if (inaccessible || isError || noRoleMatch) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-4 text-center">
        <div className="max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{GENERIC_UNAVAILABLE}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Зверніться до менеджера для актуального посилання.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
