import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

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

function startsWithAny(option: string, query: string) {
  if (!query) return false;
  const o = option.toLowerCase();
  const q = query.toLowerCase();
  if (o.startsWith(q)) return true;
  // try translit both directions
  if (o.startsWith(uaToLat(q))) return true;
  if (o.startsWith(latToUa(q))) return true;
  if (uaToLat(o).startsWith(uaToLat(q))) return true;
  return false;
}

const EXPANDED =
  "absolute left-0 top-[calc(100%+10px)] z-40 h-10 min-w-[160px] w-max max-w-[85vw] rounded-md border border-border bg-card text-sm shadow-xl ring-2 ring-brand/50";

export function AutocompleteCell({
  value,
  onChange,
  options,
  placeholder,
  expandedMinWidth,
  className,
  required = true,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  expandedMinWidth?: number;
  className?: string;
  // when true, blur is blocked unless value matches an option (or is empty)
  required?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const acceptingRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  const isExactMatch =
    !trimmed || options.some((o) => o.toLowerCase() === lower);

  const suggestions =
    trimmed.length >= 2 && !isExactMatch
      ? options.filter((o) => startsWithAny(o, trimmed)).slice(0, 6)
      : [];

  // typing always clears invalid state
  useEffect(() => {
    if (invalid) setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const accept = (s: string) => {
    onChange(s);
    setInvalid(false);
    // close on accept
    setTimeout(() => {
      inputRef.current?.blur();
      setFocused(false);
    }, 0);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    if (acceptingRef.current) {
      acceptingRef.current = false;
      setFocused(false);
      return;
    }
    if (required && trimmed && !isExactMatch) {
      e.preventDefault();
      setInvalid(true);
      setTimeout(() => inputRef.current?.focus(), 0);
      return;
    }
    setInvalid(false);
    setFocused(false);
  };

  return (
    <>
      <Input
        ref={inputRef}
        value={value}
        placeholder={focused ? "" : placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if ((e.key === "Tab" || e.key === "Enter") && suggestions[0]) {
            e.preventDefault();
            accept(suggestions[0]);
          }
          if (e.key === "Escape") {
            inputRef.current?.blur();
          }
        }}
        style={focused && expandedMinWidth ? { minWidth: expandedMinWidth } : undefined}
        className={cn(
          "h-8 border-transparent bg-transparent px-1.5 text-[12px] focus:border-input focus:bg-background",
          focused && EXPANDED,
          invalid && "!border-destructive !bg-destructive/15 ring-2 ring-destructive/60",
          className,
        )}
      />
      {focused && suggestions.length > 0 && (
        <div className="absolute left-0 top-[calc(100%+54px)] z-50 min-w-[180px] max-w-[85vw] overflow-hidden rounded-md border border-border bg-popover/95 shadow-xl backdrop-blur">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onPointerDown={(e) => {
                e.preventDefault();
                acceptingRef.current = true;
                accept(s);
              }}
              onTouchStart={(e) => {
                e.preventDefault();
                acceptingRef.current = true;
                accept(s);
              }}
              className="block w-full truncate px-3 py-2 text-left text-[13px] text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
