import { createFileRoute, Navigate } from "@tanstack/react-router";

// @ts-expect-error Route tree updates after the file route is generated.
export const Route = createFileRoute("/")({
  component: () => <Navigate to="/dashboard/admin" />,
});