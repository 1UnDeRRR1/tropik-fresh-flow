import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/" as any)({
  component: () => <Navigate to="/_authenticated" />,
});