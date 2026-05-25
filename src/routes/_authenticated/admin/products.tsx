import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/AppShell";
import { SectionCard } from "@/components/cards";

export const Route = createFileRoute("/_authenticated/admin/products")({
  component: ProductsAdminDisabled,
});

// Phase 0 cleanup — legacy `products` table CRUD removed.
// Product dictionary is managed via SuperFile and read from `product_dictionary`.
function ProductsAdminDisabled() {
  return (
    <div className="space-y-4">
      <PageHeader title="Товари" />
      <SectionCard title="Каталог">
        <p className="text-sm text-muted-foreground">
          Довідник товарів керується через SuperFile. Редагування у цьому розділі вимкнено.
        </p>
      </SectionCard>
    </div>
  );
}
