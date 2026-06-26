import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { InlineAutocomplete } from "@/components/InlineAutocomplete";
import { cn } from "@/lib/utils";
import { resolveProductOption } from "@/lib/product-aliases";
import { matchesWordStart } from "@/lib/compact-search";
import { triggerInvalidFeedback } from "@/lib/invalid-feedback";

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
  strict = false,
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
  /**
   * When true (create-flow strict mode): on blur with an unmatched value
   * the input is cleared, the field flashes 3 times, the screen shakes
   * and the device vibrates. Default keeps prior, non-destructive
   * "mark invalid" behavior for the saved editor.
   */
  strict?: boolean;
}) {
  const [invalid, setInvalid] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const trimmed = value.trim();
  const normalizedOptions = useMemo(
    () => Array.from(new Set(options.map((option) => option.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "uk")),
    [options],
  );

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
    const subs = normalizedOptions.filter((o) => matchesWordStart(o, l));
    if (subs.length === 1) return subs[0];
    return null;
  };

  const optionItems = useMemo(
    () =>
      normalizedOptions.map((option) => {
        const lower = option.toLowerCase();
        const aliasStrings = aliases
          ? Object.entries(aliases)
              .filter(([, target]) => target.toLowerCase() === lower)
              .map(([alias]) => alias)
          : [];
        return {
          key: option,
          label: option,
          searchStrings: Array.from(new Set([option, ...aliasStrings])).filter(Boolean),
        };
      }),
    [normalizedOptions, aliases],
  );

  useEffect(() => {
    if (invalid) setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleBlur = () => {
    const c = resolveCanonical(trimmed);
    if (c && c !== trimmed) {
      onChange(c);
      setInvalid(false);
      return;
    }
    if (required && trimmed && !c) {
      setInvalid(true);
      triggerInvalidFeedback(wrapperRef.current);
      if (strict) {
        // Clear unrecognized value after the flash completes so the user
        // sees what was rejected first.
        window.setTimeout(() => onChange(""), 700);
      }
      return;
    }
    setInvalid(false);
  };

  return (
    <div ref={wrapperRef} className="w-full">
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
        searchLimit={5}
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
    </div>
  );
}
