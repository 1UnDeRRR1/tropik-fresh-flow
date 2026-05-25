// Pilot QA retired — page is hidden behind a redirect to the central work table.
// Do not reintroduce hardcoded Pilot/mock accounts. If a developer-only switcher
// is needed later, it must be rebuilt from clean profiles/user_roles.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/pilot-qa")({
  beforeLoad: () => {
    throw redirect({ to: "/shipments" });
  },
  component: () => null,
});
