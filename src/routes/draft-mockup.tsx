import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/draft-mockup")({
  component: MockupPage,
});

/**
 * VISUAL-ONLY PROTOTYPE for /shipments/new product step — stage 1.
 * Static values. No Supabase, no hooks, no save, no nav.
 * Not wired into the real shipment flow.
 *
 * Stage 1 changes vs previous prototype:
 *  - Removed: page title, "Товари" heading, top "+ Додати товар".
 *  - Added:   sticky compact capacity strip (pallets / gross / remaining).
 *  - Resized: product card now fills full useful width of the container.
 *  - Moved:   "+ Додати товар" sits below last card, above Назад/Готово.
 *  - Customs / cost logic intentionally NOT built in this stage.
 */
function MockupPage() {
  const products = [
    {
      n: 1,
      product: "Ківі",
      origin: "Італія",
      sort: "Hayward",
      brand: "3Frutti",
      caliber: "27",
      cls: "I",
      pack: "Ящик 3.3 кг",
      boxesPerPallet: "84",
      pallets: "1",
      palletWeight: "277.2",
      net: "277.2",
      gross: "305.0",
      price: "1.85",
      currency: "EUR",
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Sticky compact capacity strip */}
      <div className="sticky top-0 z-30 border-b border-border/60 bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto w-full max-w-[460px] text-[12px] leading-tight">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
            <span className="text-muted-foreground">Палети</span>
            <span className="font-semibold text-foreground">12/26</span>
            <span className="text-border">·</span>
            <span className="text-muted-foreground">Брутто</span>
            <span className="font-semibold text-foreground">9 870/21 500</span>
            <span className="text-border">·</span>
            <span className="text-muted-foreground">Залишок</span>
            <span className="font-semibold text-foreground">14 пал / 11 630 кг</span>
          </div>
        </div>
      </div>

      <div className="px-2 pb-24 pt-2">
        <div className="mx-auto w-full max-w-[460px] space-y-3">
          {/* Shipment summary — compact, full width */}
          <section className="rounded-2xl border border-border bg-card p-3 shadow">
            <SummaryRow left={["Постачальник", "3FRUTTI"]} right={["Номер", "FRUTT-025-ITA-073"]} />
            <Divider />
            <SummaryRow left={["Країна", "Італія"]} right={["Завантаження", "2026-06-27"]} />
            <Divider />
            <SummaryRow left={["Транспорт", "3 200"]} right={["Валюта", "EUR"]} />
          </section>

          {/* Product cards — one per product, full width, stacked */}
          {products.map((p) => (
            <ProductCard key={p.n} p={p} />
          ))}

          {/* Add product — below last card, above footer */}
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

          <p className="pt-3 text-center text-[11px] text-muted-foreground/70">
            Візуальний прототип. Статичні дані. Не інтегровано.
          </p>
        </div>
      </div>
    </div>
  );
}

function ProductCard({
  p,
}: {
  p: {
    n: number;
    product: string;
    origin: string;
    sort: string;
    brand: string;
    caliber: string;
    cls: string;
    pack: string;
    boxesPerPallet: string;
    pallets: string;
    palletWeight: string;
    net: string;
    gross: string;
    price: string;
    currency: string;
  };
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-muted-foreground">#{p.n}</span>
        <button type="button" className="text-[12px] text-muted-foreground hover:text-foreground">
          Видалити
        </button>
      </div>

      <div className="space-y-3">
        <Row2>
          <Field label="Товар" value={p.product} />
          <Field label="Походження" value={p.origin} />
        </Row2>
        <Row2>
          <Field label="Сорт" value={p.sort} />
          <Field label="Бренд" value={p.brand} />
        </Row2>
        <Row2>
          <Field label="Калібр" value={p.caliber} />
          <Field label="Клас" value={p.cls} />
        </Row2>
        <Field label="Упаковка" value={p.pack} full />
        <Row3>
          <Field label="Ящ./пал." value={p.boxesPerPallet} />
          <Field label="К-ть палет" value={p.pallets} />
          <Field label="Вага палети" value={p.palletWeight} />
        </Row3>
        <Row2>
          <Field label="Нетто, кг" value={p.net} />
          <Field label="Брутто, кг" value={p.gross} />
        </Row2>
        <Row2>
          <Field label="Ціна за кг" value={p.price} />
          <Field label="Валюта" value={p.currency} />
        </Row2>

        {/* Reserved slot for future customs/cost line — visual only, no logic. */}
        <div className="mt-1 flex h-9 items-center justify-between rounded-lg border border-dashed border-border/60 bg-background/30 px-3 text-[11px] text-muted-foreground/70">
          <span>Митниця / собівартість</span>
          <span>зарезервовано</span>
        </div>
      </div>
    </section>
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
