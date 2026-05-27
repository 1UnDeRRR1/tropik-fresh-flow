import { useState } from "react";
import { ArrowDownUp, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SortKey = "date" | "name" | "status" | "last_event";

export const SORT_LABEL: Record<SortKey, string> = {
  date: "датою",
  name: "назвою товару",
  status: "статусом",
  last_event: "останньою подією",
};

export function SortByMenu({
  value,
  onChange,
  className,
}: {
  value: SortKey;
  onChange: (v: SortKey) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const keys: SortKey[] = ["date", "name", "status", "last_event"];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("h-7 gap-1 rounded-full px-3 text-[11px] font-semibold", className)}
        >
          <ArrowDownUp className="h-3.5 w-3.5" />
          Сортувати за: <span className="font-bold">{SORT_LABEL[value]}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              onChange(k);
              setOpen(false);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
              value === k && "font-semibold",
            )}
          >
            <span>{SORT_LABEL[k]}</span>
            {value === k && <Check className="h-4 w-4 text-primary" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
