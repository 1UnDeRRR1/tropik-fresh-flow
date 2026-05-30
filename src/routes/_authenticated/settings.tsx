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

  // Owner exit: mobile = fixed viewport-slot between owner banner and bottom
  // nav, asset prepared exactly for the 440x361 slot (1320x1083 PNG, ratio
  // 1.2188:1). No background-image, no cover/contain/object-position, no
  // second layer, no scroll. Desktop = plain button, no artwork.
  if (isOwner) {
    return (
      <>
        <div
          className="fixed left-0 right-0 z-20 overflow-hidden md:hidden"
          style={{
            top: "calc(env(safe-area-inset-top) + 12rem)",
            bottom: "calc(env(safe-area-inset-bottom) + 3.7rem)",
          }}
        >
          <img
            src={ownerSettingsBg}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full"
            draggable={false}
            decoding="async"
          />
          <div className="absolute left-0 right-0 top-0 px-4 pt-4">
            <Button
              variant="outline"
              className="w-full bg-transparent border-red-500/70 text-red-700 shadow-none hover:bg-red-500/10 hover:text-red-700"
              onClick={handleSignOut}
            >
              <LogOut className="mr-2 h-4 w-4" /> Вийти
            </Button>
          </div>
        </div>

        {/* Desktop owner: plain button only, no artwork. */}
        <div className="relative hidden space-y-4 md:block md:pt-3">
          <Button
            variant="outline"
            className="w-full bg-transparent border-red-500/70 text-red-700 shadow-none hover:bg-red-500/10 hover:text-red-700"
            onClick={handleSignOut}
          >
            <LogOut className="mr-2 h-4 w-4" /> Вийти
          </Button>
        </div>
      </>
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
