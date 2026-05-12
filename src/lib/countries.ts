// Map English (or other) country names to Ukrainian display names.
// Internal logic / DB may store either form; UI must always show Ukrainian
// in a single canonical Title Case form (e.g. "Італія", not "ІТАЛІЯ").

const EN_TO_UK: Record<string, string> = {
  greece: "Греція",
  italy: "Італія",
  spain: "Іспанія",
  netherlands: "Нідерланди",
  holland: "Нідерланди",
  belgium: "Бельгія",
  poland: "Польща",
  moldova: "Молдова",
  albania: "Албанія",
  macedonia: "Північна Македонія",
  "north macedonia": "Північна Македонія",
  france: "Франція",
  germany: "Німеччина",
  turkey: "Туреччина",
  azerbaijan: "Азербайджан",
  china: "Китай",
  egypt: "Єгипет",
  morocco: "Марокко",
  // ISO codes
  gr: "Греція",
  it: "Італія",
  es: "Іспанія",
  nl: "Нідерланди",
  be: "Бельгія",
  pl: "Польща",
  md: "Молдова",
  al: "Албанія",
  mk: "Північна Македонія",
  fr: "Франція",
  de: "Німеччина",
  tr: "Туреччина",
  az: "Азербайджан",
  cn: "Китай",
  eg: "Єгипет",
  ma: "Марокко",
  // Already Ukrainian (idempotent, lowercase keys)
  греція: "Греція",
  італія: "Італія",
  іспанія: "Іспанія",
  нідерланди: "Нідерланди",
  бельгія: "Бельгія",
  польща: "Польща",
  молдова: "Молдова",
  албанія: "Албанія",
  македонія: "Північна Македонія",
  "північна македонія": "Північна Македонія",
  франція: "Франція",
  німеччина: "Німеччина",
  туреччина: "Туреччина",
  азербайджан: "Азербайджан",
  китай: "Китай",
  єгипет: "Єгипет",
  марокко: "Марокко",
};

// Title-case a multi-word string using locale 'uk' so words like
// "ПІВНІЧНА МАКЕДОНІЯ" → "Північна Македонія".
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
 * - Maps EN names / ISO codes to Ukrainian
 * - Returns Title Case (e.g. "Італія", "Північна Македонія")
 * Use this for BOTH display and grouping keys so "ІТАЛІЯ" and "Італія"
 * collapse to the same value across the system.
 */
export function toUaCountry(value?: string | null): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const key = trimmed.toLocaleLowerCase("uk");
  const mapped = EN_TO_UK[key];
  return mapped ?? titleCaseUk(trimmed);
}

/** Alias for clarity at call sites that store/normalize values. */
export const normalizeCountry = toUaCountry;
