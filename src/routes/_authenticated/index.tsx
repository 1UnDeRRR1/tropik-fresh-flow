import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth, usePostLoginTarget } from "@/lib/auth";
import { getOwnerBannerAssets, getPersonalAssets } from "@/lib/branch-assets";

export const Route = createFileRoute("/_authenticated/")({
  component: () => {
    const { ready, target } = usePostLoginTarget();
    const { user, profile, primaryRole } = useAuth();
    if (!ready) {
      const personal = getPersonalAssets(user?.id, profile?.branch_id);
      const ownerAssets = primaryRole === "owner" ? getOwnerBannerAssets() : null;
      const splashMobileWebp = ownerAssets?.splashMobile ?? personal?.splashMobileWebp;
      const splashMobilePng = ownerAssets?.splashDesktop ?? personal?.splashMobilePng;
      const splashDesktopPng = ownerAssets?.splashDesktop ?? personal?.splashDesktopPng;
      if (splashDesktopPng || splashMobilePng || splashMobileWebp) {
        return (
          <div className="fixed inset-0 z-50 overflow-hidden bg-background">
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
          </div>
        );
      }
      return (
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
        </div>
      );
    }
    return <Navigate to={target} />;
  },
});
