const RAW_PRODUCT_NAME_ALIASES: Record<string, string> = {
  "kiwi": "Ківі",
  "kiwi kosh": "Ківі (кош)",
  "kiwi кош": "Ківі (кош)",
  "kiwi (kosh)": "Ківі (кош)",
  "киви": "Ківі",
  "киви кош": "Ківі (кош)",
  "киви (кош)": "Ківі (кош)",
  "ківі кош": "Ківі (кош)",
  "ківі (кош)": "Ківі (кош)",
};

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