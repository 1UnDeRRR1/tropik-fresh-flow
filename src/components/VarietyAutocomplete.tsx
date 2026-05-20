import * as React from "react";
import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Free-text input that suggests varieties for the currently selected product.
 * - Suggestions show only after the 2nd character is typed.
 * - Match is prefix-only (case-insensitive), in input order.
 * - At most 3 suggestions visible at once.
 * - Accepts any free-form value (varieties are not restricted to the list).
 */
export function VarietyAutocomplete({
  value,
  onChange,
  varieties,
  placeholder,
  className,
  inputClassName,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  varieties: string[];
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const acceptingRef = useRef(false);
  const [focused, setFocused] = useState(false);

  const trimmed = value.trim();
  const q = trimmed.toLowerCase();
  const suggestions =
    trimmed.length >= 2 && varieties.length > 0
      ? varieties.filter((v) => v.toLowerCase().startsWith(q) && v.toLowerCase() !== q).slice(0, 3)
      : [];

  const accept = (s: string) => {
    onChange(s);
    setTimeout(() => {
      inputRef.current?.blur();
      setFocused(false);
    }, 0);
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        ref={inputRef}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          if (acceptingRef.current) {
            acceptingRef.current = false;
            return;
          }
          setFocused(false);
        }}
        onKeyDown={(e) => {
          if ((e.key === "Tab" || e.key === "Enter") && suggestions[0]) {
            e.preventDefault();
            accept(suggestions[0]);
          }
          if (e.key === "Escape") inputRef.current?.blur();
        }}
        className={inputClassName}
      />
      {focused && suggestions.length > 0 && (
        <div className="absolute left-0 top-[calc(100%+2px)] z-50 min-w-[180px] max-w-[85vw] overflow-hidden rounded-md border border-border bg-popover/95 shadow-xl backdrop-blur">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={() => {
                acceptingRef.current = true;
              }}
              onClick={(e) => {
                e.preventDefault();
                accept(s);
              }}
              className="block w-full truncate px-3 py-2 text-left text-[13px] text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
