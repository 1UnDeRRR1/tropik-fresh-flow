import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth";

/**
 * Block branch users from staff-only screens that may expose purchase prices,
 * supplier/manager data or full shipment details.
 * Renders children only for super_admin / admin / import_manager.
 */
export function StaffOnly({ children }: { children: ReactNode }) {
  const { loading, dataLoaded, hasRole } = useAuth();
  if (loading || !dataLoaded) return null;
  if (!hasRole(["super_admin", "admin", "import_manager"])) {
    return <Navigate to="/" />;
  }
  return <>{children}</>;
}
