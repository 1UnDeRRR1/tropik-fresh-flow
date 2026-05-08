import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";

export const Route = createFileRoute("/_authenticated/analytics")({
  component: Analytics,
});

function Analytics() {
  return (
    <div className="space-y-4">
      <PageHeader title="Аналітика" subtitle="KPI та графіки" />
      <SectionCard title="Обсяги поставок">
        <EmptyState title="Дані зʼявляться після перших поставок" hint="Графіки доступні з накопиченням історії" />
      </SectionCard>
      <SectionCard title="Топ постачальники">
        <EmptyState title="Поки немає даних" />
      </SectionCard>
    </div>
  );
}
