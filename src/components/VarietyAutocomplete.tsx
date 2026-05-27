import * as React from "react";
import { useRef, useState } from "react";

const TOUCH_SLOP = 8;
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MOBILE_ENTER_KEY_HINT, scrollFocusedIntoView } from "@/lib/mobile-input";
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
}: {
  value: string;
  onChange: (v: string) => void;
  varieties: string[];
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  onCommit?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const acceptingRef = useRef(false);
  const [focused, setFocused] = useState(false);

  const trimmed = value.trim();
  const q = trimmed.toLowerCase();

  // Word-start match only. Empty input must not open a long list on mobile.
  const filtered = (() => {
    if (!varieties.length) return [];
    if (!q || q.length < 2) return [];
    const starts: string[] = [];
    for (const v of varieties) {
      const lv = v.toLowerCase();
      if (lv === q) continue; // already exact match — no need to suggest
      if (matchesWordStart(lv, q)) starts.push(v);
    }
    return starts.slice(0, 3);
  })();

  const showDropdown = focused && filtered.length > 0;

  const accept = (s: string) => {
    onChange(s);
    setTimeout(() => {
      inputRef.current?.blur();
      setFocused(false);
      onCommit?.();
    }, 0);
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        ref={inputRef}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        enterKeyHint={MOBILE_ENTER_KEY_HINT}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          setFocused(true);
          scrollFocusedIntoView(e.currentTarget);
        }}
        onBlur={() => {
          if (acceptingRef.current) {
            acceptingRef.current = false;
            return;
          }
          setFocused(false);
        }}
        onKeyDown={(e) => {
          if ((e.key === "Tab" || e.key === "Enter") && filtered[0]) {
            e.preventDefault();
            accept(filtered[0]);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            inputRef.current?.blur();
            onCommit?.();
            return;
          }
          if (e.key === "Escape") inputRef.current?.blur();
        }}
        className={inputClassName}
      />
      {showDropdown && (
        <div
          className="absolute left-0 top-[calc(100%+2px)] z-50 w-full min-w-0 max-w-[min(18rem,85vw)] overflow-y-auto overscroll-contain rounded-md border border-border bg-popover/95 shadow-xl backdrop-blur"
          onMouseDown={(e) => e.preventDefault()}
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {filtered.map((s) => {
            const pick = () => {
              acceptingRef.current = true;
              accept(s);
            };
            const touchStart = { x: 0, y: 0, moved: false };
            return (
              <button
                key={s}
                type="button"
                style={{ touchAction: "pan-y" }}
                onTouchStart={(e) => {
                  const t = e.touches[0];
                  touchStart.x = t.clientX;
                  touchStart.y = t.clientY;
                  touchStart.moved = false;
                }}
                onTouchMove={(e) => {
                  const t = e.touches[0];
                  if (
                    Math.abs(t.clientX - touchStart.x) > TOUCH_SLOP ||
                    Math.abs(t.clientY - touchStart.y) > TOUCH_SLOP
                  ) {
                    touchStart.moved = true;
                  }
                }}
                onTouchEnd={(e) => {
                  if (touchStart.moved) return; // it was a scroll, not a tap
                  e.preventDefault();
                  e.stopPropagation();
                  pick();
                }}
                onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); pick(); }}
                className="block w-full truncate px-3 py-2 text-left text-[13px] text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent"
              >
                {s}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
