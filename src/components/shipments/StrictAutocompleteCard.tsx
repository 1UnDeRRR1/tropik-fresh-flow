// Build 2A.10 — create-only autocomplete with a polished anchored suggestion
// card. Replacement for InlineAutocomplete / AutocompleteCell usages on the
// /shipments/new screen ONLY.
//
// Why a new component:
//   - The shared InlineAutocomplete repositions the input (position:absolute +
//     expandedMinWidth) on focus. That visibly changes the field size/shape
//     and is unacceptable in the create-screen layout.
//   - We must not touch the shared AutocompleteCell / InlineAutocomplete used
//     by the saved editor and other screens.
//
// What this component does:
//   - Renders a plain Input that never resizes/repositions on focus.
//   - Opens a Radix Popover anchored to the input wrapper at width = trigger
//     width (matches the Клас/Сорт StrictSelectCard look & feel).
//   - Reuses shadcn Popover open/close animations (fade + zoom + slide).
//   - Filters items in the same shape as InlineAutocomplete (browse mode of
//     up to `browseLimit` items, search mode after `minSearchLength` chars
//     capped at `searchLimit` items, alphabetised, alias-aware).
//   - Tab/Enter accepts the top suggestion; Escape closes.
//   - Click / touch picks an item.
//   - Calls `onInputBlur(raw)` so the caller can run alias resolution and
//     drive the existing invalid-feedback flash/shake/clear behavior.
//   - Caller controls validation styling via `inputClassName` (e.g. red
//     border for required-empty), keeping the existing required-indicator
//     visuals untouched.

import * as React from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { matchesWordStart } from "@/lib/compact-search";
import { MOBILE_ENTER_KEY_HINT, scrollFocusedIntoView } from "@/lib/mobile-input";
import { cn } from "@/lib/utils";

type SuggestionMode = "browse" | "search";

export function StrictAutocompleteCard<T>({
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
  readOnly = false,
  browseLimit = 5,
  searchLimit = 5,
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
  readOnly?: boolean;
  browseLimit?: number;
  searchLimit?: number;
  minSearchLength?: number;
  selectTextOnFocus?: boolean;
  renderItem?: (item: T, meta: { active: boolean; mode: SuggestionMode }) => React.ReactNode;
  inputProps?: Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "readOnly" | "placeholder"
  > &
    Record<`data-${string}`, string | undefined>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const acceptingRef = useRef(false);

  const [focused, setFocused] = useState(false);
  const [typedSinceFocus, setTypedSinceFocus] = useState(false);
  const [triggerWidth, setTriggerWidth] = useState<number | undefined>(undefined);

  const query = value.trim().toLowerCase();
  const mode: SuggestionMode = typedSinceFocus ? "search" : "browse";

  const visibleItems = useMemo(() => {
    if (!focused || readOnly) return [] as T[];
    if (!typedSinceFocus) return items.slice(0, browseLimit);
    if (query.length < minSearchLength) return [] as T[];

    const matches = items.filter((item) => {
      const strings = [getLabel(item), ...(getSearchStrings?.(item) ?? [])]
        .map((s) => s.trim())
        .filter(Boolean);
      if (strings.some((s) => s.toLowerCase() === query)) return false;
      return strings.some((s) => matchesWordStart(s, query));
    });
    const direct: T[] = [];
    const aliasOnly: T[] = [];
    for (const m of matches) {
      if (getLabel(m).trim().toLowerCase().startsWith(query)) direct.push(m);
      else aliasOnly.push(m);
    }
    return [...direct, ...aliasOnly].slice(0, searchLimit);
  }, [browseLimit, focused, getLabel, getSearchStrings, items, minSearchLength, query, readOnly, searchLimit, typedSinceFocus]);

  // Measure the trigger so the popover matches input width exactly.
  useLayoutEffect(() => {
    if (!focused) return;
    const w = wrapRef.current?.getBoundingClientRect().width;
    if (w) setTriggerWidth(w);
  }, [focused, value]);

  const accept = (item: T) => {
    acceptingRef.current = true;
    onSelect(item);
    setTypedSinceFocus(false);
    setFocused(false);
    window.setTimeout(() => {
      inputRef.current?.blur();
      onCommit?.();
      acceptingRef.current = false;
    }, 0);
  };

  const highlightedKey = (() => {
    const v = value.trim().toLowerCase();
    if (!v) return null;
    const found = items.find((i) => getLabel(i).trim().toLowerCase() === v);
    return found ? getKey(found) : null;
  })();

  const open = focused && !readOnly && visibleItems.length > 0;

  return (
    <Popover open={open}>
      <PopoverAnchor asChild>
        <div ref={wrapRef} className={cn("relative w-full", className)}>
          <Input
            {...inputProps}
            ref={inputRef}
            value={value}
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
              if (acceptingRef.current) return;
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
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        collisionPadding={8}
        avoidCollisions
        style={triggerWidth ? { width: triggerWidth } : undefined}
        className="max-h-[240px] overflow-y-auto p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onMouseDown={(e) => {
          // Prevent the input from blurring before our click handler fires.
          e.preventDefault();
          acceptingRef.current = true;
        }}
      >
        <ul className="py-1">
          {visibleItems.map((item) => {
            const key = getKey(item);
            const active = highlightedKey === key;
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => accept(item)}
                  className={cn(
                    "block w-full px-3 py-2 text-left text-[13px] text-foreground hover:bg-accent hover:text-accent-foreground",
                    active && "bg-accent/60 font-semibold",
                  )}
                >
                  {renderItem ? (
                    renderItem(item, { active, mode })
                  ) : (
                    <span className="block truncate">{getLabel(item)}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
