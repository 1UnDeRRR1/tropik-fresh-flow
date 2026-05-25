// Phase 0 — country alias resolution / suggestion is DB-backed via alias-cache.
// No hardcoded COUNTRY_ALIASES constant. Signatures kept sync; cache miss is
// safe (resolveCountry returns null; suggestCountries returns []), identical
// to legacy behavior on unknown input.

import { getCountryAliases } from "@/lib/alias-cache";

/** Find a canonical option matching `value` (case-insensitive) via direct match,
 *  alias map, or — if exactly one option contains the query as substring — that one.
 *  Returns null when ambiguous or unknown. */
export function resolveCountry(
  value: string,
  options: string[],
  aliases: Record<string, string> = getCountryAliases(),
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
  // Unique prefix fallback
  const subs = options.filter((o) => o.toLowerCase().startsWith(v));
  if (subs.length === 1) return subs[0];
  return null;
}

/** Suggestion list: PREFIX match only on canonical, plus alias targets whose key
 *  starts with the query. Returns up to `limit` (max 3) unique canonical strings. */
export function suggestCountries(
  value: string,
  options: string[],
  aliases: Record<string, string> = getCountryAliases(),
  limit = 3,
): string[] {
  const v = value.trim().toLowerCase();
  if (v.length < 2) return [];
  const direct = options.filter((o) => o.toLowerCase().startsWith(v));
  const viaAlias = Object.entries(aliases)
    .filter(([k]) => k.startsWith(v))
    .map(([, target]) => {
      const t = target.toLowerCase();
      return options.find((o) => o.toLowerCase() === t) ?? null;
    })
    .filter((x): x is string => !!x);
  const ranked = Array.from(new Set([...direct, ...viaAlias])).sort((a, b) =>
    a.localeCompare(b, "uk"),
  );
  return ranked.slice(0, Math.min(limit, 3));
}
