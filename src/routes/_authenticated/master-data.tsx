import { createFileRoute, Navigate, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { SectionCard } from "@/components/cards";

export const Route = createFileRoute("/_authenticated/master-data")({
  component: MasterDataPage,
});

function MasterDataPage() {
  const { hasRole, loading } = useAuth();
  if (loading) return null;
  if (!hasRole(["admin", "super_admin"])) return <Navigate to="/" />;

  return (
    <div className="space-y-4">
      <PageHeader title="Master-data" subtitle="Довідники та налаштування системи" />
      <SectionCard title="Master-data">
        <div className="grid grid-cols-2 gap-2 text-sm font-medium md:grid-cols-4 lg:grid-cols-7">
          <Link to="/admin/branches" className="rounded-xl bg-secondary p-3">Філії</Link>
          <Link to="/admin/managers" className="rounded-xl bg-secondary p-3">Менеджери</Link>
          <Link to="/admin/suppliers" className="rounded-xl bg-secondary p-3">Постачальники</Link>
          <Link to="/admin/products" className="rounded-xl bg-secondary p-3">Товари</Link>
          <Link to="/admin/countries-master" className="rounded-xl bg-secondary p-3">Країни</Link>
          <Link to="/admin/countries" className="rounded-xl bg-secondary p-3">Логістика</Link>
          <Link to="/analytics" className="rounded-xl bg-secondary p-3">Аналітика</Link>
          <Link to="/admin/status-preview" className="rounded-xl bg-info/10 p-3 text-foreground">Статуси</Link>
          <Link to="/admin/triggers" className="rounded-xl bg-destructive/10 p-3 text-destructive">Тригери</Link>
          <Link to="/admin/vacations" className="rounded-xl bg-warning/10 p-3">Відпустки</Link>
        </div>
      </SectionCard>
    </div>
  );
}
