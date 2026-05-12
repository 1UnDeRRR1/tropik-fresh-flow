// Shared country search utilities for autocomplete & cost calc lookups.
// Canonical names come from the global `countries` table (UPPERCASE Ukrainian).
// Aliases map lowercased EN / RU / partial UA forms to a canonical UA string
// (case-insensitive — the actual option from DB wins).

export const COUNTRY_ALIASES: Record<string, string> = {
  // Greece
  greece: "Греція", gr: "Греція", греция: "Греція",
  // Italy
  italy: "Італія", it: "Італія", италия: "Італія",
  // Spain
  spain: "Іспанія", es: "Іспанія", испания: "Іспанія",
  // Netherlands
  netherlands: "Нідерланди", holland: "Нідерланди", nl: "Нідерланди",
  нидерланды: "Нідерланди", голландия: "Нідерланди",
  // Belgium
  belgium: "Бельгія", be: "Бельгія", бельгия: "Бельгія",
  // Poland
  poland: "Польща", pl: "Польща", польша: "Польща",
  // Moldova
  moldova: "Молдова", md: "Молдова", молдавия: "Молдова",
  // Albania
  albania: "Албанія", al: "Албанія", албания: "Албанія",
  // North Macedonia
  macedonia: "Північна Македонія",
  "north macedonia": "Північна Македонія",
  mk: "Північна Македонія",
  македония: "Північна Македонія",
  "северная македония": "Північна Македонія",
  северная: "Північна Македонія",
  північна: "Північна Македонія",
  // Turkey
  turkey: "Туреччина", tr: "Туреччина", турция: "Туреччина",
  // France
  france: "Франція", fr: "Франція", франция: "Франція",
  // Germany
  germany: "Німеччина", de: "Німеччина", германия: "Німеччина",
  // Portugal
  portugal: "Португалія", pt: "Португалія", португалия: "Португалія",
  // Romania
  romania: "Румунія", ro: "Румунія", румыния: "Румунія",
  // Serbia
  serbia: "Сербія", rs: "Сербія", сербия: "Сербія",
  // Georgia
  georgia: "Грузія", ge: "Грузія", грузия: "Грузія",
  // Egypt
  egypt: "Єгипет", eg: "Єгипет", египет: "Єгипет",
  // Morocco
  morocco: "Марокко", ma: "Марокко",
  // UK
  uk: "Велика Британія", britain: "Велика Британія",
  "united kingdom": "Велика Британія", великобритания: "Велика Британія",
  // USA
  usa: "США", us: "США",
  // South Africa
  "south africa": "ПАР", southafrica: "ПАР",
  // EU
  eu: "ЄС",
};

/** Find a canonical option matching `value` (case-insensitive) via direct match,
 *  alias map, or — if exactly one option contains the query as substring — that one.
 *  Returns null when ambiguous or unknown. */
export function resolveCountry(
  value: string,
  options: string[],
  aliases: Record<string, string> = COUNTRY_ALIASES,
): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const direct = options.find((o) => o.toLowerCase() === v);
  if (direct) return direct;
  const aliased = aliases[v];
  if (aliased) {
    const found = options.find((o) => o.toLowerCase() === aliased.toLowerCase());
    if (found) return found;
  }
  // Unique substring fallback (e.g. "македонія" → "ПІВНІЧНА МАКЕДОНІЯ")
  const subs = options.filter((o) => o.toLowerCase().includes(v));
  if (subs.length === 1) return subs[0];
  return null;
}

/** Suggestion list: substring match on canonical, plus alias targets whose key
 *  contains the query. Returns up to `limit` unique canonical strings. */
export function suggestCountries(
  value: string,
  options: string[],
  aliases: Record<string, string> = COUNTRY_ALIASES,
  limit = 8,
): string[] {
  const v = value.trim().toLowerCase();
  if (v.length < 2) return [];
  const direct = options.filter((o) => o.toLowerCase().includes(v));
  const viaAlias = Object.entries(aliases)
    .filter(([k]) => k.includes(v))
    .map(([, target]) => {
      const t = target.toLowerCase();
      return options.find((o) => o.toLowerCase() === t) ?? null;
    })
    .filter((x): x is string => !!x);
  // Prefer prefix matches first for relevance
  const ranked = Array.from(new Set([...direct, ...viaAlias])).sort((a, b) => {
    const ap = a.toLowerCase().startsWith(v) ? 0 : 1;
    const bp = b.toLowerCase().startsWith(v) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return a.localeCompare(b, "uk");
  });
  return ranked.slice(0, limit);
}
