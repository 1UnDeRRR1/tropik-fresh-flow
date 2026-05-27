import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { resolveProductOption } from "@/lib/product-aliases";
import { MOBILE_ENTER_KEY_HINT, scrollFocusedIntoView } from "@/lib/mobile-input";
import { matchesWordStart } from "@/lib/compact-search";

// Basic Ukrainian -> Latin transliteration so typing "Хі" can match "HELLENIC".
const UA_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie",
  ж: "zh", з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l",
  м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ь: "",
  ю: "iu", я: "ia", "'": "",
};
function uaToLat(s: string) {
  return s.toLowerCase().split("").map((ch) => UA_LAT[ch] ?? ch).join("");
}

// Basic Latin -> Ukrainian (rough) to support typing English for UA options.
const LAT_UA: Record<string, string> = {
  a: "а", b: "б", c: "к", d: "д", e: "е", f: "ф", g: "г", h: "х",
  i: "і", j: "й", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п",
  q: "к", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "кс",
  y: "и", z: "з",
};
function latToUa(s: string) {
  return s.toLowerCase().split("").map((ch) => LAT_UA[ch] ?? ch).join("");
}

function matchesQuery(option: string, query: string) {
  if (!query) return false;
  const o = option.toLowerCase();
  const q = query.toLowerCase();
  if (matchesWordStart(o, q)) return true;
  if (matchesWordStart(o, uaToLat(q))) return true;
  if (matchesWordStart(o, latToUa(q))) return true;
  if (matchesWordStart(uaToLat(o), uaToLat(q))) return true;
  return false;
}

const FOCUS_STYLE =
  "border-brand bg-background ring-2 ring-brand/40";

export function AutocompleteCell({
  value,
  onChange,
  options,
  aliases,
  placeholder,
  expandedMinWidth,
  className,
  required = true,
  readOnly = false,
  onCommit,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  /** map of lowercase alias -> canonical option (e.g. "italy" -> "Італія") */
  aliases?: Record<string, string>;
  placeholder?: string;
  expandedMinWidth?: number;
  className?: string;
  required?: boolean;
  readOnly?: boolean;
  onCommit?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const acceptingRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  const normalizedOptions = useMemo(
    () => Array.from(new Set(options.map((option) => option.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "uk")),
    [options],
  );

  // Resolve an input string to a canonical option (UA), or null.
  const resolveCanonical = (s: string): string | null => {
    const l = s.trim().toLowerCase();
    if (!l) return null;
    if (!aliases) {
      const productResolved = resolveProductOption(s, normalizedOptions);
      if (productResolved) return productResolved;
    }
    const direct = normalizedOptions.find((o) => o.toLowerCase() === l);
    if (direct) return direct;
    if (aliases && aliases[l]) {
      const target = aliases[l].toLowerCase();
      const aliased = normalizedOptions.find((o) => o.toLowerCase() === target);
      if (aliased) return aliased;
      return aliases[l];
    }
    // Unique prefix fallback (e.g. "македон" → "ПІВНІЧНА МАКЕДОНІЯ" only if it's the sole prefix match)
    const subs = normalizedOptions.filter((o) => matchesWordStart(o, l));
    if (subs.length === 1) return subs[0];
    return null;
  };

  const canonical = resolveCanonical(trimmed);
  const isExactMatch = !trimmed || !!canonical;

  // Suggestions: prefix match only, after 2+ characters, max 3 rows.
  const aliasMatchedCanonicals = aliases
    ? Object.entries(aliases)
        .filter(([k]) => matchesWordStart(k, lower) && lower.length >= 2)
        .map(([, v]) => {
          const t = v.toLowerCase();
          return normalizedOptions.find((o) => o.toLowerCase() === t) ?? v;
        })
    : [];
  const suggestions =
    trimmed.length >= 2 && (!canonical || canonical.toLowerCase() !== lower)
      ? Array.from(
          new Set([
            ...normalizedOptions.filter((o) => matchesQuery(o, trimmed)),
            ...aliasMatchedCanonicals,
          ]),
        ).slice(0, 3)
      : [];

  useEffect(() => {
    if (invalid) setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const accept = (s: string) => {
    onChange(s);
    setInvalid(false);
    setTimeout(() => {
      inputRef.current?.blur();
      setFocused(false);
      onCommit?.();
    }, 0);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (acceptingRef.current) {
      acceptingRef.current = false;
      setFocused(false);
      return;
    }
    // Auto-normalize alias -> canonical (e.g. "Italy" -> "Італія")
    const c = resolveCanonical(trimmed);
    if (c && c !== trimmed) {
      onChange(c);
      setInvalid(false);
      setFocused(false);
      onCommit?.();
      return;
    }
    if (required && trimmed && !c) {
      e.preventDefault();
      setInvalid(true);
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    setInvalid(false);
    setFocused(false);
    onCommit?.();
  };

  return (
    <>
      <Input
        ref={inputRef}
        value={value}
        readOnly={readOnly}
        placeholder={focused ? "" : placeholder}
        enterKeyHint={MOBILE_ENTER_KEY_HINT}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          if (readOnly) return;
          setFocused(true);
          e.currentTarget.select();
          scrollFocusedIntoView(e.currentTarget);
        }}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if ((e.key === "Tab" || e.key === "Enter") && suggestions[0]) {
            e.preventDefault();
            accept(suggestions[0]);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            inputRef.current?.blur();
            return;
          }
          if (e.key === "Escape") {
            inputRef.current?.blur();
          }
        }}
        style={focused && expandedMinWidth ? { minWidth: expandedMinWidth } : undefined}
        className={cn(
          "h-8 w-full border-transparent bg-transparent px-1.5 text-[12px] focus:border-input focus:bg-background",
          focused && FOCUS_STYLE,
          invalid && "border-destructive/70 ring-1 ring-destructive/40",
          readOnly && "cursor-default",
          className,
        )}
      />
      {focused && !readOnly && suggestions.length > 0 && (
        <div
          className="absolute left-0 top-[calc(100%+2px)] z-50 w-full min-w-0 max-w-[min(18rem,85vw)] overflow-hidden rounded-md border border-border bg-popover/95 shadow-xl backdrop-blur"
          onMouseDown={(e) => e.preventDefault()}
        >
          {suggestions.map((s) => {
            const pick = () => {
              acceptingRef.current = true;
              accept(s);
            };
            return (
              <button
                key={s}
                type="button"
                style={{ touchAction: "manipulation" }}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); pick(); }}
                onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); pick(); }}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); pick(); }}
                className="block w-full truncate px-3 py-2 text-left text-[13px] text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent"
              >
                {s}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
