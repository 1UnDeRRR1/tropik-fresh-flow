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

export interface MobileGlassLevelTwo {
  lines?: MobileGlassDetailLine[];
  actions?: ReactNode;
}

export interface MobileGlassRow {
  id: string;
  level1: MobileGlassLevelOne;
  level2?: MobileGlassLevelTwo;
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
