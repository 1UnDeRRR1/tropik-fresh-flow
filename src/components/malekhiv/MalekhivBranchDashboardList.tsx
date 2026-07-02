import type { ReactNode } from "react";
import { MobileGlassTable, type MobileGlassRow } from "@/components/tropik/mobile-glass-table";
import { CostPair } from "@/components/CostPair";
import { toUaCountry } from "@/lib/countries";
import { OfferAllocationForm } from "@/components/OfferAllocationForm";
import { Button } from "@/components/ui/button";

// Row shape mirrored (structurally) from dashboard/branch.tsx to avoid
// exporting the local Row type across module boundaries.
export interface MalekhivBranchRow {
  key: string;
  shipment_item_id: string;
  distribution_id: string;
  code: string;
  eta: string | null;
  product: string;
  country: string | null;
  caliber: string | null;
  variety: string | null;
  brand: string | null;
  class: string | null;
  manager_name: string | null;
  pallets: number;
  weight: number;
  indicative: number | null;
  invoice: number | null;
  baseline_eta: string | null;
  baseline_pallets: number | null;
  baseline_ind: number | null;
  baseline_inv: number | null;
  is_real_shipment_code: boolean;
}

const fmtEtaShort = (eta: string | null) => {
  if (!eta) return "—";
  const d = new Date(eta);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mo = d.toLocaleDateString("uk-UA", { month: "short" }).replace(/\.$/, "");
  return `${day}\u202F${mo}.`;
};

const fmtD = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("uk-UA");
};

/**
 * Malekhiv-only render of the branch "Головна" list.
 *
 * L1 — compact row (product/country/pallets + ETA/code/manager/cost).
 * L2 — expanded details (weight, extras, price, manager, baseline diffs)
 *      plus the ETA-lock aware "Запропонувати філії" action.
 * L3 — inline OfferAllocationForm (variant="inline"), replacing the previous
 *      Sheet-based OfferDialog for Malekhiv only.
 *
 * ETA-lock behavior preserved 1:1 with the legacy Dialog path:
 *   free <= 0                 → action block hidden;
 *   free > 0 && offerLocked   → warning + disabled "Запропонувати філії";
 *   free > 0 && !offerLocked  → active "Запропонувати філії" opens L3.
 */
