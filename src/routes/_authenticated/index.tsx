import { createFileRoute, Navigate } from "@tanstack/react-router";
import { usePostLoginTarget } from "@/lib/auth";
import { Logo } from "@/components/Logo";

export const Route = createFileRoute("/_authenticated/")({
  component: () => {
    const { ready, target } = usePostLoginTarget();
    if (!ready) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center">
          <Logo size={160} className="animate-pulse" />
        </div>
      );
    }
    return <Navigate to={target} />;
  },
});
