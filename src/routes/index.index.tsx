import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/index/")({
  component: () => <Navigate to="/_authenticated" />,
});