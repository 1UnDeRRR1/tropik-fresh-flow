import { createFileRoute, Navigate } from "@tanstack/react-router";
import { OWNER_HOME } from "@/lib/owner-route-guard";

export const Route = createFileRoute("/_authenticated/owner/")({
  component: () => <Navigate to={OWNER_HOME} replace />,
});
