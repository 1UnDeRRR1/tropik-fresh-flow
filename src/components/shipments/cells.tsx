// Phase 1 — extracted from src/routes/_authenticated/shipments/$id.products.tsx
// without behavior changes. These are the leaf input cells used by
// ShipmentProductCard. They are controlled and write straight into the
// parent DraftRow via onChange/onValueChange callbacks.
import { useEffect, useMemo, useState } from "react";

import { InlineAutocomplete } from "@/components/InlineAutocomplete";
import { VarietyAutocomplete } from "@/components/VarietyAutocomplete";
import { Input } from "@/components/ui/input";
import { usePalletResolver, type PackageOption } from "@/hooks/usePackageOptions";
import { useVarietiesFor } from "@/hooks/useProductVarieties";
import { blurOnEnter, MOBILE_ENTER_KEY_HINT, scrollFocusedIntoView } from "@/lib/mobile-input";
import { cn } from "@/lib/utils";

export const FOCUS_STYLE = "border-brand bg-background ring-2 ring-brand/40";

export function CellInput({
  value,
  onChange,
  placeholder,
  className,
  list,
  expandedMinWidth,
  readOnly = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  list?: string;
  expandedMinWidth?: number;
  readOnly?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Input
      data-mobile-edit-label={placeholder && placeholder !== "—" ? placeholder.replace("*", "") : undefined}
      value={value}
      readOnly={readOnly}
      list={list}
      enterKeyHint={MOBILE_ENTER_KEY_HINT}
      placeholder={focused ? "" : placeholder}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => {
        if (readOnly) return;
        setFocused(true);
        e.currentTarget.select();
        scrollFocusedIntoView(e.currentTarget);
      }}
      onKeyDown={blurOnEnter}
      onBlur={() => setFocused(false)}
      style={focused && expandedMinWidth ? { minWidth: expandedMinWidth } : undefined}
      className={cn(
        "h-9 w-full border-input bg-background px-2 text-[13px] focus:border-input",
        focused && FOCUS_STYLE,
        readOnly && "cursor-default",
        className,
      )}
    />
  );
}

export function PackageCell({
  value,
  productName,
  countryName,
  readOnly,
  onSelect,
  onChangeText,
}: {
  value: string;
  productName: string;
  countryName: string;
  readOnly: boolean;
  onSelect: (opt: PackageOption) => void;
  onChangeText: (text: string) => void;
}) {
  const { data: resolved } = usePalletResolver(productName, countryName);
  const options: PackageOption[] = resolved?.options ?? [];
  const items = useMemo(
    () => options.map((opt, i) => ({
      ...opt,
      key: `${opt.package_used}|${opt.pallet_net_kg ?? ""}|${opt.pallet_gross_kg ?? ""}|${i}`,
      label: opt.package_used,
      searchStrings: [opt.package_used, opt.pallet_size ?? ""].filter(Boolean),
    })),
    [options],
  );

  if (readOnly) {
    return (
      <div className="h-9 truncate rounded-md border border-input bg-muted/40 px-2 py-2 text-[13px] text-foreground/90">
        {value || "—"}
      </div>
    );
  }

  return (
    <InlineAutocomplete
      value={value}
      onValueChange={onChangeText}
      items={items}
      getKey={(item) => item.key}
      getLabel={(item) => item.label}
      getSearchStrings={(item) => item.searchStrings}
      onSelect={(item) => onSelect(item)}
      onCommit={() => {
        if (typeof document === "undefined") return;
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
      }}
      placeholder="Упаковка"
      expandedMinWidth={240}
      browseLimit={50}
      searchLimit={3}
      minSearchLength={2}
      className="w-full"
      inputClassName={cn(
        "h-9 w-full truncate rounded-md border border-input bg-background px-2 text-left text-[13px] outline-none transition-colors hover:border-input focus:border-input focus:bg-background",
        !value && "text-muted-foreground",
      )}
      inputProps={{ "data-mobile-edit-label": "Упаковка" }}
      renderItem={(item) => (
        <div>
          <div className="font-medium truncate">{item.package_used}</div>
          <div className="text-[11px] text-muted-foreground">
            net {item.pallet_net_kg ?? "—"} / gross {item.pallet_gross_kg ?? "—"} кг
            {item.pallet_size ? ` · ${item.pallet_size}` : ""}
          </div>
        </div>
      )}
    />
  );
}

