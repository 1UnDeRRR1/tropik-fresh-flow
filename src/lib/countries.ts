// Map English (or other) country names to Ukrainian display names.
// Internal logic / DB may store either form; UI must always show Ukrainian.

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
  macedonia: "Македонія",
  "north macedonia": "Македонія",
  // ISO codes
  gr: "Греція",
  it: "Італія",
  es: "Іспанія",
  nl: "Нідерланди",
  be: "Бельгія",
  pl: "Польща",
  md: "Молдова",
  al: "Албанія",
  mk: "Македонія",
  // Already Ukrainian (idempotent)
  греція: "Греція",
  італія: "Італія",
  іспанія: "Іспанія",
  нідерланди: "Нідерланди",
  бельгія: "Бельгія",
  польща: "Польща",
  молдова: "Молдова",
  албанія: "Албанія",
  македонія: "Македонія",
};

export function toUaCountry(value?: string | null): string {
  if (!value) return "";
  const key = value.trim().toLowerCase();
  return EN_TO_UK[key] ?? value;
}
