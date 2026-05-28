import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useAuth, ROLE_LABEL_UK } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { SectionCard } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { getPersonalAssets } from "@/lib/branch-assets";

export const Route = createFileRoute("/_authenticated/settings")({
  component: Settings,
});

function Settings() {
  const { user, profile, roles, signOut } = useAuth();
  const navigate = useNavigate();
  const personal = getPersonalAssets(profile?.id, profile?.branch_id);
  const hasProfileBg = !!personal?.profileBgMobileWebp || !!personal?.profileBgDesktopWebp;

  return (
    <div className="relative space-y-4">
      {hasProfileBg && personal && (
        // Decorative art-block: pinned to the bottom of the safe area, behind
        // all content (z-0). pointer-events-none keeps the exit button and
        // bottom nav fully clickable. Uses <picture> for mobile/desktop swap
        // and object-contain so the image is never stretched or cropped.
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-0 flex justify-center"
          style={{ height: "70vh" }}
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
              className="h-full w-auto max-w-full object-contain object-bottom opacity-90"
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          </picture>
        </div>
      )}
      <div className="relative z-10 space-y-4">
        <PageHeader title="Профіль" />
        <SectionCard title="Обліковий запис">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted-foreground">Імʼя</dt><dd>{profile?.full_name ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Email</dt><dd>{user?.email}</dd></div>
            <div className="flex justify-between"><dt className="text-muted-foreground">Ролі</dt><dd>{roles.map((r) => ROLE_LABEL_UK[r]).join(", ") || "—"}</dd></div>
          </dl>
        </SectionCard>
        <Button
          variant="outline"
          className="relative z-10 w-full bg-background/90 backdrop-blur"
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
