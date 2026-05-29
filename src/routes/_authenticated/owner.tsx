import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ReadOnlyShell } from "@/components/ReadOnlyShell";
import { OwnerLinkGuard } from "@/components/OwnerLinkGuard";

export const Route = createFileRoute("/_authenticated/owner")({
  component: OwnerLayout,
});

function OwnerLayout() {
  return (
    <ReadOnlyShell>
      <OwnerLinkGuard>
        <div className="owner-warm-theme contents">
          <Outlet />
        </div>
      </OwnerLinkGuard>
    </ReadOnlyShell>
  );
}
