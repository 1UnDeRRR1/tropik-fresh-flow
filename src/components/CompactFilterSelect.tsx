import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type CompactFilterOption = { value: string; label: string };

/**
 * Compact scroll-only dropdown filter used in Owner/Admin Calendar,
 * Analytics and Statistics.
 *
 * Stability-first rewrite:
 *  - No Radix Popover / no Portal — list is rendered as an absolutely
 *    positioned child of the trigger wrapper, so there is no floating
 *    overlay competing with other overlays and no page jump.
 *  - No inline search input → mobile keyboard never opens from a tap on
 *    the trigger, no autofocus, no viewport resize.
 *  - A single module-level store tracks the currently open dropdown id,
 *    so at most ONE CompactFilterSelect can be open across the page.
 *    Tapping a different filter closes the previous one before opening
 *    the next.
 *  - Outside click + Escape close the list. Listeners are attached only
 *    while open and cleaned up on close (SSR-safe; document is only
 *    touched inside useEffect).
 *
 * `searchable` and `aliases` are accepted for API compatibility with the
 * previous version but intentionally ignored here. Alias-search can be
 * reintroduced later as a separate component.
 */

// ---------- single-open store (module-scoped) ----------
let activeId: string | null = null;
const listeners = new Set<() => void>();
function setActive(id: string | null) {
  if (activeId === id) return;
  activeId = id;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
function getSnapshot() {
  return activeId;
}
function useActiveId() {
  return React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => null, // SSR snapshot
  );
}

let idCounter = 0;
function useInstanceId() {
  const ref = React.useRef<string | null>(null);
  if (ref.current === null) {
    idCounter += 1;
    ref.current = `cfs-${idCounter}`;
  }
  return ref.current;
}

export function CompactFilterSelect({
  value,
  onChange,
  options,
  placeholder = "Оберіть…",
  allLabel = "ВСІ",
  allValue = "__all__",
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  aliases: _aliases,
  className,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  searchable: _searchable,
}: {
  value: string;
  onChange: (v: string) => void;
  options: CompactFilterOption[];
  placeholder?: string;
  allLabel?: string;
  allValue?: string;
  /** Accepted for API compatibility; not used in scroll-only mode. */
  aliases?: Record<string, string>;
  className?: string;
  /** Accepted for API compatibility; not used in scroll-only mode. */
  searchable?: boolean;
}) {
  const id = useInstanceId();
  const active = useActiveId();
  const open = active === id;

  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  const selected = options.find((o) => o.value === value);
  const displayLabel =
    value === allValue ? allLabel : (selected?.label ?? placeholder);

  // Close on outside click / Escape — only while open.
  React.useEffect(() => {
    if (!open) return;
    const onDocPointer = (e: MouseEvent | TouchEvent) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const target = e.target as Node | null;
      if (target && wrap.contains(target)) return;
      setActive(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("touchstart", onDocPointer, { passive: true });
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener(
        "touchstart",
        onDocPointer as EventListener,
      );
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // If this instance unmounts while open, release the lock.
  React.useEffect(() => {
    return () => {
      if (activeId === id) setActive(null);
    };
  }, [id]);

  const toggle = () => setActive(open ? null : id);

  return (
    <div ref={wrapRef} className={cn("relative w-full", className)}>
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring",
        )}
      >
        <span
          className={cn(
            "truncate",
            value === allValue && "text-muted-foreground",
          )}
        >
          {displayLabel}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto overscroll-contain rounded-md border border-border bg-popover text-popover-foreground shadow-md"
        >
          <ul className="py-1">
            <li>
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent",
                  value === allValue && "font-medium",
                )}
                onClick={() => {
                  onChange(allValue);
                  setActive(null);
                }}
              >
                <Check
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    value === allValue ? "opacity-100" : "opacity-0",
                  )}
                />
                <span className="truncate">{allLabel}</span>
              </button>
            </li>
            {options.length === 0 ? (
              <li className="px-3 py-2 text-xs text-muted-foreground">
                Нічого не знайдено
              </li>
            ) : (
              options.map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent",
                      value === o.value && "font-medium",
                    )}
                    onClick={() => {
                      onChange(o.value);
                      setActive(null);
                    }}
                  >
                    <Check
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        value === o.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="truncate">{o.label}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
