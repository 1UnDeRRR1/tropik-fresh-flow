// Maps pipeline status values to the new visual status icon package
// (public/status-icons/svg/status_NN.svg). UI-only — does not change any
// status values, formulas, RLS, POSITION ID, resolver, or business logic.

import type { PipelineStatus } from "@/lib/pipeline-status";

// status_01 — очікую підтвердження
// status_02 — підтверджено
// status_03 — замовлено
// status_04 — очікує завантаження
// status_05 — завантаження
// status_06 — в дорозі
// status_07 — на митниці
// status_08 — на складі
export type StatusIconKey =
  | "status_01"
  | "status_02"
  | "status_03"
  | "status_04"
  | "status_05"
  | "status_06"
  | "status_07"
  | "status_08";

const MAP: Partial<Record<PipelineStatus, StatusIconKey>> = {
  awaiting_confirmation: "status_01",
  proposed: "status_01",
  processing: "status_01",
  confirmed: "status_02",
  ordered: "status_03",
  awaiting_loading: "status_04",
  loading: "status_05",
  in_transit: "status_06",
  at_customs: "status_07",
  left_customs: "status_06",
  at_warehouse: "status_08",
  unloaded: "status_08",
};

export function statusIconFor(status: PipelineStatus): StatusIconKey | null {
  return MAP[status] ?? null;
}

export function statusIconSrc(key: StatusIconKey): string {
  return `/status-icons/svg/${key}.svg`;
}

// Solid color used to tint the textual status label inside the detail popup.
// Picked to harmonise with PIPELINE_TONE but expressed as a single hex so the
// popup title can apply it directly.
export const STATUS_TEXT_COLOR: Record<PipelineStatus, string> = {
  awaiting_confirmation: "#B45309", // amber-700
  rejected: "#BE123C",              // rose-700
  cancelled: "#991B1B",             // red-800
  proposed: "#475569",              // slate-600
  processing: "#0369A1",            // sky-700
  confirmed: "#15803D",             // green-700
  ordered: "#3730A3",               // indigo-800
  awaiting_loading: "#0F766E",      // teal-700
  loading: "#6D28D9",               // violet-700
  in_transit: "#1D4ED8",            // blue-700
  at_customs: "#9F1239",            // rose/bordeaux
  left_customs: "#0E7490",          // cyan-700
  at_warehouse: "#047857",          // emerald-700
  unloaded: "#365314",              // lime-900
};
