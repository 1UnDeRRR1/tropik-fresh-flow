import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/master-data")({
  component: () => <Navigate to="/admin/branches" />,
});
