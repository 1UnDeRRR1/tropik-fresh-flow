import { createFileRoute } from "@tanstack/react-router";
import { CalendarPage } from "@/routes/_authenticated/calendar";

export const Route = createFileRoute("/_authenticated/owner/calendar")({
  component: CalendarPage,
});
