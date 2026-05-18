import { createFileRoute } from "@tanstack/react-router";
import { PipelineStatusBadge, type PipelineBadgeVariant } from "@/components/PipelineStatusBadge";
import { PIPELINE_ORDER } from "@/lib/pipeline-status";

export const Route = createFileRoute("/_authenticated/admin/status-preview")({
  component: StatusPreviewPage,
});

const VARIANTS: { id: PipelineBadgeVariant; title: string; desc: string }[] = [
  { id: "minimal", title: "1. Minimal", desc: "Плоский чип з іконкою. Без анімації. Максимально спокійно." },
  { id: "soft-glow", title: "2. Soft glow", desc: "Чип з тонкою рамкою і легким світінням у колір статусу." },
  { id: "animated", title: "3. Animated icon", desc: "Іконки оживають: машинка їде, шестерня крутиться, склад «клацає»." },
  { id: "progress", title: "4. Pill + progress", desc: "Чип з тонкою смужкою прогресу внизу: 1/9 … 9/9 етапів." },
];

function StatusPreviewPage() {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-10">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Статуси — вибір стилю</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Подивись 4 варіанти оформлення. Напиши, який залишаємо — підставлю його у всі табло
          (менеджер, філія, логіст, адмін, брокер).
        </p>
      </header>

      {VARIANTS.map((v) => (
        <section key={v.id} className="space-y-3 rounded-xl border border-border bg-card p-5">
          <div>
            <h2 className="text-lg font-semibold">{v.title}</h2>
            <p className="text-xs text-muted-foreground">{v.desc}</p>
          </div>
          <div className="flex flex-wrap gap-2 pt-2">
            {PIPELINE_ORDER.map((s) => (
              <PipelineStatusBadge key={s} status={s} variant={v.id} size="md" />
            ))}
          </div>
        </section>
      ))}

      <section className="rounded-xl border border-dashed border-border p-5 text-xs text-muted-foreground">
        Палітра: спокійні відтінки (slate / amber / indigo / teal / violet / sky / orange / cyan / emerald),
        однакова насиченість, без неонових і «райдужних» кольорів. Підтримує темну тему.
      </section>
    </div>
  );
}
