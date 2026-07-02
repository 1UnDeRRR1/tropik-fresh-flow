import type { PipelineStatus } from "@/lib/pipeline-status";
import { CostPair } from "@/components/CostPair";
import { Button } from "@/components/ui/button";
import { toUaCountry } from "@/lib/countries";

/**
 * Block 1 — Malekhiv Головна L2 drill content, extracted from the previous
 * Dialog body in dashboard/branch.tsx. Rendered inline under a compact L1
 * row inside <InlineExpansion>. No DialogHeader/DialogContent chrome.
 */

export type DrillRow = {
  key: string;
  distribution_id: string;
  shipment_item_id: string;
  code: string;
  eta: string | null;
  product: string;
  country: string | null;
  caliber: string | null;
  variety: string | null;
  brand: string | null;
  class: string | null;
  packaging: string | null;
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
  pipeline?: PipelineStatus;
};

function fmtDate(s: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("uk-UA");
}

function isOfferLockedByEta(eta: string | null | undefined) {
  if (!eta) return false;
  const etaDate = new Date(`${eta}T00:00:00`);
  if (Number.isNaN(etaDate.getTime())) return false;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = (etaDate.getTime() - todayStart.getTime()) / 86400000;
  return diffDays <= 1;
}

export function BranchDrillContent({
  row,
  freePallets,
  onOfferClick,
}: {
  row: DrillRow;
  /** How many pallets are still free to be offered to other branches. */
  freePallets: number;
  onOfferClick: () => void;
}) {
  const country = row.country ? toUaCountry(row.country) : "";
  const extras: Array<{ label: string; value: string }> = [];
  if (row.variety) extras.push({ label: "Сорт", value: row.variety });
  if (row.caliber) extras.push({ label: "Калібр", value: row.caliber });
  if (row.brand) extras.push({ label: "Бренд", value: row.brand });
  if (row.class) extras.push({ label: "Клас", value: row.class });
  if (row.packaging) extras.push({ label: "Упаковка", value: row.packaging });

  const etaChanged = !!row.baseline_eta && row.baseline_eta !== row.eta;
  const palletsChanged =
    row.baseline_pallets != null &&
    Number(row.baseline_pallets) !== Number(row.pallets);
  const indChanged =
    row.baseline_ind != null &&
    Number(row.baseline_ind) !== Number(row.indicative ?? 0);
  const invChanged =
    row.baseline_inv != null &&
    Number(row.baseline_inv) !== Number(row.invoice ?? 0);
  const anyChange = etaChanged || palletsChanged || indChanged || invChanged;

  const offerLocked = isOfferLockedByEta(row.eta);
  const showOfferBlock = row.is_real_shipment_code && freePallets > 0;

  return (
    <div className="space-y-3">
      <div className="text-base font-semibold text-foreground">
        {row.product}
        {country ? <span> · {country}</span> : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-secondary px-2 py-1.5">
          <div className="text-[10px] text-info">ETA</div>
          <div className="text-sm font-bold tabular-nums text-info">{row.eta ?? "—"}</div>
          <div className="mt-1 text-[11px] font-mono text-muted-foreground">{row.code}</div>
        </div>
        <div className="rounded-lg bg-secondary px-2 py-1.5 text-right">
          <div className="text-[10px] text-muted-foreground">Палети</div>
          <div className="text-sm font-bold tabular-nums text-brand">{row.pallets}п</div>
          {row.weight > 0 ? (
            <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">
              {row.weight.toFixed(0)} кг
            </div>
          ) : null}
        </div>
      </div>

      {extras.length ? (
        <ul className="space-y-1 rounded-xl border border-border px-3 py-2 text-xs">
          {extras.map((x) => (
            <li key={x.label} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{x.label}:</span>
              <span className="font-medium text-foreground">{x.value}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {(row.indicative != null || row.invoice != null) ? (
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-xs">
          <span className="text-muted-foreground">Собівартість</span>
          <CostPair indicative={row.indicative} invoice={row.invoice} suffix=" кг" size="sm" />
        </div>
      ) : null}

      {row.manager_name ? (
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-xs">
          <span className="text-muted-foreground">Менеджер</span>
          <span className="font-medium text-foreground">{row.manager_name}</span>
        </div>
      ) : null}

      {anyChange ? (
        <div className="space-y-1">
          {etaChanged ? (
            <div className="rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
              <b>Дата змінена:</b>{" "}
              <span className="line-through tabular-nums">{fmtDate(row.baseline_eta)}</span>{" "}
              → стало <b className="tabular-nums">{fmtDate(row.eta)}</b>
            </div>
          ) : null}
          {palletsChanged ? (
            <div className="rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
              <b>Кількість змінена:</b>{" "}
              <span className="line-through tabular-nums">{row.baseline_pallets}п</span>{" "}
              → стало <b className="tabular-nums">{row.pallets}п</b>
            </div>
          ) : null}
          {indChanged ? (
            <div className="rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
              <b>Собівартість індикативна:</b>{" "}
              <span className="line-through tabular-nums">
                {Number(row.baseline_ind).toFixed(2)}
              </span>{" "}
              → стало{" "}
              <b className="tabular-nums">{Number(row.indicative ?? 0).toFixed(2)}</b>
            </div>
          ) : null}
          {invChanged ? (
            <div className="rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
              <b>Собівартість інвойсна:</b>{" "}
              <span className="line-through tabular-nums">
                {Number(row.baseline_inv).toFixed(2)}
              </span>{" "}
              → стало{" "}
              <b className="tabular-nums">{Number(row.invoice ?? 0).toFixed(2)}</b>
            </div>
          ) : null}
        </div>
      ) : null}

      {showOfferBlock ? (
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
              onClick={() => {
                if (offerLocked) return;
                onOfferClick();
              }}
            >
              Запропонувати філії ({freePallets}п)
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
