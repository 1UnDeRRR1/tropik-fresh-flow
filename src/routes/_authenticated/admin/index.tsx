import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/")({
  component: () => <Navigate to="/admin/branches" />,
});
