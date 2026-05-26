import { createFileRoute, Navigate, Outlet, useLocation } from "@tanstack/react-router";
import { StaffOnly } from "@/components/StaffOnly";

// Legacy shipment detail page is removed from user flow.
// Only the child route /shipments/$id/products remains active.
// Direct hits to /shipments/$id redirect to the main shipments table.
export const Route = createFileRoute("/_authenticated/shipments/$id")({
  component: () => (
    <StaffOnly>
      <LegacyShipmentDetailGuard />
    </StaffOnly>
  ),
});

function LegacyShipmentDetailGuard() {
  const { id } = Route.useParams();
  const location = useLocation();
  const path = location.pathname.replace(/\/+$/, "");
  const isLeaf = path === `/shipments/${id}`;
  if (isLeaf) {
    return <Navigate to="/shipments" replace />;
  }
  return <Outlet />;
}
