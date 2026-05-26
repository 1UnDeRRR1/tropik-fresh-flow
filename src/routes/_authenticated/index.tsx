import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth, usePostLoginTarget } from "@/lib/auth";
import { getPersonalAssets } from "@/lib/branch-assets";

export const Route = createFileRoute("/_authenticated/")({
  component: () => {
    const { ready, target } = usePostLoginTarget();
    const { user, profile } = useAuth();
    if (!ready) {
      const personal = getPersonalAssets(user?.id, profile?.branch_id);
      if (personal) {
        return (
          <div className="fixed inset-0 z-50 overflow-hidden bg-background">
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
      // Neutral fallback — no Tropik logo card, just a subtle spinner.
      return (
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        </div>
      );
    }
    return <Navigate to={target} />;
  },
});
