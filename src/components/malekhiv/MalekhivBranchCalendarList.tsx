import { MobileGlassTable, type MobileGlassRow } from "@/components/tropik/mobile-glass-table";
import { CostPair } from "@/components/CostPair";
import { toUaCountry } from "@/lib/countries";

const WEEKDAYS_UK = ["Неділя", "Понеділок", "Вівторок", "Середа", "Четвер", "Пʼятниця", "Субота"];
const MONTHS_UK = [
  "січня", "лютого", "березня", "квітня", "травня", "червня",
  "липня", "серпня", "вересня", "жовтня", "листопада", "грудня",
];

const fmtEtaShort = (eta: string | null) => {
  if (!eta) return "—";
  const d = new Date(eta);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mo = d.toLocaleDateString("uk-UA", { month: "short" }).replace(/\.$/, "");
  return `${day}\u202F${mo}.`;
};

export interface MalekhivCalendarEntry {
  key: string;
  arrival: string;
  pallets: number;
  ship: { id: string; code: string; eta: string | null; arrived_at: string | null; country: string | null; import_manager_name: string | null };
  item: {
    id: string;
    product_name: string;
    origin_country: string | null;
    variety: string | null;
    brand: string | null;
    class: string | null;
    caliber: string | null;
    pallet_weight: number | null;
    final_cost_indicative: number | null;
    final_cost_invoice: number | null;
  };
}

/**
 * Malekhiv "Календар" list. Groups entries by day like the legacy view, but
 * each entry is a MobileGlassTable card. Only branch-specific allocated
 * quantity/weight is exposed — no aggregate math on top.
 */
export function MalekhivBranchCalendarList({
  grouped,
}: {
  grouped: { iso: string; date: Date; entries: MalekhivCalendarEntry[] }[];
}) {
  return (
    <div className="space-y-3">
      {grouped.map((day) => {
        const dayPallets = day.entries.reduce((s, e) => s + e.pallets, 0);
        const headerTitle = `${WEEKDAYS_UK[day.date.getDay()]} · ${day.date.getDate()} ${MONTHS_UK[day.date.getMonth()]}`;
        const rows: MobileGlassRow[] = day.entries.map((e) => {
          const rawCountry = e.item.origin_country || e.ship.country || "";
          const countryFull = rawCountry ? toUaCountry(rawCountry) : "";
          const tailParts: string[] = [];
          if (countryFull) tailParts.push(countryFull);
          if (e.item.variety) tailParts.push(e.item.variety);
          const tail = tailParts.length ? ` · ${tailParts.join(" · ")}` : "";
          const weight = Number(e.item.pallet_weight ?? 0) * e.pallets;

          const extras: { label: string; value: string }[] = [];
          if (e.item.variety) extras.push({ label: "Сорт", value: e.item.variety });
          if (e.item.caliber) extras.push({ label: "Калібр", value: e.item.caliber });
          if (e.item.brand) extras.push({ label: "Бренд", value: e.item.brand });
          if (e.item.class) extras.push({ label: "Клас", value: e.item.class });

          return {
            id: e.key,
            level1: {
              mainLeft: (
                <>
                  <strong>{e.item.product_name}</strong>
                  {tail ? <span>{tail}</span> : null}
                </>
              ),
              mainRight: <>{e.pallets}п</>,
              metaLeft: (
                <>
                  {e.ship.code ? <span className="font-mono">{e.ship.code}</span> : null}
                  {e.ship.import_manager_name ? (
                    <span>{e.ship.code ? " · " : ""}{e.ship.import_manager_name}</span>
                  ) : null}
                </>
              ),
              metaRight: (
                <CostPair
                  indicative={e.item.final_cost_indicative}
                  invoice={e.item.final_cost_invoice}
                  suffix=" кг"
                  size="xs"
                />
              ),
            },
            level2: {
              lines: [
                {
                  id: "eta",
                  left: "Дата прибуття",
                  right: e.ship.arrived_at ?? e.ship.eta ?? "—",
                  rightTone: "sky",
                },
                { id: "code", left: "Поставка", right: e.ship.code || "—" },
                {
                  id: "pal",
                  left: "Палети (по філії)",
                  right: `${e.pallets}п${weight > 0 ? ` · ${weight.toFixed(0)} кг` : ""}`,
                },
                ...(extras.length
                  ? [{
                      id: "extras",
                      left: extras.map((x) => x.label).join(" · "),
                      right: extras.map((x) => x.value).join(" · "),
                    }]
                  : []),
                ...(e.item.final_cost_indicative != null || e.item.final_cost_invoice != null
                  ? [{
                      id: "cost",
                      left: "Собівартість",
                      right: (
                        <CostPair
                          indicative={e.item.final_cost_indicative}
                          invoice={e.item.final_cost_invoice}
                          suffix=" кг"
                          size="xs"
                        />
                      ),
                    }]
                  : []),
                ...(e.ship.import_manager_name
                  ? [{ id: "mgr", left: "Менеджер", right: e.ship.import_manager_name }]
                  : []),
              ],
            },
          };
        });
        return (
          <section key={day.iso} className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-300">
                {headerTitle}
              </h2>
              <span className="text-sm font-bold tabular-nums text-brand">{dayPallets}п · ETA {fmtEtaShort(day.iso)}</span>
            </div>
            <MobileGlassTable rows={rows} theme="inherit" summary={false} topSnap={false} />
          </section>
        );
      })}
    </div>
  );
}
