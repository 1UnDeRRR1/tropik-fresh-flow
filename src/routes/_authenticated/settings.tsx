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
