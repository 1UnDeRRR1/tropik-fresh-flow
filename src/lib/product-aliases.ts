const RAW_PRODUCT_NAME_ALIASES: Record<string, string> = {
  "kiwi": "Ківі",
  "kiwi kosh": "Ківі",
  "kiwi кош": "Ківі",
  "kiwi (kosh)": "Ківі",
  "киви": "Ківі",
  "киви кош": "Ківі",
  "киви (кош)": "Ківі",
  "ківі кош": "Ківі",
  "ківі (кош)": "Ківі",
};

export function normalizeProductKey(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/["'`´]/g, "")
    .replace(/\s*\/\s*/g, " ")
    .replace(/\s+/g, " ");
}

export const PRODUCT_NAME_ALIASES = Object.fromEntries(
  Object.entries(RAW_PRODUCT_NAME_ALIASES).map(([alias, canonical]) => [
    normalizeProductKey(alias),
    canonical,
  ]),
) as Record<string, string>;

export function canonicalizeProductName(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return "";
  return PRODUCT_NAME_ALIASES[normalizeProductKey(trimmed)] ?? trimmed;
}

export function resolveProductOption(value: string | null | undefined, options: string[]) {
  const normalizedInput = normalizeProductKey(value);
  if (!normalizedInput) return null;

  const direct = options.find((option) => normalizeProductKey(option) === normalizedInput);
  if (direct) return direct;

  const aliased = PRODUCT_NAME_ALIASES[normalizedInput];
  if (aliased) {
    return options.find((option) => normalizeProductKey(option) === normalizeProductKey(aliased)) ?? aliased;
  }

  const prefixed = options.filter((option) => normalizeProductKey(option).startsWith(normalizedInput));
  if (prefixed.length === 1) return prefixed[0];

  return null;
}