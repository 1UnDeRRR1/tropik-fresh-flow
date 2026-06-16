import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShinyButton } from "@/components/ui/shiny-button";
import type { CompactFilterOption } from "@/components/CompactFilterSelect";

/**
 * Drop-in replacement for CompactFilterSelect that uses the Ruixen
 * ShinyButton as the dropdown trigger. Behavior (open/close, outside
 * click, ESC, single-open-at-a-time list) intentionally mirrors the
 * scroll-only CompactFilterSelect so it is safe on mobile.
 *
 * Used only for the Malekhiv branch on the "Вільно" tab — the rest of
 * the app keeps CompactFilterSelect untouched.
 */

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
  return React.useSyncExternalStore(subscribe, getSnapshot, () => null);
}

let idCounter = 0;
function useInstanceId() {
  const ref = React.useRef<string | null>(null);
  if (ref.current === null) {
    idCounter += 1;
    ref.current = `sfs-${idCounter}`;
  }
  return ref.current;
}

export function ShinyFilterSelect({
  value,
  onChange,
  options,
  placeholder = "Оберіть…",
  allLabel = "ВСІ",
  allValue = "__all__",
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: CompactFilterOption[];
  placeholder?: string;
  allLabel?: string;
  allValue?: string;
  className?: string;
}) {
  const id = useInstanceId();
  const active = useActiveId();
  const open = active === id;
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  const selected = options.find((o) => o.value === value);
  const displayLabel = value === allValue ? allLabel : (selected?.label ?? placeholder);

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
      document.removeEventListener("touchstart", onDocPointer as EventListener);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  React.useEffect(() => {
    return () => {
      if (activeId === id) setActive(null);
    };
  }, [id]);

  const toggle = () => setActive(open ? null : id);

  return (
    <div ref={wrapRef} className={cn("relative w-full", className)}>
      <ShinyButton
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        shineDelay={3}
        className={cn(
          "shiny-filter-trigger relative flex h-9 w-full items-center !px-3 !py-1",
          open && "shiny-filter-trigger-open",
        )}
      >
        <span className="pointer-events-none block w-full truncate px-5 text-center normal-case tracking-normal opacity-95">
          {displayLabel}
        </span>
        <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-50" />
      </ShinyButton>


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
              <li className="px-3 py-2 text-xs text-muted-foreground">Нічого не знайдено</li>
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
