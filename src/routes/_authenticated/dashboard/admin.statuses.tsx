import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/dashboard/admin/statuses")({
  component: () => <Navigate to="/admin/status-preview" />,
});