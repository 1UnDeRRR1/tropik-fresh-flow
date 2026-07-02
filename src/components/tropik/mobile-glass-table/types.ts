import type { ReactNode } from "react";

export type MobileGlassTheme = "dark" | "light" | "inherit";

export type MobileGlassTone =
  | "default"
  | "muted"
  | "success"
  | "danger"
  | "warning"
  | "sky";

export interface MobileGlassLevelOne {
  mainLeft: ReactNode;
  mainRight?: ReactNode;
  metaLeft?: ReactNode;
  metaRight?: ReactNode;
}

export interface MobileGlassDetailLine {
  id?: string;
  left?: ReactNode;
  right?: ReactNode;
  leftTone?: MobileGlassTone;
  rightTone?: MobileGlassTone;
  className?: string;
  leftClassName?: string;
  rightClassName?: string;
}

/**
 * Runtime handles passed to L2 `actions` render fn and L3 `render` fn.
 *
 * A `ResizeObserver` is installed on the active detail-inner element, so
 * `requestMeasure` is a manual safety valve — call it after synchronous
 * DOM mutations that the observer might not catch in time. Normal
 * content growth (async data load, form state change) is handled
 * automatically.
 */
export interface MobileGlassLevelContext {
  openLevelThree: () => void;
  closeLevelThree: () => void;
  closeCard: () => void;
  requestMeasure: () => void;
}

export interface MobileGlassLevelTwo {
  lines?: MobileGlassDetailLine[];
  actions?: ReactNode | ((ctx: MobileGlassLevelContext) => ReactNode);
}

export interface MobileGlassLevelThree {
  render: (ctx: MobileGlassLevelContext) => ReactNode;
}

export interface MobileGlassRow {
  id: string;
  level1: MobileGlassLevelOne;
  level2?: MobileGlassLevelTwo;
  level3?: MobileGlassLevelThree;
  disabled?: boolean;
  className?: string;
}

export interface MobileGlassTableProps {
  rows: MobileGlassRow[];
  theme?: MobileGlassTheme;
  summary?: ReactNode | false;
  emptyState?: ReactNode;
  className?: string;
  trackClassName?: string;
  topSnap?: boolean;
  closeCurrentBeforeOpenNext?: boolean;
  animationMs?: number;
  closeLockMs?: number;
  topOffsetPx?: number;
  bottomOffsetPx?: number;
  onOpenChange?: (rowId: string | null) => void;
}
