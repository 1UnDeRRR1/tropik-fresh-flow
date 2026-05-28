// Shared item construction for reference-field autocompletes.
//
// Both Нова поставка (товарні позиції) and Нова пропозиція (manager offers)
// must produce identical suggestions for the same input. This module is the
// single source of search strings (canonical label + translit + aliases) so
// the underlying InlineAutocomplete applies the same word-start matching
// and direct-vs-alias ranking everywhere.
//
// Forbidden by spec: hardcoded country/product/caliber/packaging lists or
// alias maps in frontend. We only build searchStrings from data passed in
// (options + aliases coming from the DB-backed hooks).

const UA_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie",
  ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "",
  ю: "iu", я: "ia", "'": "",
};
const LAT_UA: Record<string, string> = {
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х",
  i: "і", j: "й", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п",
  q: "к", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс",
  y: "и", z: "з",
};

export function uaToLat(s: string) {
  return s.toLowerCase().split("").map((ch) => UA_LAT[ch] ?? ch).join("");
}
export function latToUa(s: string) {
  return s.toLowerCase().split("").map((ch) => LAT_UA[ch] ?? ch).join("");
}

export type AutocompleteItem = {
  key: string;
  label: string;
  searchStrings: string[];
};

/**
 * Build autocomplete items from a list of canonical options and an optional
 * alias map (alias_normalized -> canonical option). Each item's searchStrings
 * includes:
 *   - canonical label
 *   - UA↔LAT transliterations of the canonical label
 *   - every alias whose target equals this canonical option (plus translit)
 *
 * Caller is expected to sort `options` upstream; this function preserves the
 * incoming order so InlineAutocomplete's "direct vs alias-only" ranking is
 * deterministic.
 */
export function buildAutocompleteItems(
  options: string[],
  aliases?: Record<string, string>,
): AutocompleteItem[] {
  const normalizedOptions = Array.from(
    new Set(options.map((o) => o.trim()).filter(Boolean)),
  );
  return normalizedOptions.map((option) => {
    const lowerOption = option.toLowerCase();
    const aliasStrings = aliases
      ? Object.entries(aliases)
          .filter(([, target]) => target.toLowerCase() === lowerOption)
          .flatMap(([alias]) => [alias, uaToLat(alias), latToUa(alias)])
      : [];
    return {
      key: option,
      label: option,
      searchStrings: Array.from(
        new Set([
          option,
          uaToLat(option),
          latToUa(option),
          ...aliasStrings,
        ]),
      ).filter(Boolean),
    };
  });
}
