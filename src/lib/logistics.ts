export type LogisticsStatus =
  | "pending_planning"
  | "planning"
  | "vehicle_assigned"
  | "ready_for_loading"
  | "loading"
  | "in_transit"
  | "at_customs"
  | "delayed"
  | "arrived";

export const LOGISTICS_STATUS_LABEL: Record<LogisticsStatus, string> = {
  pending_planning: "Очікує авто",
  planning: "Планування",
  vehicle_assigned: "Авто призначено",
  ready_for_loading: "Готово до завантаження",
  loading: "На завантаженні",
  in_transit: "В дорозі",
  at_customs: "На митниці",
  delayed: "Затримка",
  arrived: "Прибув",
};

export const LOGISTICS_STATUS_CLASS: Record<LogisticsStatus, string> = {
  pending_planning: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200",
  planning: "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200",
  vehicle_assigned: "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-200",
  ready_for_loading: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
  loading: "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-200",
  in_transit: "bg-blue-100 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200",
  at_customs: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-200",
  delayed: "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-200",
  arrived: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200",
};

export type LogisticsFilter = "all" | "incoming" | "assigned" | "loading" | "transit";

export const LOGISTICS_FILTER_LABEL: Record<LogisticsFilter, string> = {
  all: "Всі",
  incoming: "Очікує авто",
  assigned: "Авто призначено",
  loading: "На завантаженні",
  transit: "В дорозі",
};

export const LOGISTICS_FILTER_STATUSES: Record<LogisticsFilter, LogisticsStatus[] | null> = {
  all: null,
  incoming: ["pending_planning", "planning"],
  assigned: ["vehicle_assigned", "ready_for_loading"],
  loading: ["loading"],
  transit: ["in_transit", "at_customs", "delayed"],
};
