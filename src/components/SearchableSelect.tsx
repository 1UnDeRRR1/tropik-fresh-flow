import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type SearchableOption = { value: string; label: string };

export function SearchableSelect({
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
  options: SearchableOption[];
  placeholder?: string;
  allLabel?: string;
  allValue?: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const selected = options.find((o) => o.value === value);
  const displayLabel = value === allValue ? allLabel : selected?.label ?? placeholder;
  const filteredOptions = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [] as SearchableOption[];
    return options.filter((option) => option.label.toLowerCase().startsWith(q)).slice(0, 3);
  }, [options, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring",
            className,
          )}
        >
          <span className={cn("truncate", value === allValue && "text-muted-foreground")}>
            {displayLabel}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Пошук…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>{search.trim().length < 2 ? "Введіть 2 літери" : "Нічого не знайдено"}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value={allLabel}
                onSelect={() => {
                  onChange(allValue);
                  setOpen(false);
                }}
              >
                <Check className={cn("mr-2 h-4 w-4", value === allValue ? "opacity-100" : "opacity-0")} />
                {allLabel}
              </CommandItem>
              {filteredOptions.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => {
                    onChange(o.value);
                    setSearch("");
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === o.value ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
