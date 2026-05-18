import { Package, Cog, ClipboardList, Clock, PackageOpen, Truck, Building2, LogOut, Warehouse, Hourglass, XCircle, BadgeCheck, CheckCircle2 } from "lucide-react";
import type { ComponentType } from "react";

export type PipelineStatus =
  | "awaiting_confirmation"
  | "rejected"
  | "proposed"
  | "processing"
  | "confirmed"
  | "ordered"
  | "awaiting_loading"
  | "loading"
  | "in_transit"
  | "at_customs"
  | "left_customs"
  | "at_warehouse"
  | "unloaded";

export const PIPELINE_ORDER: PipelineStatus[] = [
  "awaiting_confirmation",
  "proposed",
  "processing",
  "confirmed",
  "ordered",
  "awaiting_loading",
  "loading",
  "in_transit",
  "at_customs",
  "left_customs",
  "at_warehouse",
  "unloaded",
];

export const PIPELINE_LABEL: Record<PipelineStatus, string> = {
  awaiting_confirmation: "Чекаю підтвердження",
  rejected: "Відмовлено",
  proposed: "Запропоновано",
  processing: "В опрацюванні",
  confirmed: "Підтверджено",
  ordered: "Замовлено",
  awaiting_loading: "Чекає завантаження",
  loading: "На завантаженні",
  in_transit: "В дорозі",
  at_customs: "На митниці",
  left_customs: "Їде на склад",
  at_warehouse: "На складі",
  unloaded: "Вивантажено",
};

export const PIPELINE_ICON: Record<PipelineStatus, ComponentType<{ className?: string }>> = {
  awaiting_confirmation: Hourglass,
  rejected: XCircle,
  proposed: Package,
  processing: Cog,
  confirmed: BadgeCheck,
  ordered: ClipboardList,
  awaiting_loading: Clock,
  loading: PackageOpen,
  in_transit: Truck,
  at_customs: Building2,
  left_customs: LogOut,
  at_warehouse: Warehouse,
  unloaded: CheckCircle2,
};

export const PIPELINE_TONE: Record<PipelineStatus, { bg: string; text: string; ring: string; glow: string }> = {
  awaiting_confirmation: { bg: "bg-yellow-100 dark:bg-yellow-900/30", text: "text-yellow-800 dark:text-yellow-200", ring: "ring-yellow-300/60", glow: "shadow-[0_0_12px_-2px_hsl(50_90%_55%/0.45)]" },
  rejected:         { bg: "bg-rose-100 dark:bg-rose-900/30",     text: "text-rose-800 dark:text-rose-200",     ring: "ring-rose-300/60",    glow: "shadow-[0_0_12px_-2px_hsl(350_75%_55%/0.45)]" },
  proposed:         { bg: "bg-slate-100 dark:bg-slate-800/50",   text: "text-slate-700 dark:text-slate-200",   ring: "ring-slate-300/60",   glow: "shadow-[0_0_12px_-2px_hsl(215_15%_60%/0.5)]" },
  processing:       { bg: "bg-amber-100 dark:bg-amber-900/30",   text: "text-amber-800 dark:text-amber-200",   ring: "ring-amber-300/60",   glow: "shadow-[0_0_12px_-2px_hsl(40_90%_55%/0.45)]" },
  confirmed:        { bg: "bg-green-100 dark:bg-green-900/30",   text: "text-green-800 dark:text-green-200",   ring: "ring-green-300/60",   glow: "shadow-[0_0_12px_-2px_hsl(140_60%_45%/0.45)]" },
  ordered:          { bg: "bg-indigo-100 dark:bg-indigo-900/30", text: "text-indigo-800 dark:text-indigo-200", ring: "ring-indigo-300/60", glow: "shadow-[0_0_12px_-2px_hsl(235_70%_60%/0.45)]" },
  awaiting_loading: { bg: "bg-teal-100 dark:bg-teal-900/30",     text: "text-teal-800 dark:text-teal-200",     ring: "ring-teal-300/60",    glow: "shadow-[0_0_12px_-2px_hsl(180_60%_45%/0.45)]" },
  loading:          { bg: "bg-violet-100 dark:bg-violet-900/30", text: "text-violet-800 dark:text-violet-200", ring: "ring-violet-300/60", glow: "shadow-[0_0_12px_-2px_hsl(265_65%_60%/0.5)]" },
  in_transit:       { bg: "bg-sky-100 dark:bg-sky-900/30",       text: "text-sky-800 dark:text-sky-200",       ring: "ring-sky-300/60",     glow: "shadow-[0_0_12px_-2px_hsl(210_85%_55%/0.5)]" },
  at_customs:       { bg: "bg-orange-100 dark:bg-orange-900/30", text: "text-orange-800 dark:text-orange-200", ring: "ring-orange-300/60", glow: "shadow-[0_0_12px_-2px_hsl(28_90%_55%/0.5)]" },
  left_customs:     { bg: "bg-cyan-100 dark:bg-cyan-900/30",     text: "text-cyan-800 dark:text-cyan-200",     ring: "ring-cyan-300/60",    glow: "shadow-[0_0_12px_-2px_hsl(195_85%_50%/0.5)]" },
  at_warehouse:     { bg: "bg-emerald-100 dark:bg-emerald-900/30", text: "text-emerald-800 dark:text-emerald-200", ring: "ring-emerald-300/60", glow: "shadow-[0_0_12px_-2px_hsl(150_60%_45%/0.5)]" },
  unloaded:         { bg: "bg-emerald-200 dark:bg-emerald-900/50", text: "text-emerald-900 dark:text-emerald-100", ring: "ring-emerald-400/60", glow: "shadow-[0_0_12px_-2px_hsl(150_70%_40%/0.55)]" },
};

export function pipelineProgress(s: PipelineStatus): number {
  return (PIPELINE_ORDER.indexOf(s) + 1) / PIPELINE_ORDER.length;
}
