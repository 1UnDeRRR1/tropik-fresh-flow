import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { InlineAutocomplete } from "@/components/InlineAutocomplete";
import { cn } from "@/lib/utils";
import { resolveProductOption } from "@/lib/product-aliases";
import { matchesWordStart } from "@/lib/compact-search";

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
  const [invalid, setInvalid] = useState(false);

  const trimmed = value.trim();
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

  const optionItems = useMemo(
    () => buildAutocompleteItems(normalizedOptions, aliases),
    [normalizedOptions, aliases],
  );

  useEffect(() => {
    if (invalid) setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleBlur = () => {
    // Auto-normalize alias -> canonical (e.g. "Italy" -> "Італія")
    const c = resolveCanonical(trimmed);
    if (c && c !== trimmed) {
      onChange(c);
      setInvalid(false);
      return;
    }
    if (required && trimmed && !c) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
  };

  return (
    <InlineAutocomplete
      value={value}
      onValueChange={(nextValue) => {
        if (invalid) setInvalid(false);
        onChange(nextValue);
      }}
      items={optionItems}
      getKey={(item) => item.key}
      getLabel={(item) => item.label}
      getSearchStrings={(item) => item.searchStrings}
      onSelect={(item) => {
        onChange(item.label);
        setInvalid(false);
      }}
      onInputBlur={handleBlur}
      onCommit={onCommit}
      placeholder={placeholder}
      readOnly={readOnly}
      browseLimit={5}
      searchLimit={3}
      minSearchLength={2}
      className="w-full"
      inputClassName={cn(
        "h-8 w-full border-transparent bg-transparent px-1.5 text-[12px] focus:border-input focus:bg-background",
        invalid && "border-destructive/70 ring-1 ring-destructive/40",
        readOnly && "cursor-default",
        className,
      )}
      renderItem={(item) => (
        <span className="block truncate">{item.label}</span>
      )}
      expandedMinWidth={expandedMinWidth}
    />
  );
}
