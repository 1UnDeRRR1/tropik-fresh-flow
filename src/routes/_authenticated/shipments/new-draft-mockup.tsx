import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/shipments/new-draft-mockup")({
  component: MockupPage,
});

/**
 * VISUAL-ONLY PROTOTYPE for /shipments/new product step.
 * Static values. No Supabase, no hooks, no save, no nav.
 * Not wired into the real shipment flow.
 */
function MockupPage() {
  return (
    <div className="min-h-screen bg-background px-3 pb-24 pt-3 text-foreground">
      <div className="mx-auto w-full max-w-[440px] space-y-3">
        {/* Compact summary */}
        <section className="rounded-2xl border border-border bg-card p-3 shadow-card">
          <SummaryRow left={["Постачальник", "3FRUTTI"]} right={["Номер", "FRUTT-025-ITA-073"]} />
          <Divider />
          <SummaryRow left={["Країна", "Італія"]} right={["Завантаження", "2026-06-27"]} />
          <Divider />
          <SummaryRow left={["Транспорт", "3 200"]} right={["Валюта", "EUR"]} />
        </section>

        {/* Totals line */}
        <div className="px-1 text-[12px] text-muted-foreground">
          Палети <span className="text-foreground">0/26</span> · Брутто{" "}
          <span className="text-foreground">0/21 500</span> · Залишок{" "}
          <span className="text-foreground">26 пал / 21 500 кг</span>
        </div>

        {/* Product card */}
        <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-muted-foreground">#1</span>
            <button type="button" className="text-[12px] text-muted-foreground hover:text-foreground">
              Видалити
            </button>
          </div>

          <div className="space-y-3">
            <Row2>
              <Field label="Товар" value="Ківі" />
              <Field label="Походження" value="Італія" />
            </Row2>
            <Row2>
              <Field label="Сорт" value="Hayward" />
              <Field label="Бренд" value="3Frutti" />
            </Row2>
            <Row2>
              <Field label="Калібр" value="27" />
              <Field label="Клас" value="I" />
            </Row2>
            <Field label="Упаковка" value="Ящик 3.3 кг" full />
            <Row3>
              <Field label="Ящ./пал." value="84" />
              <Field label="К-ть палет" value="1" />
              <Field label="Вага палети" value="277.2" />
            </Row3>
            <Row2>
              <Field label="Нетто, кг" value="277.2" />
              <Field label="Брутто, кг" value="305.0" />
            </Row2>
            <Row2>
              <Field label="Ціна за кг" value="1.85" />
              <Field label="Валюта" value="EUR" />
            </Row2>
          </div>
        </section>

        {/* Add product */}
        <button
          type="button"
          className="w-full rounded-xl border border-dashed border-border bg-card/40 px-4 py-3 text-[13px] text-muted-foreground hover:bg-card"
        >
          + Додати товар
        </button>

        {/* Footer */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            className="h-11 flex-1 rounded-xl border border-border bg-card text-[14px] font-medium"
          >
            Назад
          </button>
          <button
            type="button"
            className="h-11 flex-[2] rounded-xl bg-primary text-[14px] font-semibold text-primary-foreground"
          >
            Готово
          </button>
        </div>

        <p className="pt-4 text-center text-[11px] text-muted-foreground/70">
          Візуальний прототип. Статичні дані. Не інтегровано.
        </p>
      </div>
    </div>
  );
}

function SummaryRow({ left, right }: { left: [string, string]; right: [string, string] }) {
  return (
    <div className="grid grid-cols-2 gap-3 py-1.5">
      <SummaryCell label={left[0]} value={left[1]} />
      <SummaryCell label={right[0]} value={right[1]} />
    </div>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="truncate text-[13px] font-semibold text-foreground">{value}</div>
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-border/60" />;
}

function Row2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function Row3({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-3">{children}</div>;
}

function Field({ label, value, full = false }: { label: string; value?: string; full?: boolean }) {
  return (
    <div className={full ? "col-span-full" : "min-w-0"}>
      <div className="mb-1 text-[11px] text-muted-foreground">{label}</div>
      <div className="flex h-10 items-center rounded-lg border border-border/70 bg-background/40 px-3 text-[13px] text-foreground">
        {value ?? <span className="text-muted-foreground/60">—</span>}
      </div>
    </div>
  );
}
