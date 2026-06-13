import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut, Sun, Moon, Monitor } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
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
  const activeIdx = Math.max(
    0,
    themeOptions.findIndex((o) => o.value === theme),
  );
  const ThemeToggle = (
    <div className="rounded-xl border border-border bg-card/90 p-3 backdrop-blur">
      <div className="mb-2 text-xs font-medium text-muted-foreground">Тема</div>
      {/* Capsule segment control: sliding thumb between three labels.
          Logic of useTheme/setTheme is unchanged; only the visual swaps. */}
      <div
        role="radiogroup"
        aria-label="Тема"
        className="relative grid h-10 grid-cols-3 rounded-full border border-border bg-muted p-1"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-1 left-1 rounded-full bg-card shadow-sm ring-1 ring-border transition-transform duration-300 ease-out"
          style={{
            width: "calc((100% - 0.5rem) / 3)",
            transform: `translateX(calc(${activeIdx} * 100%))`,
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
              onClick={() => setTheme(opt.value)}
              className={cn(
                "relative z-10 flex items-center justify-center gap-1.5 rounded-full text-xs font-medium transition-colors",
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{opt.label}</span>
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
        {ThemeToggle}
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
