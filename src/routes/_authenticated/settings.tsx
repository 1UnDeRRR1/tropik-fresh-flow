import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { getPersonalAssets } from "@/lib/branch-assets";
import ownerSettingsBg from "@/assets/owner-settings-bg.png";

export const Route = createFileRoute("/_authenticated/settings")({
  component: Settings,
});

function Settings() {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const personal = getPersonalAssets(profile?.id, profile?.branch_id);
  const hasProfileBg = !!personal?.profileBgMobileWebp || !!personal?.profileBgDesktopWebp;

  return (
    <div className="relative space-y-4">
      {hasProfileBg && personal && (
        // Full-page background for the Профіль route. Covers the entire
        // viewport behind all content (z-0); pointer-events-none keeps the
        // exit button and bottom nav clickable. object-cover fills the area
        // without distorting the image (may crop edges, never stretches).
        // bg-background under the <img> hides any underlying app chrome so
        // there is no visible seam on the sides.
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-background"
        >
          <picture>
            <source
              media="(max-width: 767px)"
              type="image/webp"
              srcSet={personal.profileBgMobileWebp}
            />
            <source
              media="(max-width: 767px)"
              type="image/png"
              srcSet={personal.profileBgMobilePng}
            />
            <source
              media="(min-width: 768px)"
              type="image/webp"
              srcSet={personal.profileBgDesktopWebp}
            />
            <source
              media="(min-width: 768px)"
              type="image/png"
              srcSet={personal.profileBgDesktopPng}
            />
            <img
              src={personal.profileBgDesktopPng ?? personal.profileBgMobilePng}
              alt=""
              className="h-full w-full object-cover object-center"
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          </picture>
        </div>
      )}
      <div className="relative z-10 space-y-4 pt-16">
        <Button
          variant="outline"
          className="relative z-10 w-full bg-background/90 backdrop-blur border-red-500"
          onClick={async () => {
            await signOut();
            navigate({ to: "/login" });
          }}
        >
          <LogOut className="mr-2 h-4 w-4" /> Вийти
        </Button>
      </div>
    </div>
  );
}
