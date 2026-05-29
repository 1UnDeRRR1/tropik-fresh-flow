import { createFileRoute } from "@tanstack/react-router";
import { Analytics } from "@/routes/_authenticated/analytics";

export const Route = createFileRoute("/_authenticated/owner/analytics")({
  component: Analytics,
});
