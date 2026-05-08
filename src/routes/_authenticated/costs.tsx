import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";

export const Route = createFileRoute("/_authenticated/costs")({
  component: Costs,
});

function Costs() {
  return (
    <div className="space-y-4">
      <PageHeader title="Собівартість" subtitle="Калькуляція позицій поставок" />
      <SectionCard title="Як рахується">
        <p className="text-sm text-muted-foreground">
          (Сума товарів + Митниця + Логістика + Інше) × Курс ÷ Кількість одиниць
        </p>
      </SectionCard>
      <SectionCard title="Останні розрахунки">
        <EmptyState title="Виберіть поставку, щоб побачити калькуляцію" hint="Деталі поставки → вкладка Витрати" />
      </SectionCard>
    </div>
  );
}
