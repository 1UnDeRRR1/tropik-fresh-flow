import * as React from "react";
import { useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { matchesWordStart } from "@/lib/compact-search";
import { MOBILE_ENTER_KEY_HINT, scrollFocusedIntoView } from "@/lib/mobile-input";
import { cn } from "@/lib/utils";

const TOUCH_SLOP = 8;

type SuggestionMode = "browse" | "search";

export function InlineAutocomplete<T>({
  value,
  onValueChange,
  items,
  getKey,
  getLabel,
  getSearchStrings,
  onSelect,
  onInputBlur,
  onCommit,
  placeholder,
  className,
  inputClassName,
  disabled = false,
  readOnly = false,
  browseLimit = 5,
  searchLimit = 3,
  minSearchLength = 2,
  selectTextOnFocus = true,
  renderItem,
  inputProps,
}: {
  value: string;
  onValueChange: (value: string) => void;
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getSearchStrings?: (item: T) => string[];
  onSelect: (item: T) => void;
  onInputBlur?: (value: string) => void;
  onCommit?: () => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
  readOnly?: boolean;
  browseLimit?: number;
  searchLimit?: number;
  minSearchLength?: number;
  selectTextOnFocus?: boolean;
  renderItem?: (item: T, meta: { active: boolean; mode: SuggestionMode }) => React.ReactNode;
  inputProps?: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "disabled" | "readOnly" | "placeholder"> & Record<`data-${string}`, string | undefined>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const acceptingRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const [typedSinceFocus, setTypedSinceFocus] = useState(false);

  const query = value.trim().toLowerCase();
  const mode: SuggestionMode = typedSinceFocus ? "search" : "browse";

  const visibleItems = useMemo(() => {
    if (!focused || readOnly) return [] as T[];
    if (!typedSinceFocus) return items.slice(0, browseLimit);
    if (query.length < minSearchLength) return [] as T[];

    return items
      .filter((item) => {
        const strings = [getLabel(item), ...(getSearchStrings?.(item) ?? [])]
          .map((str) => str.trim())
          .filter(Boolean);
        if (strings.some((str) => str.toLowerCase() === query)) return false;
        return strings.some((str) => matchesWordStart(str, query));
      })
      .slice(0, searchLimit);
  }, [browseLimit, focused, getLabel, getSearchStrings, items, minSearchLength, query, readOnly, searchLimit, typedSinceFocus]);

  const accept = (item: T) => {
    onSelect(item);
    setTypedSinceFocus(false);
    window.setTimeout(() => {
      inputRef.current?.blur();
      setFocused(false);
      onCommit?.();
    }, 0);
  };

  const highlightedKey = items.find((item) => getLabel(item).trim().toLowerCase() === value.trim().toLowerCase())
    ? getKey(items.find((item) => getLabel(item).trim().toLowerCase() === value.trim().toLowerCase()) as T)
    : null;

  return (
    <div className={cn("relative", className)}>
      <Input
        {...inputProps}
        ref={inputRef}
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        placeholder={focused ? "" : placeholder}
        enterKeyHint={MOBILE_ENTER_KEY_HINT}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => {
          setTypedSinceFocus(true);
          onValueChange(e.target.value);
        }}
        onFocus={(e) => {
          if (readOnly) return;
          setFocused(true);
          setTypedSinceFocus(false);
          if (selectTextOnFocus) e.currentTarget.select();
          scrollFocusedIntoView(e.currentTarget);
          inputProps?.onFocus?.(e);
        }}
        onBlur={(e) => {
          if (acceptingRef.current) {
            acceptingRef.current = false;
            return;
          }
          setFocused(false);
          setTypedSinceFocus(false);
          onInputBlur?.(e.target.value);
          onCommit?.();
          inputProps?.onBlur?.(e);
        }}
        onKeyDown={(e) => {
          const canPickFirst = visibleItems[0] && (typedSinceFocus || !value.trim());
          if ((e.key === "Tab" || e.key === "Enter") && canPickFirst) {
            e.preventDefault();
            accept(visibleItems[0]);
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            inputRef.current?.blur();
            return;
          }
          if (e.key === "Escape") inputRef.current?.blur();
          inputProps?.onKeyDown?.(e);
        }}
        className={inputClassName}
      />

      {focused && !readOnly && visibleItems.length > 0 && (
        <div
          className="absolute left-0 top-[calc(100%+2px)] z-50 w-full min-w-0 max-w-[min(22rem,92vw)] overflow-hidden rounded-md border border-border bg-popover shadow-xl"
          onMouseDown={(e) => e.preventDefault()}
        >
          <div
            className={cn(
              "overflow-y-auto overscroll-contain",
              mode === "browse" ? "max-h-[180px]" : "max-h-[132px]",
            )}
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {visibleItems.map((item) => {
              const key = getKey(item);
              const touchStart = { x: 0, y: 0, moved: false };
              const pick = () => {
                acceptingRef.current = true;
                accept(item);
              };
              const active = highlightedKey === key;

              return (
                <button
                  key={key}
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
                    if (touchStart.moved) return;
                    e.preventDefault();
                    e.stopPropagation();
                    pick();
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    pick();
                  }}
                  className={cn(
                    "block w-full px-3 py-2 text-left text-[13px] text-foreground hover:bg-accent hover:text-accent-foreground active:bg-accent",
                    active && "bg-accent/60",
                  )}
                >
                  {renderItem ? renderItem(item, { active, mode }) : <span className="block truncate">{getLabel(item)}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}