import * as React from "react";
import { useMemo } from "react";

import { InlineAutocomplete } from "@/components/InlineAutocomplete";
import { cn } from "@/lib/utils";
import { matchesWordStart } from "@/lib/compact-search";

/**
 * Free-text input that suggests varieties for the currently selected product.
 *
 * Behavior (mobile compact fix):
 * - Suggestions only by word-start.
 * - Maximum 3 rows.
 * - Compact dropdown anchored to the current input.
 * - Variety remains optional — empty value is allowed.
 */
export function VarietyAutocomplete({
  value,
  onChange,
  varieties,
  placeholder,
  className,
  inputClassName,
  disabled,
  onCommit,
  expandedMinWidth,
}: {
  value: string;
  onChange: (v: string) => void;
  varieties: string[];
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  onCommit?: () => void;
  expandedMinWidth?: number;
}) {
  const items = useMemo(
    () => Array.from(new Set(varieties.map((item) => item.trim()).filter(Boolean))).map((item) => ({
      key: item,
      label: item,
      searchStrings: [item].filter((candidate) => matchesWordStart(candidate, value) || !value.trim()),
    })),
    [value, varieties],
  );

  return (
    <InlineAutocomplete
      value={value}
      onValueChange={onChange}
      items={items}
      getKey={(item) => item.key}
      getLabel={(item) => item.label}
      getSearchStrings={(item) => item.searchStrings}
      onSelect={(item) => onChange(item.label)}
      onCommit={onCommit}
      placeholder={placeholder}
      className={cn("w-full", className)}
      inputClassName={inputClassName}
      disabled={disabled}
      expandedMinWidth={expandedMinWidth}
      browseLimit={50}
      searchLimit={3}
      minSearchLength={2}
      renderItem={(item) => <span className="block truncate">{item.label}</span>}
    />
  );
}

