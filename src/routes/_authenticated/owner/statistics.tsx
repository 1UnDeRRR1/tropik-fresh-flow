import { createFileRoute } from "@tanstack/react-router";
import { StatisticsPage } from "@/routes/_authenticated/statistics";

export const Route = createFileRoute("/_authenticated/owner/statistics")({
  component: StatisticsPage,
});
