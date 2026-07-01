import type { ReactNode } from "react";
import type { MobileGlassDetailLine, MobileGlassTone } from "./types";

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function hasRenderableValue(value: ReactNode): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}

export function compactDetailLines(
  lines: MobileGlassDetailLine[] | undefined,
): MobileGlassDetailLine[] {
  if (!lines?.length) return [];

  return lines.filter((line) => {
    return hasRenderableValue(line.left) || hasRenderableValue(line.right);
  });
}

export function toneClass(tone: MobileGlassTone | undefined, side: "left" | "right") {
  if (!tone || tone === "default") return "";

  return `tmg-tone-${side}-${tone}`;
}
