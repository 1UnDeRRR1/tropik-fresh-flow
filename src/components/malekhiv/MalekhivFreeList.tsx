import { MobileGlassTable, type MobileGlassRow } from "@/components/tropik/mobile-glass-table";
import { CostPair } from "@/components/CostPair";
import { toUaCountry } from "@/lib/countries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

// Local FreeRow shape mirrors the type used in routes/_authenticated/distribution.tsx.
export interface MalekhivFreeRow {
  itemId: string;
  shipmentId: string;
  code: string;
  eta: string | null;
  product: string;
  country: string | null;
  variety: string | null;
  caliber: string | null;
  brand: string | null;
  klass: string | null;
  palletWeight: number;
  free: number;
  weight: number;
  indicative: number | null;
  invoice: number | null;
  managerName: string | null;
}

const fmtEtaShort = (eta: string | null) => {
  if (!eta) return "—";
  const d = new Date(eta);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mo = d.toLocaleDateString("uk-UA", { month: "short" }).replace(/\.$/, "");
  return `${day}\u202F${mo}.`;
};

const fmtEta = (eta: string | null) =>
  eta
    ? new Date(eta).toLocaleDateString("uk-UA", { day: "2-digit", month: "long" })
    : "Без дати";

/**
 * Malekhiv "Вільно" list. L1/L2 only (no L3).
 *
 * L2 hosts the same direct insert to branch_requests (request_type='free_offer')
 * as the legacy Dialog. Insert logic is delegated to the parent through onSubmit.
 */
export function MalekhivFreeList({
  rows,
  drafts,
  onDraftChange,
  onSubmit,
  submitting,
  invalid,
  shake,
}: {
  rows: MalekhivFreeRow[];
  drafts: Record<string, { pallets: string; price: string; currency: string }>;
  onDraftChange: (
    itemId: string,
    patch: Partial<{ pallets: string; price: string; currency: string }>,
  ) => void;
  onSubmit: (row: MalekhivFreeRow) => void;
  submitting: string | null;
  invalid: Record<string, { pallets: boolean; price: boolean } | undefined>;
  shake: string | null;
}) {
  const glassRows: MobileGlassRow[] = rows.map((r) => {
    const countryFull = r.country ? toUaCountry(r.country) : "";
    const tailParts: string[] = [];
    if (countryFull) tailParts.push(countryFull);
    if (r.variety) tailParts.push(r.variety);
    const tail = tailParts.length ? ` · ${tailParts.join(" · ")}` : "";

    const extras: { label: string; value: string }[] = [];
    if (r.variety) extras.push({ label: "Сорт", value: r.variety });
    if (r.caliber) extras.push({ label: "Калібр", value: r.caliber });
    if (r.brand) extras.push({ label: "Бренд", value: r.brand });
    if (r.klass) extras.push({ label: "Клас", value: r.klass });

    const draft = drafts[r.itemId] ?? { pallets: String(r.free), price: "", currency: "UAH" };
    const inv = invalid[r.itemId];
    const isSubmitting = submitting === r.itemId;
    const isShaking = shake === r.itemId;

    const lines: MobileGlassRow["level2"] = {
      lines: [
        { id: "eta", left: "ETA", right: fmtEta(r.eta), rightTone: "sky" },
        { id: "code", left: "Поставка", right: r.code || "—" },
        {
          id: "pal",
          left: "Палети",
          right: `${r.free}п${r.weight > 0 ? ` · ${r.weight.toLocaleString("uk-UA")} кг` : ""}`,
        },
        ...(extras.length
          ? [{
              id: "extras",
              left: extras.map((x) => x.label).join(" · "),
              right: extras.map((x) => x.value).join(" · "),
            }]
          : []),
        ...(r.indicative != null || r.invoice != null
          ? [{
              id: "cost",
              left: "Собівартість",
              right: <CostPair indicative={r.indicative} invoice={r.invoice} suffix=" кг" size="xs" />,
            }]
          : []),
        ...(r.managerName ? [{ id: "mgr", left: "Менеджер", right: r.managerName }] : []),
      ],
      actions: (ctx): ReactNode => (
        <div className={cn("rounded-xl border border-white/10 p-3", isShaking && "animate-shake")}>
          <div className="mb-1.5 text-[11px] font-semibold opacity-70">Відправити пропозицію</div>
          <div className="grid grid-cols-[1fr_1.4fr_auto] gap-1.5 items-center">
            <Input
              type="number"
              min={1}
              max={r.free}
              value={draft.pallets}
              inputMode="numeric"
              placeholder="Палети"
              aria-label="Палети"
              onChange={(e) => {
                onDraftChange(r.itemId, { pallets: e.target.value });
                ctx.requestMeasure();
              }}
              className={cn("h-9 text-sm", inv?.pallets && "field-invalid")}
            />
            <div className="flex gap-1">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={draft.price}
                inputMode="decimal"
                placeholder="Ціна"
                aria-label="Ціна"
                onChange={(e) => {
                  onDraftChange(r.itemId, { price: e.target.value });
                  ctx.requestMeasure();
                }}
                className={cn("h-9 flex-1 text-sm", inv?.price && "field-invalid")}
              />
              <select
                value={draft.currency}
                onChange={(e) => onDraftChange(r.itemId, { currency: e.target.value })}
                className="h-9 rounded-md border border-input bg-transparent px-1.5 text-xs"
                aria-label="Валюта"
              >
                <option value="UAH">UAH</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </div>
            <Button onClick={() => onSubmit(r)} disabled={isSubmitting} size="sm" className="h-9 px-3">
              {isSubmitting ? "…" : "Відправити"}
            </Button>
          </div>
          <div className="mt-1 text-[10px] opacity-70">
            ≈ {(Number(draft.pallets || 0) * r.palletWeight).toLocaleString("uk-UA")} кг
          </div>
        </div>
      ),
    };

    return {
      id: r.itemId,
      level1: {
        mainLeft: (
          <>
            <strong>{r.product}</strong>
            {tail ? <span>{tail}</span> : null}
          </>
        ),
        mainRight: <>{r.free}п</>,
        metaLeft: (
          <>
            <span className="font-mono">ETA {fmtEtaShort(r.eta)}</span>
            {r.code ? <span> · {r.code}</span> : null}
            {r.managerName ? <span> · {r.managerName}</span> : null}
          </>
        ),
        metaRight: <CostPair indicative={r.indicative} invoice={r.invoice} suffix=" кг" size="xs" />,
      },
      level2: lines,
    };
  });

  return (
    <MobileGlassTable
      rows={glassRows}
      theme="inherit"
      summary={false}
      emptyState="Немає вільного товару"
      topSnap
    />
  );
}
