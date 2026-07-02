import type { PipelineStatus } from "@/lib/pipeline-status";
import { Button } from "@/components/ui/button";
import { toUaCountry } from "@/lib/countries";

/**
 * Block 1 — Malekhiv Головна L2 drill content.
 *
 * VISUAL CONTRACT: a single glass panel under L1. No nested cards, no
 * rounded-lg bg-secondary blocks, no card-in-card. All info sits directly
 * inside one flat surface (`.bie-l2-glass` in inline-expansion.css).
 * Business logic and text preserved; only the visual substrate is flattened.
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

function fmtMoney(n: number | null | undefined) {
  if (n == null) return null;
  return Number(n).toFixed(2);
}

export function BranchDrillContent({
  row,
  freePallets,
  onOfferClick,
}: {
  row: DrillRow;
  freePallets: number;
  onOfferClick: () => void;
}) {
  const country = row.country ? toUaCountry(row.country) : "";
  const rows: Array<{ label: string; value: React.ReactNode }> = [];
  rows.push({ label: "ETA", value: row.eta ?? "—" });
  rows.push({
    label: "Палети",
    value: (
      <>
        <span className="tabular-nums">{row.pallets}п</span>
        {row.weight > 0 ? (
          <span className="ml-2 text-muted-foreground tabular-nums">
            · {row.weight.toFixed(0)} кг
          </span>
        ) : null}
      </>
    ),
  });
  rows.push({ label: "Код", value: <span className="font-mono">{row.code}</span> });
  if (row.variety) rows.push({ label: "Сорт", value: row.variety });
  if (row.caliber) rows.push({ label: "Калібр", value: row.caliber });
  if (row.brand) rows.push({ label: "Бренд", value: row.brand });
  if (row.class) rows.push({ label: "Клас", value: row.class });
  if (row.packaging) rows.push({ label: "Упаковка", value: row.packaging });
  if (row.indicative != null) {
    rows.push({
      label: "Собівартість (інд.)",
      value: <span className="tabular-nums">{fmtMoney(row.indicative)} / кг</span>,
    });
  }
  if (row.invoice != null) {
    rows.push({
      label: "Собівартість (інв.)",
      value: <span className="tabular-nums">{fmtMoney(row.invoice)} / кг</span>,
    });
  }
  if (row.manager_name) rows.push({ label: "Менеджер", value: row.manager_name });

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

  const changes: Array<{ label: string; before: string; after: string }> = [];
  if (etaChanged) {
    changes.push({
      label: "Дата",
      before: fmtDate(row.baseline_eta),
      after: fmtDate(row.eta),
    });
  }
  if (palletsChanged) {
    changes.push({
      label: "Кількість",
      before: `${row.baseline_pallets}п`,
      after: `${row.pallets}п`,
    });
  }
  if (indChanged) {
    changes.push({
      label: "Собів. інд.",
      before: Number(row.baseline_ind).toFixed(2),
      after: Number(row.indicative ?? 0).toFixed(2),
    });
  }
  if (invChanged) {
    changes.push({
      label: "Собів. інв.",
      before: Number(row.baseline_inv).toFixed(2),
      after: Number(row.invoice ?? 0).toFixed(2),
    });
  }

  const offerLocked = isOfferLockedByEta(row.eta);
  const showOfferBlock = row.is_real_shipment_code && freePallets > 0;

  return (
    <section className="bie-l2-glass">
      <header className="bie-l2-title">
        {row.product}
        {country ? <span className="bie-l2-title-sub"> · {country}</span> : null}
      </header>

      <dl className="bie-l2-list">
        {rows.map((r) => (
          <div key={r.label} className="bie-l2-item">
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>

      {changes.length ? (
        <ul className="bie-l2-changes">
          {changes.map((c) => (
            <li key={c.label}>
              <b>{c.label}:</b>{" "}
              <span className="bie-l2-strike tabular-nums">{c.before}</span>
              {" → "}
              <b className="tabular-nums">{c.after}</b>
            </li>
          ))}
        </ul>
      ) : null}

      {showOfferBlock ? (
        <div className="bie-l2-actions">
          {offerLocked ? (
            <span className="bie-l2-note">
              За 24 години до ETA пропозиція філіям недоступна.
            </span>
          ) : null}
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
      ) : null}
    </section>
  );
}
