import * as React from "react";
import { useRef, useState } from "react";

const TOUCH_SLOP = 8;
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MOBILE_ENTER_KEY_HINT, scrollFocusedIntoView } from "@/lib/mobile-input";

/**
 * Free-text input that suggests varieties for the currently selected product.
 *
 * Behavior (Phase 2 fix):
 * - On focus with empty input → shows ALL varieties for the selected product.
 * - On input → substring (case-insensitive) match against the variety list.
 * - List is scrollable (max height ~240px), shows up to 50 rows.
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

  // Substring match. When input is empty AND focused → show everything.
  const filtered = (() => {
    if (!varieties.length) return [];
    if (!q) return varieties.slice(0, 50);
    const starts: string[] = [];
    const contains: string[] = [];
    for (const v of varieties) {
      const lv = v.toLowerCase();
      if (lv === q) continue; // already exact match — no need to suggest
      if (lv.startsWith(q)) starts.push(v);
      else if (lv.includes(q)) contains.push(v);
    }
    return [...starts, ...contains].slice(0, 50);
  })();

  const showDropdown = focused && filtered.length > 0;

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
            return;
          }
          if (e.key === "Escape") inputRef.current?.blur();
        }}
        className={inputClassName}
      />
      {showDropdown && (
        <div
          className="absolute left-0 top-[calc(100%+2px)] z-50 max-h-[240px] min-w-[200px] max-w-[85vw] overflow-y-auto overscroll-contain rounded-md border border-border bg-popover/95 shadow-xl backdrop-blur"
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
