import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/draft-mockup")({
  component: MockupPage,
});

/**
 * VISUAL-ONLY PROTOTYPE for /shipments/new product step — stage 3.
 * Static values. No Supabase, no save, no nav. Not wired into real flow.
 */
function MockupPage() {
  const [showCustoms, setShowCustoms] = useState(false);
  const [saveAttempt, setSaveAttempt] = useState(0);

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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function triggerSave() {
    setSaveAttempt((n) => n + 1);
    if (missing.length > 0 || netOverGross) {
      setShake(true);
      window.setTimeout(() => setShake(false), 450);
      if (netOverGross) setErrorMsg("Нетто не може перевищувати брутто");
      else setErrorMsg(`Заповніть обов'язкові поля (${missing.length})`);
      window.setTimeout(() => setErrorMsg(null), 3000);
    } else {
      setErrorMsg(null);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Fixed compact capacity strip */}
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
            className={`rounded-2xl border border-border bg-card p-3 shadow transition-all ${
              shake ? "animate-[shake_0.4s_ease-in-out]" : ""
            }`}
          >
            {/* Header */}
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
                <PillField label="Товар" required value={v.product} onChange={(x) => setV({ ...v, product: x })} saveAttempt={saveAttempt} />
                <PillField label="Походження" required value={v.origin} onChange={(x) => setV({ ...v, origin: x })} saveAttempt={saveAttempt} />
              </Row2>
              <Row2>
                <PillField label="Сорт" value={v.sort} onChange={(x) => setV({ ...v, sort: x })} />
                <PillField label="Бренд" value={v.brand} onChange={(x) => setV({ ...v, brand: x })} />
              </Row2>
              <Row2>
                <PillField label="Калібр" value={v.caliber} onChange={(x) => setV({ ...v, caliber: x })} />
                <PillField label="Клас" value={v.cls} onChange={(x) => setV({ ...v, cls: x })} />
              </Row2>
              <PillField label="Упаковка" required value={v.pack} onChange={(x) => setV({ ...v, pack: x })} saveAttempt={saveAttempt} />
              <Row3>
                <PillField label="Ящ./пал." value={v.boxes} onChange={(x) => setV({ ...v, boxes: x })} />
                <PillField label="К-ть палет" required value={v.pallets} onChange={(x) => setV({ ...v, pallets: x })} saveAttempt={saveAttempt} />
                <PillField label="Вага палети" value={v.palletW} onChange={(x) => setV({ ...v, palletW: x })} />
              </Row3>
              <Row2>
                <PillField label="Нетто, кг" required value={v.net} onChange={(x) => setV({ ...v, net: x })} saveAttempt={saveAttempt} invalid={netOverGross} />
                <PillField label="Брутто, кг" required value={v.gross} onChange={(x) => setV({ ...v, gross: x })} saveAttempt={saveAttempt} invalid={netOverGross} />
              </Row2>
              <Row2>
                <PillField label="Ціна за кг" required value={v.price} onChange={(x) => setV({ ...v, price: x })} saveAttempt={saveAttempt} />
                <PillField label="Валюта" value={v.currency} onChange={(x) => setV({ ...v, currency: x })} />
              </Row2>

              {/* Customs / cost calc */}
              <div className="mt-1 rounded-xl border border-border/60 bg-background/40 p-2.5">
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

          {/* Footer buttons */}
          <div className="space-y-1.5 pt-1">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={triggerSave}
                className="h-11 rounded-full border border-white/70 bg-primary text-[13px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                + Додати товар
              </button>
              <button
                type="button"
                onClick={triggerSave}
                className="h-11 rounded-full border border-primary/60 bg-primary/10 text-[13px] font-semibold text-primary"
              >
                + Аналогічний
              </button>
            </div>

            {/* Reserved error slot under "+ Додати товар" — left column width */}
            <div className="grid grid-cols-2 gap-2">
              <div className="min-h-[18px] px-1 text-[11px] leading-tight text-destructive/80">
                {errorMsg}
              </div>
              <ShinyRedButton onClick={triggerSave}>+ Створити</ShinyRedButton>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20% { transform: translateX(-6px); }
          40% { transform: translateX(6px); }
          60% { transform: translateX(-4px); }
          80% { transform: translateX(4px); }
        }
        @keyframes blink-ring {
          0%,100% { box-shadow: 0 0 0 0 hsl(var(--destructive) / 0); }
          50% { box-shadow: 0 0 0 3px hsl(var(--destructive) / 0.45); }
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

/**
 * Pill-shaped input field with floating-label behavior.
 *  - Empty + not focused: label centered, slightly blurred.
 *  - Focused: center label hides; corner label appears sharp at top-left;
 *             text input is left-aligned so typing flows naturally from the left.
 *  - Has value + not focused: corner label sharp at top-left;
 *             value centered horizontally and vertically.
 */
function PillField({
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

  useEffect(() => {
    if (saveAttempt > 0 && errored) setBlinkKey((k) => k + 1);
  }, [saveAttempt, errored]);

  const showCenterLabel = !focused && isEmpty;
  const showCornerLabel = focused || !isEmpty;

  return (
    <div
      key={blinkKey}
      className={`relative h-11 rounded-full border bg-muted/50 transition-colors ${
        errored && saveAttempt > 0
          ? "blink-error"
          : focused
          ? "border-primary/60"
          : "border-border/70"
      }`}
    >
      {showCornerLabel && (
        <span
          className={`pointer-events-none absolute left-4 top-1 z-10 text-[9px] font-medium uppercase tracking-wide leading-none text-muted-foreground/80`}
        >
          {label}
          {required && <span className="ml-0.5 text-destructive/70">*</span>}
        </span>
      )}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{ appearance: "none", WebkitAppearance: "none", background: "transparent" }}
        className={`absolute inset-0 h-full w-full rounded-full border-0 px-4 text-[13.5px] font-medium text-foreground outline-none focus:outline-none focus:ring-0 ${
          focused ? "text-left pt-3" : "text-center"
        }`}
      />
      {showCenterLabel && (
        <span
          className={`pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-muted-foreground/55`}
        >
          {label}
          {required && <span className="ml-0.5 text-muted-foreground/55">*</span>}
        </span>
      )}
    </div>
  );
}

/**
 * Red shiny button — mirrors the Malekhiv ShinyFilterSelect motion/sweep,
 * but tinted destructive (smoky red/crimson sweep) instead of grey.
 */
function ShinyRedButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const labelMask =
    "linear-gradient(-75deg, hsl(var(--destructive)) calc(var(--x) + 20%), hsl(0 0% 100%) calc(var(--x) + 25%), hsl(var(--destructive)) calc(var(--x) + 100%))";
  const ringGradient =
    "linear-gradient(-75deg, hsl(var(--destructive) / 0.3) calc(var(--x) + 20%), hsl(var(--destructive) / 1) calc(var(--x) + 25%), hsl(var(--destructive) / 0.3) calc(var(--x) + 100%))";

  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ "--x": "100%", scale: 0.98 } as any}
      animate={{ "--x": "-100%", scale: 1 } as any}
      whileTap={{ scale: 0.96 }}
      transition={{
        repeat: Infinity,
        repeatType: "loop",
        repeatDelay: 1,
        type: "spring",
        stiffness: 20,
        damping: 15,
        mass: 2,
        scale: { type: "spring", stiffness: 200, damping: 5, mass: 0.5 },
      }}
      style={{ ["--x" as string]: "100%" }}
      className="relative h-11 w-full rounded-full border border-destructive/50 bg-destructive/10 px-4 text-[13px] font-semibold backdrop-blur-xl transition-shadow duration-300 hover:shadow-[0_0_20px_hsl(var(--destructive)/0.25)]"
    >
      <span
        className="relative flex size-full items-center justify-center leading-none tracking-wide text-destructive"
        style={{ maskImage: labelMask, WebkitMaskImage: labelMask }}
      >
        {children}
      </span>
      <span
        aria-hidden="true"
        style={{
          mask: "linear-gradient(#000, #000) content-box, linear-gradient(#000, #000)",
          WebkitMask: "linear-gradient(#000, #000) content-box, linear-gradient(#000, #000)",
          maskComposite: "exclude",
          WebkitMaskComposite: "xor",
          backgroundImage: ringGradient,
        }}
        className="absolute inset-0 z-10 block rounded-[inherit] p-px"
      />
    </motion.button>
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
