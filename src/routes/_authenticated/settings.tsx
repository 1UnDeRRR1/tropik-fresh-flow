import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut, Sun, Moon, Monitor } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { ShinyButton } from "@/components/ui/shiny-button";
import { getPersonalAssets } from "@/lib/branch-assets";
import ownerSettingsBg from "@/assets/owner-settings-bg.png";
import { useTheme, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";





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

  const { theme, setTheme } = useTheme();
  const themeOptions: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "light", label: "Світла", icon: Sun },
    { value: "dark", label: "Темна", icon: Moon },
    { value: "system", label: "Системна", icon: Monitor },
  ];
  const ThemeToggle = (
    <div className="rounded-xl border border-border bg-card/90 px-2 py-1.5 backdrop-blur">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Тема
      </div>
      <div
        role="radiogroup"
        aria-label="Тема"
        className="relative grid h-8 grid-cols-3 rounded-full border border-border bg-muted p-1"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-card shadow-sm ring-1 ring-border transition-transform duration-300 ease-out"
          style={{
            transform: `translateX(${
              theme === "light" ? "0%" : theme === "dark" ? "100%" : "200%"
            })`,
          }}
        />
        {themeOptions.map((opt) => {
          const Icon = opt.icon;
          const active = theme === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={opt.label}
              title={opt.label}
              onClick={() => setTheme(opt.value)}
              className={cn(
                "relative z-10 flex items-center justify-center rounded-full transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
    </div>
  );


  // Owner exit: mobile = same proven mechanism as Lukach's profile background
  // (fixed inset-0 layer, object-cover object-center, no slot math, no
  // object-fill, no transform/scale). Exit button overlays the background.
  // Desktop = plain button, no artwork.
  if (isOwner) {
    return (
      <>
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 z-0 overflow-hidden md:hidden"
          style={{ bottom: "calc(env(safe-area-inset-bottom) + 3.7rem)" }}
        >
          <img
            src={ownerSettingsBg}
            alt=""
            className="h-full w-full object-cover object-center"
            decoding="async"
            draggable={false}
          />
        </div>

        <div className="relative z-10 space-y-4 pt-16 md:hidden">
          {ThemeToggle}
          <Button
            variant="outline"
            className="w-full bg-transparent border-red-500/70 text-red-700 shadow-none hover:bg-red-500/10 hover:text-red-700"
            onClick={handleSignOut}
          >
            <LogOut className="mr-2 h-4 w-4" /> Вийти
          </Button>
        </div>

        {/* Desktop owner: plain button only, no artwork. */}
        <div className="relative hidden space-y-4 md:block md:pt-3">
          {ThemeToggle}
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


  // Non-owner roles. Only render the decorative profile background when the
  // current user has one in their personal package (e.g. Лукач). Малехів no
  // longer has a profile background — branding lives in the per-section
  // mobile header instead.
  return (
    <div className="relative space-y-4">

      {hasProfileBg && personal && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-background"
        >
          <picture className="absolute inset-0 block h-full w-full">
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
        {ThemeToggle}
        <ShinyButton
          className="relative z-10 flex w-full justify-center h-9 py-0"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" /> Вийти
        </ShinyButton>

      </div>
    </div>
  );
}

