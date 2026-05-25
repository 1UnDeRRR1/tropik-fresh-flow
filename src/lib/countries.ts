// Phase 0 — country canonicalization is DB-backed via alias-cache.
// No hardcoded EN→UA map. Signature kept sync; cache miss → title-case identity.

import { getCountryAliases } from "@/lib/alias-cache";

function titleCaseUk(value: string): string {
  return value
    .toLocaleLowerCase("uk")
    .split(/(\s+|-)/)
    .map((part) => {
      if (!part || /^(\s+|-)$/.test(part)) return part;
      const first = part.charAt(0).toLocaleUpperCase("uk");
      return first + part.slice(1);
    })
    .join("");
}

/**
 * Canonicalize any country string to a single display form.
 * - Trims whitespace
 * - Maps EN names / ISO codes to Ukrainian via DB-backed alias cache
 * - Falls back to Title Case for unknown inputs (same behavior as legacy map miss)
 */
export function toUaCountry(value?: string | null): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const key = trimmed.toLocaleLowerCase("uk");
  const mapped = getCountryAliases()[key];
  return mapped ?? titleCaseUk(trimmed);
}

/** Alias for clarity at call sites that store/normalize values. */
export const normalizeCountry = toUaCountry;