export function MalekhivBranchDashboardList({
  rows,
  statsFor,
  isBranchOfferLockedByEta,
}: {
  rows: MalekhivBranchRow[];
  statsFor: (r: {
    distribution_id: string;
    shipment_item_id: string;
    pallets: number;
  }) => { pending: number; accepted: number; free: number };
  isBranchOfferLockedByEta: (eta: string | null | undefined) => boolean;
}) {
  const glassRows: MobileGlassRow[] = rows.map((r) => {
    const countryFull = r.country ? toUaCountry(r.country) : "";
    const tailParts: string[] = [];
    if (countryFull) tailParts.push(countryFull);
    if (r.variety) tailParts.push(r.variety);
    const tail = tailParts.length ? ` · ${tailParts.join(" · ")}` : "";

    // Baseline change hints
    const etaChanged = !!r.baseline_eta && r.baseline_eta !== r.eta;
    const palletsChanged =
      r.baseline_pallets != null && Number(r.baseline_pallets) !== Number(r.pallets);
    const indChanged =
      r.baseline_ind != null && Number(r.baseline_ind) !== Number(r.indicative ?? 0);
    const invChanged =
      r.baseline_inv != null && Number(r.baseline_inv) !== Number(r.invoice ?? 0);

    const extras: { label: string; value: string }[] = [];
    if (r.variety) extras.push({ label: "Сорт", value: r.variety });
    if (r.caliber) extras.push({ label: "Калібр", value: r.caliber });
    if (r.brand) extras.push({ label: "Бренд", value: r.brand });
    if (r.class) extras.push({ label: "Клас", value: r.class });

    const lines: MobileGlassRow["level2"] = {
      lines: [
        { id: "eta", left: "ETA", right: fmtD(r.eta), rightTone: "sky" },
        { id: "code", left: "Поставка", right: r.code || "—" },
        {
          id: "pal",
          left: "Палети",
          right: `${r.pallets}п${r.weight > 0 ? ` · ${r.weight.toFixed(0)} кг` : ""}`,
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
        ...(r.manager_name
          ? [{ id: "mgr", left: "Менеджер", right: r.manager_name }]
          : []),
        ...(etaChanged
          ? [{
              id: "d-eta",
              left: "Дата змінена",
              right: `${fmtD(r.baseline_eta)} → ${fmtD(r.eta)}`,
              rightTone: "warning" as const,
            }]
          : []),
        ...(palletsChanged
          ? [{
              id: "d-p",
              left: "Кількість змінена",
              right: `${r.baseline_pallets}п → ${r.pallets}п`,
              rightTone: "warning" as const,
            }]
          : []),
        ...(indChanged
          ? [{
              id: "d-ind",
              left: "Собівартість інд.",
              right: `${Number(r.baseline_ind).toFixed(2)} → ${Number(r.indicative ?? 0).toFixed(2)}`,
              rightTone: "warning" as const,
            }]
          : []),
        ...(invChanged
          ? [{
              id: "d-inv",
              left: "Собівартість інв.",
              right: `${Number(r.baseline_inv).toFixed(2)} → ${Number(r.invoice ?? 0).toFixed(2)}`,
              rightTone: "warning" as const,
            }]
          : []),
      ],
      actions: (ctx) => {
        if (!r.is_real_shipment_code) return null;
        const s = statsFor({
          distribution_id: r.distribution_id,
          shipment_item_id: r.shipment_item_id,
          pallets: r.pallets,
        });
        if (s.free <= 0) return null;
        const offerLocked = isBranchOfferLockedByEta(r.eta);
        return (
          <div className="space-y-2">
            {offerLocked ? (
              <div className="rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
                За 24 години до ETA пропозиція філіям недоступна.
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                disabled={offerLocked}
                onClick={() => { if (!offerLocked) ctx.openLevelThree(); }}
              >
                Запропонувати філії ({s.free}п)
              </Button>
            </div>
          </div>
        );
      },
    };

    // L3 — inline allocation form. free may be 0 (guarded above), but the
    // form itself will be entered only through openLevelThree, which the L2
    // button withholds when free<=0 or ETA-locked.
    const level3 = {
      render: (ctx: {
        closeLevelThree: () => void;
        closeCard: () => void;
        requestMeasure: () => void;
      }): ReactNode => {
        const s = statsFor({
          distribution_id: r.distribution_id,
          shipment_item_id: r.shipment_item_id,
          pallets: r.pallets,
        });
        return (
          <OfferAllocationForm
            variant="inline"
            item={{
              shipment_item_id: r.shipment_item_id,
              distribution_id: r.distribution_id,
              product_name: r.product,
              caliber: r.caliber,
              available_pallets: s.free,
              shipment_code: r.code,
              shipment_eta: r.eta,
            }}
            onSizeChange={ctx.requestMeasure}
            onCancel={ctx.closeLevelThree}
            onSubmitted={ctx.closeCard}
          />
        );
      },
    };

    return {
      id: r.key,
      level1: {
        mainLeft: (
          <>
            <strong>{r.product}</strong>
            {tail ? <span>{tail}</span> : null}
          </>
        ),
        mainRight: <>{r.pallets}п</>,
        metaLeft: (
          <>
            <span className="font-mono">ETA {fmtEtaShort(r.eta)}</span>
            {r.code ? <span> · {r.code}</span> : null}
            {r.manager_name ? <span> · {r.manager_name}</span> : null}
          </>
        ),
        metaRight: <CostPair indicative={r.indicative} invoice={r.invoice} suffix=" кг" size="xs" />,
      },
      level2: lines,
      level3,
    };
  });

  return (
    <MobileGlassTable
      rows={glassRows}
      theme="inherit"
      summary={false}
      emptyState="Поки немає підтвердженого товару"
      className="mx-auto"
      topSnap
    />
  );
}
