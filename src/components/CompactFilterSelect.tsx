import * as React from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type CompactFilterOption = { value: string; label: string };

/**
 * Compact dropdown filter used in Calendar / Analytics / Statistics.
 *
 * Differences vs shared SearchableSelect (which is preserved untouched):
 *  - Always renders the full option list — user can scroll without typing.
 *  - Optional inline search input filters by `startsWith(canonical)` OR by
 *    alias lookup (alias-normalized → canonical label).
 *  - Popover width matches trigger; no heavy modal-over-modal feel on mobile.
 *  - Shows canonical/display labels; aliases only affect matching.
 *
 * Local to this UI bugfix package; no shared-component refactor.
 */
export function CompactFilterSelect({
  value,
  onChange,
  options,
  placeholder = "Оберіть…",
  allLabel = "ВСІ",
  allValue = "__all__",
  aliases,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: CompactFilterOption[];
  placeholder?: string;
  allLabel?: string;
  allValue?: string;
  /** alias_normalized (lowercased) → canonical label */
  aliases?: Record<string, string>;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const selected = options.find((o) => o.value === value);
  const displayLabel =
    value === allValue ? allLabel : selected?.label ?? placeholder;

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    // Find canonical labels that aliases resolve to for this query.
    const aliasHits = new Set<string>();
    if (aliases) {
      for (const [alias, canonical] of Object.entries(aliases)) {
        if (alias.startsWith(q)) aliasHits.add(canonical.toLowerCase());
      }
    }
    return options.filter((o) => {
      const lbl = o.label.toLowerCase();
      if (lbl.startsWith(q) || lbl.includes(q)) return true;
      if (aliasHits.has(lbl)) return true;
      return false;
    });
  }, [options, search, aliases]);

  React.useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-compact-filter-trigger="true"
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring",
            className,
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
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
        sideOffset={4}
        collisionPadding={8}
        onOpenAutoFocus={(e) => {
          // Don't autofocus the search input — prevents the mobile keyboard
          // from opening unless the user explicitly taps the search field.
          e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          // If the outside pointerdown lands on another compact filter
          // trigger, swallow it so the first tap only closes the current
          // dropdown; the next separate tap may open another filter.
          const target = e.target as HTMLElement | null;
          if (target?.closest?.("[data-compact-filter-trigger]")) {
            e.preventDefault();
          }
        }}
        onInteractOutside={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest?.("[data-compact-filter-trigger]")) {
            e.preventDefault();
          }
        }}
      >
        <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук…"
            className="h-7 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        <ul className="max-h-64 overflow-y-auto py-1">
          <li>
            <button
              type="button"
              className={cn(
                "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent",
                value === allValue && "font-medium",
              )}
              onClick={() => {
                onChange(allValue);
                setOpen(false);
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
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">
              Нічого не знайдено
            </li>
          ) : (
            filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent",
                    value === o.value && "font-medium",
                  )}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
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
      </PopoverContent>
    </Popover>
  );
}
