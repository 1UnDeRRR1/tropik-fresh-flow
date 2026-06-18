import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/draft-mockup")({
  component: MockupPage,
});

/**
 * VISUAL-ONLY PROTOTYPE for /shipments/new product step — stage 2.
 * Static values. No Supabase, no save, no nav. Not wired into real flow.
 *
 * Changes vs stage 1:
 *  - removed shipment summary card; supplier + shipment number sit in card header
 *  - capacity strip is one line
 *  - "Видалити" is red
 *  - labels live INSIDE inputs, centered; vanish on focus, return when empty on blur
 *  - required field labels are red; missing required → shake + red ring on save
 *  - net > gross → shake + red ring + inline warning, blocks save
 *  - customs/cost calc block adapted from current editor (without removed lines)
 *  - "Назад" removed; two equal full-width buttons: Додати товар / Додати товар аналогічний
 *  - tuned to fit one mobile screen incl. footer
 */
function MockupPage() {
  const [showCustoms, setShowCustoms] = useState(false);
  const [saveAttempt, setSaveAttempt] = useState(0);

  // Static test values (one product card).
  const [v, setV] = useState({
    product: "Ківі",
    origin: "Італія",
    sort: "Hayward",
    brand: "3Frutti",
    caliber: "27",
    cls: "I",
    pack: "Ящик 3.3 кг",
    boxes: "84",
    pallets: "1",
    palletW: "277.2",
    net: "277.2",
    gross: "305.0",
    price: "1.85",
    currency: "EUR",
  });

  const netNum = Number(v.net) || 0;
  const grossNum = Number(v.gross) || 0;
  const netOverGross = netNum > 0 && grossNum > 0 && netNum > grossNum;

  const requiredKeys: (keyof typeof v)[] = ["product", "origin", "pack", "pallets", "net", "gross", "price"];
  const missing = requiredKeys.filter((k) => !String(v[k] ?? "").trim());

  const cardRef = useRef<HTMLDivElement>(null);
  const [shake, setShake] = useState(false);
  function triggerSave() {
    setSaveAttempt((n) => n + 1);
    if (missing.length > 0 || netOverGross) {
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Fixed compact capacity strip — single line */}
      <div className="fixed inset-x-0 top-0 z-50 border-b border-border/60 bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <div className="mx-auto flex w-full max-w-[460px] items-center justify-between gap-2 whitespace-nowrap text-[11.5px] leading-tight tabular-nums">
          <span><span className="text-muted-foreground">Палети </span><span className="font-semibold">12/26</span></span>
          <span className="text-border">·</span>
          <span><span className="text-muted-foreground">Брутто </span><span className="font-semibold">9 870/21 500</span></span>
          <span className="text-border">·</span>
          <span><span className="text-muted-foreground">Залишок </span><span className="font-semibold">14 / 11 630</span></span>
        </div>
      </div>

      <div className="px-2 pb-20 pt-11">
        <div className="mx-auto w-full max-w-[460px] space-y-2.5">
          <section
            ref={cardRef}
            className={`rounded-2xl border bg-card p-3 shadow transition-all ${
              shake ? "animate-[shake_0.4s_ease-in-out]" : ""
            } ${missing.length > 0 || netOverGross ? "border-border" : "border-border"}`}
          >
            {/* Header — supplier + shipment number, no labels */}
            <div className="mb-2.5 flex items-center justify-between gap-3 border-b border-border/60 pb-2">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold leading-tight">3FRUTTI</div>
                <div className="truncate text-[11px] text-muted-foreground">FRUTT-025-ITA-073</div>
              </div>
              <button
                type="button"
                className="shrink-0 text-[12px] font-medium text-destructive hover:text-destructive/80"
              >
                Видалити
              </button>
            </div>

            <div className="space-y-2">
              <Row2>
                <FloatField label="Товар" required value={v.product} onChange={(x) => setV({ ...v, product: x })} saveAttempt={saveAttempt} />
                <FloatField label="Походження" required value={v.origin} onChange={(x) => setV({ ...v, origin: x })} saveAttempt={saveAttempt} />
              </Row2>
              <Row2>
                <FloatField label="Сорт" value={v.sort} onChange={(x) => setV({ ...v, sort: x })} />
                <FloatField label="Бренд" value={v.brand} onChange={(x) => setV({ ...v, brand: x })} />
              </Row2>
              <Row2>
                <FloatField label="Калібр" value={v.caliber} onChange={(x) => setV({ ...v, caliber: x })} />
                <FloatField label="Клас" value={v.cls} onChange={(x) => setV({ ...v, cls: x })} />
              </Row2>
              <FloatField label="Упаковка" required value={v.pack} onChange={(x) => setV({ ...v, pack: x })} saveAttempt={saveAttempt} />
              <Row3>
                <FloatField label="Ящ./пал." value={v.boxes} onChange={(x) => setV({ ...v, boxes: x })} />
                <FloatField label="К-ть палет" required value={v.pallets} onChange={(x) => setV({ ...v, pallets: x })} saveAttempt={saveAttempt} />
                <FloatField label="Вага палети" value={v.palletW} onChange={(x) => setV({ ...v, palletW: x })} />
              </Row3>
              <Row2>
                <FloatField
                  label="Нетто, кг"
                  required
                  value={v.net}
                  onChange={(x) => setV({ ...v, net: x })}
                  saveAttempt={saveAttempt}
                  invalid={netOverGross}
                />
                <FloatField
                  label="Брутто, кг"
                  required
                  value={v.gross}
                  onChange={(x) => setV({ ...v, gross: x })}
                  saveAttempt={saveAttempt}
                  invalid={netOverGross}
                />
              </Row2>
              {netOverGross && (
                <div className="text-[11px] font-medium text-destructive">
                  Нетто не може перевищувати брутто
                </div>
              )}
              <Row2>
                <FloatField label="Ціна за кг" required value={v.price} onChange={(x) => setV({ ...v, price: x })} saveAttempt={saveAttempt} />
                <FloatField label="Валюта" value={v.currency} onChange={(x) => setV({ ...v, currency: x })} />
              </Row2>

              {/* Customs / cost calc — adapted from current editor */}
              <div className="mt-1 rounded-lg border border-border/60 bg-background/40 p-2.5">
                <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>Розрахунок собівартості</span>
                  <button
                    type="button"
                    className="text-[10px] font-normal text-primary hover:underline"
                    onClick={() => setShowCustoms((s) => !s)}
                  >
                    {showCustoms ? "сховати" : "деталі"}
                  </button>
                </div>
                <div className="space-y-0.5 text-[11.5px] tabular-nums">
                  <KV k="FX EUR/USD" v="1.1591 (2026-06-17)" />
                  <KVChip k="Митниця" chip={<span className="rounded-full border border-success/40 bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">Митна база: знайдено</span>} />
                  <KV k="Транспорт, $/кг" v="$0.1412" />
                </div>
                <div className="mt-1.5 flex items-center justify-between border-t border-border/40 pt-1.5 text-[12px] font-bold tabular-nums">
                  <span>Собівартість</span>
                  <span>
                    <span className="text-success">$1.59</span>
                    <span className="px-1 text-muted-foreground">/</span>
                    <span className="text-destructive">$1.59</span>
                  </span>
                </div>

                {showCustoms && (
                  <div className="mt-2 rounded-md border border-border/50 bg-card/60 p-2 text-[11px] tabular-nums">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Розрахунок митниці
                    </div>
                    <KV k="Аналог (товар)" v="Апельсин" />
                    <KV k="Аналог (країна)" v="АЛБАНІЯ (ЄС)" />
                    <KV k="Поріг ціни" v="$1.30/кг" />
                    <KV k="EUR1 %" v="0.00%" />
                    <div className="my-1 h-px bg-border/50" />
                    <KV k="Ціна за кг (USD)" v="$1.1591" />
                    <div className="text-muted-foreground">Ціна ≤ порогу → мито = індикатив = <b className="text-foreground">$0.2850</b></div>
                    <div className="mt-1 flex justify-between font-semibold text-success"><span>Індикативне мито</span><span>$0.2850</span></div>
                    <div className="flex justify-between font-semibold text-destructive"><span>Інвойсне мито</span><span>$0.2850</span></div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Footer — two equal full-width buttons */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={triggerSave}
              className="h-11 rounded-xl bg-primary text-[13px] font-semibold text-primary-foreground"
            >
              + Додати товар
            </button>
            <button
              type="button"
              onClick={triggerSave}
              className="h-11 rounded-xl border border-primary/60 bg-primary/10 text-[13px] font-semibold text-primary"
            >
              + Аналогічний
            </button>
          </div>
        </div>
      </div>

      {/* keyframes for shake */}
      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
        @keyframes blink-ring {
          0%,100% { box-shadow: 0 0 0 0 hsl(var(--destructive) / 0); border-color: hsl(var(--destructive)); }
          50% { box-shadow: 0 0 0 3px hsl(var(--destructive) / 0.35); border-color: hsl(var(--destructive)); }
        }
        .blink-error { animation: blink-ring 0.45s ease-in-out 2; border-color: hsl(var(--destructive)) !important; }
      `}</style>
    </div>
  );
}

function Row2({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2">{children}</div>;
}
function Row3({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-3 gap-2">{children}</div>;
}

function FloatField({
  label,
  value,
  onChange,
  required = false,
  saveAttempt = 0,
  invalid = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  saveAttempt?: number;
  invalid?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const [blinkKey, setBlinkKey] = useState(0);

  const isEmpty = !String(value ?? "").trim();
  const missingRequired = required && isEmpty;
  const errored = missingRequired || invalid;

  // Trigger blink whenever the user attempts to save while invalid.
  useEffect(() => {
    if (saveAttempt > 0 && errored) setBlinkKey((k) => k + 1);
  }, [saveAttempt, errored]);

  // Label visibility: hidden on focus; visible otherwise (whether empty or filled — sits centered above value).
  // When focused → input shows value only. When blurred → if empty, show label centered; if filled, show value centered with label as tiny tag.
  const showLabelCentered = !focused && isEmpty;

  return (
    <div className="relative">
      <div
        key={blinkKey}
        className={`relative flex h-11 items-center justify-center rounded-lg border bg-background/40 px-2 transition-colors ${
          errored && saveAttempt > 0 ? "blink-error" : "border-border/70"
        }`}
      >
        {/* Tiny corner label when field has a value and isn't focused */}
        {!focused && !isEmpty && (
          <span
            className={`absolute left-2 top-0.5 text-[9.5px] leading-none ${
              required ? "text-destructive/80" : "text-muted-foreground/70"
            }`}
          >
            {label}
          </span>
        )}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="h-full w-full bg-transparent text-center text-[13.5px] font-medium text-foreground outline-none placeholder:font-normal"
          placeholder={
            showLabelCentered ? "" /* placeholder replaced by overlay */ : ""
          }
        />
        {showLabelCentered && (
          <span
            className={`pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] ${
              required ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium">{v}</span>
    </div>
  );
}
function KVChip({ k, chip }: { k: string; chip: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{k}</span>
      {chip}
    </div>
  );
}
