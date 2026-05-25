// Phase 0 — runtime product alias resolution is DB-backed via alias-cache.
// No hardcoded alias map. Signatures kept sync; cache miss → identity fallback.

import { getProductAliases } from "@/lib/alias-cache";

export function normalizeProductKey(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/["'`´]/g, "")
    .replace(/\s*\/\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalizeProductName(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  const aliases = getProductAliases();
  return aliases[normalizeProductKey(trimmed)] ?? trimmed;
}

export function resolveProductOption(value: string | null | undefined, options: string[]) {
  const normalizedInput = normalizeProductKey(value);
  if (!normalizedInput) return null;

  const direct = options.find((option) => normalizeProductKey(option) === normalizedInput);
  if (direct) return direct;

  const aliases = getProductAliases();
  const aliased = aliases[normalizedInput];
  if (aliased) {
    return options.find((option) => normalizeProductKey(option) === normalizeProductKey(aliased)) ?? aliased;
  }

  const prefixed = options.filter((option) => normalizeProductKey(option).startsWith(normalizedInput));
  if (prefixed.length === 1) return prefixed[0];

  return null;
}