export function VarietyCell({
  value,
  onChange,
  productName,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  productName: string;
  readOnly: boolean;
}) {
  const varieties = useVarietiesFor(productName);
  return (
    <VarietyAutocomplete
      value={value}
      onChange={onChange}
      onCommit={() => {
        if (typeof document === "undefined") return;
        const active = document.activeElement;
        if (active instanceof HTMLElement) active.blur();
      }}
      varieties={varieties}
      placeholder="Сорт"
      inputClassName={cn(
        "h-9 w-full border-input bg-background px-2 text-[13px] focus:border-input",
        readOnly && "cursor-default",
      )}
      disabled={readOnly}
      expandedMinWidth={240}
    />
  );
}

export function NumCell({
  value,
  onChange,
  step,
  readOnly = false,
  invalid = false,
  placeholder,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: string;
  readOnly?: boolean;
  invalid?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState<string>(value === 0 ? "" : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (focused) return;
    const parsed = text === "" ? 0 : Number(text);
    if (parsed !== value) setText(value === 0 ? "" : String(value));
  }, [value, focused, text]);
  return (
    <Input
      type="text"
      data-mobile-edit-label={placeholder ?? "Палети/вага"}
      readOnly={readOnly}
      inputMode="decimal"
      enterKeyHint={MOBILE_ENTER_KEY_HINT}
      step={step ?? "1"}
      value={text}
      placeholder={focused ? "" : (placeholder ?? "")}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      onFocus={(e) => {
        if (readOnly) return;
        setFocused(true);
        e.currentTarget.select();
        scrollFocusedIntoView(e.currentTarget);
      }}
      onKeyDown={blurOnEnter}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^\d.,-]/g, "");
        setText(raw);
        const normalized = raw.replace(",", ".");
        if (normalized === "" || normalized === "-" || /[.,]$/.test(raw)) {
          if (raw === "") onChange(0);
          return;
        }
        const n = Number(normalized);
        if (!Number.isNaN(n)) onChange(n);
      }}
      className={cn(
        "h-9 w-full border-input bg-background px-2 text-right text-[13px] tabular-nums focus:border-input",
        focused && FOCUS_STYLE,
        readOnly && "cursor-default",
        invalid && "border-destructive/70 ring-1 ring-destructive/40 placeholder:text-destructive/80",
      )}
    />
  );
}

export function PriceCell({
  value,
  currency,
  onValueChange,
  onCurrencyChange,
  readOnly = false,
  className,
  inputClassName,
  selectClassName,
}: {
  value: number;
  currency: "EUR" | "USD";
  onValueChange: (v: number) => void;
  onCurrencyChange: (c: "EUR" | "USD") => void;
  readOnly?: boolean;
  className?: string;
  inputClassName?: string;
  selectClassName?: string;
}) {
  const [text, setText] = useState<string>(value === 0 ? "" : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (focused) return;
    const parsed = text === "" ? 0 : Number(text.replace(",", "."));
    if (parsed !== value) setText(value === 0 ? "" : String(value));
  }, [value, focused, text]);
  const isEmpty = !value || value <= 0;
  return (
    <div className={cn(
      "flex items-center gap-1 rounded-md border border-input bg-background",
      isEmpty && "border-destructive/70 ring-1 ring-destructive/40",
      className,
    )}>
      <Input
        type="text"
        data-mobile-edit-label="Ціна"
        readOnly={readOnly}
        inputMode="decimal"
        enterKeyHint={MOBILE_ENTER_KEY_HINT}
        value={text}
        placeholder={focused ? "" : "Ціна за кг"}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={(e) => {
          if (readOnly) return;
          setFocused(true);
          e.currentTarget.select();
          scrollFocusedIntoView(e.currentTarget);
        }}
        onKeyDown={blurOnEnter}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.,-]/g, "");
          setText(raw);
          const normalized = raw.replace(",", ".");
          if (normalized === "" || normalized === "-" || /[.,]$/.test(raw)) {
            if (raw === "") onValueChange(0);
            return;
          }
          const n = Number(normalized);
          if (!Number.isNaN(n)) onValueChange(n);
        }}
        className={cn(
          "h-10 w-full min-w-[60px] border-transparent bg-transparent px-2 text-right text-[14px] tabular-nums focus:border-input focus:bg-background",
          focused && FOCUS_STYLE,
          isEmpty && "placeholder:text-destructive/80",
          readOnly && "cursor-default",
          inputClassName,
        )}
      />
      <select
        data-mobile-edit-label="Валюта"
        value={currency}
        disabled={readOnly}
        onChange={(e) => onCurrencyChange(e.target.value as "EUR" | "USD")}
        className={cn(
          "h-10 rounded border-transparent bg-transparent px-2 text-[13px] focus:border-input focus:bg-background disabled:cursor-not-allowed disabled:opacity-70",
          selectClassName,
        )}
      >
        <option value="EUR">€</option>
        <option value="USD">$</option>
      </select>
    </div>
  );
}
