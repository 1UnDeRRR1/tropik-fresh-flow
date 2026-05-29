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
  const { profile, primaryRole, signOut } = useAuth();
  const navigate = useNavigate();
  const isOwner = primaryRole === "owner";
  const personal = getPersonalAssets(profile?.id, profile?.branch_id);
  const hasProfileBg = !isOwner && (!!personal?.profileBgMobileWebp || !!personal?.profileBgDesktopWebp);

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/login" });
  };

  // Owner mobile exit page: one local container, button on top of the free
  // upper area of the artwork, single <img> with object-contain below. No
  // background-image, no fixed layer, no overlay, no cover, no manual
  // object-position. Desktop owner falls back to the plain layout.
  if (isOwner) {
    return (
      <div className="relative space-y-4">
        {/* Mobile owner exit area */}
        <div
          className="flex flex-col gap-4 md:hidden"
          style={{
            // Header on owner mobile = safe-area-top + 12rem banner + 0.5rem
            // padding. Main has pb-28 (=7rem) for the bottom nav. Leave a
            // small buffer so nothing slides under the nav.
            minHeight:
              "calc(100dvh - env(safe-area-inset-top) - 12rem - 0.5rem - 7rem - 1rem)",
          }}
        >
          <Button
            variant="outline"
            className="w-full bg-transparent border-red-500/70 text-red-700 shadow-none hover:bg-red-500/10 hover:text-red-700"
            onClick={handleSignOut}
          >
            <LogOut className="mr-2 h-4 w-4" /> Вийти
          </Button>
          <img
            src={ownerSettingsBg}
            alt=""
            aria-hidden="true"
            className="min-h-0 w-full flex-1 object-contain"
            draggable={false}
            loading="lazy"
            decoding="async"
          />
        </div>

        {/* Desktop owner: plain button only, no artwork. */}
        <div className="hidden md:block md:pt-3">
          <Button
            variant="outline"
            className="w-full bg-transparent border-red-500/70 text-red-700 shadow-none hover:bg-red-500/10 hover:text-red-700"
            onClick={handleSignOut}
          >
            <LogOut className="mr-2 h-4 w-4" /> Вийти
          </Button>
        </div>
      </div>
    );
  }

  // Non-owner roles: unchanged behaviour (personal profile bg + button).
  return (
    <div className="relative space-y-4">
      {hasProfileBg && personal && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-background"
        >
          <picture>
            <source media="(max-width: 767px)" type="image/webp" srcSet={personal.profileBgMobileWebp} />
            <source media="(max-width: 767px)" type="image/png" srcSet={personal.profileBgMobilePng} />
            <source media="(min-width: 768px)" type="image/webp" srcSet={personal.profileBgDesktopWebp} />
            <source media="(min-width: 768px)" type="image/png" srcSet={personal.profileBgDesktopPng} />
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
          onClick={handleSignOut}
        >
          <LogOut className="mr-2 h-4 w-4" /> Вийти
        </Button>
      </div>
    </div>
  );
}
