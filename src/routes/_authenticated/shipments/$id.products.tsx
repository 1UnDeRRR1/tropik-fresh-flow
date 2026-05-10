import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toUaCountry } from "@/lib/countries";
import { AutocompleteCell } from "@/components/AutocompleteCell";
import { CostPair } from "@/components/CostPair";
import { deleteShipmentIfEmpty } from "@/lib/cleanup-empty-shipment";

import { StaffOnly } from "@/components/StaffOnly";

export const Route = createFileRoute("/_authenticated/shipments/$id/products")({
  component: () => <StaffOnly><ProductsFullscreen /></StaffOnly>,
});

const COUNTRY_OPTIONS = [
  "Греція", "Італія", "Іспанія", "Нідерланди", "Бельгія", "Польща", "Молдова", "Албанія", "Македонія",
  "Туреччина", "Франція", "Німеччина", "Португалія", "Румунія", "Сербія", "Грузія", "Єгипет", "Марокко",
];

// Lowercase EN (and ISO) -> canonical UA names. Lets users type English and have it normalized.
const COUNTRY_ALIASES: Record<string, string> = {
  greece: "Греція", gr: "Греція",
  italy: "Італія", it: "Італія",
  spain: "Іспанія", es: "Іспанія",
  netherlands: "Нідерланди", holland: "Нідерланди", nl: "Нідерланди",
  belgium: "Бельгія", be: "Бельгія",
  poland: "Польща", pl: "Польща",
  moldova: "Молдова", md: "Молдова",
  albania: "Албанія", al: "Албанія",
  macedonia: "Македонія", "north macedonia": "Македонія", mk: "Македонія",
  turkey: "Туреччина", tr: "Туреччина",
  france: "Франція", fr: "Франція",
  germany: "Німеччина", de: "Німеччина",
  portugal: "Португалія", pt: "Португалія",
  romania: "Румунія", ro: "Румунія",
  serbia: "Сербія", rs: "Сербія",
  georgia: "Грузія", ge: "Грузія",
  egypt: "Єгипет", eg: "Єгипет",
  morocco: "Марокко", ma: "Марокко",
};

type ItemRow = {
  id: string;
  product_name: string | null;
  variety: string | null;
  origin_country: string | null;
  caliber: string | null;
  sku: string | null;
  pallet_count: number | null;
  pallet_weight: number | null;
  unit_price: number | null;
  price_currency: string | null;
  final_cost_indicative: number | null;
  final_cost_invoice: number | null;
};

type ShipmentRow = {
  id: string;
  code: string;
  country: string | null;
  logistics_cost: number | null;
  logistics_cost_currency: string | null;
};

type ProductRef = { name: string; default_pallet_weight: number | null };

function isValidShipmentItem(item: Pick<ItemRow, "product_name" | "pallet_count">) {
  return (item.product_name ?? "").trim().length > 0 && Number(item.pallet_count ?? 0) > 0;
}

function ProductsFullscreen() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, loading } = useAuth();

  const { data } = useQuery({
    queryKey: ["shipment-products", user?.id, id],
    enabled: !loading && !!user,
    queryFn: async () => {
      const [s, items, prods] = await Promise.all([
        supabase.from("shipments").select("id,code,country,logistics_cost,logistics_cost_currency").eq("id", id).single(),
        supabase.from("shipment_items").select("id,product_name,variety,origin_country,caliber,sku,pallet_count,pallet_weight,unit_price,price_currency,final_cost_indicative,final_cost_invoice").eq("shipment_id", id).order("created_at"),
        supabase.from("products").select("name,default_pallet_weight").eq("is_active", true),
      ]);
        return {
        shipment: s.data as ShipmentRow | null,
          items: ((items.data ?? []) as ItemRow[]).filter(isValidShipmentItem),
        products: (prods.data ?? []) as ProductRef[],
      };
    },
  });

  const sh = data?.shipment;
  const items = data?.items ?? [];
  const products = data?.products ?? [];
  const country = toUaCountry(sh?.country) || "—";
  const missingPriceCount = items.filter((i) => !i.unit_price || Number(i.unit_price) <= 0).length;
  const hasRealPallets = items.length > 0;

  // Auto-delete empty shipment when leaving (browser back, tab close, route change)
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => {
    return () => {
      const list = itemsRef.current;
      const real = list.some((i) => Number(i.pallet_count ?? 0) > 0);
      if (!real) void deleteShipmentIfEmpty(id);
    };
  }, [id]);
  useEffect(() => {
    const onUnload = () => {
      const list = itemsRef.current;
      const real = list.some((i) => Number(i.pallet_count ?? 0) > 0);
      if (!real) {
        // Best-effort cleanup; ignore promise
        void deleteShipmentIfEmpty(id);
      }
    };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, [id]);

  const blockExit = (e: React.MouseEvent) => {
    if (missingPriceCount > 0) {
      e.preventDefault();
      toast.error(`Заповніть ціну (${missingPriceCount} поз. без ціни)`);
      return;
    }
    if (!hasRealPallets) {
      e.preventDefault();
      toast.error("Додайте хоча б 1 товар з палетами або поставку буде видалено");
    }
  };

  const addItem = async () => {
    const { error } = await supabase.from("shipment_items").insert({
      shipment_id: id,
      product_name: "Новий товар",
      qty: 0,
      unit: "kg",
      unit_price: 0,
      price_currency: "EUR",
      pallet_count: 1,
      pallet_weight: 0,
    });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["shipment-products", user?.id, id] });
    qc.invalidateQueries({ queryKey: ["shipment", id] });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 pt-safe">
        <button
          type="button"
          onClick={() => {
            if (missingPriceCount > 0) {
              toast.error(`Заповніть ціну (${missingPriceCount} поз. без ціни)`);
              return;
            }
            navigate({ to: "/shipments/$id", params: { id } });
          }}
          className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-sm font-semibold">{sh?.code ?? "…"}</div>
          <div className={cn("truncate text-[10px] uppercase tracking-wide", missingPriceCount > 0 ? "text-destructive" : "text-muted-foreground")}>
            {country} · {items.length} поз.{missingPriceCount > 0 && ` · ${missingPriceCount} без ціни`}
          </div>
        </div>
        <Button size="sm" onClick={addItem} className="bg-brand text-brand-foreground hover:bg-brand/90">
          <Plus className="h-4 w-4" />
        </Button>
      </header>

      {sh && <TransportBar shipment={sh} />}

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-sm text-muted-foreground">Позицій ще немає</p>
            <Button onClick={addItem} className="bg-brand text-brand-foreground hover:bg-brand/90">
              <Plus className="mr-1 h-4 w-4" /> Додати товар
            </Button>
          </div>
        ) : (
          <table className="w-full text-[12px] tabular-nums">
            <thead className="sticky top-0 z-10 bg-card text-muted-foreground shadow-sm">
              <tr className="border-b border-border">
                <th className="px-1.5 py-2 text-left font-medium">Товар</th>
                <th className="px-1.5 py-2 text-left font-medium">Сорт</th>
                <th className="px-1.5 py-2 text-left font-medium">Країна</th>
                <th className="px-1.5 py-2 text-left font-medium">Калібр</th>
                <th className="px-1.5 py-2 text-left font-medium">Спец.</th>
                <th className="px-1.5 py-2 text-right font-medium">Пал.</th>
                <th className="px-1.5 py-2 text-right font-medium">Ціна</th>
                <th className="px-1.5 py-2 text-right font-medium text-muted-foreground">Собів. $</th>
                <th className="px-1.5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const otherPallets = items.reduce((a, x) => a + (x.id === it.id ? 0 : Number(x.pallet_count ?? 0)), 0);
                const otherKg = items.reduce((a, x) => a + (x.id === it.id ? 0 : Number(x.pallet_count ?? 0) * Number(x.pallet_weight ?? 0)), 0);
                return <ProductRowEditor key={it.id} item={it} shipmentId={id} products={products} otherPallets={otherPallets} otherKg={otherKg} />;
              })}
            </tbody>
          </table>
        )}
      </div>

      <footer className="border-t border-border bg-card px-3 py-2 pb-safe">
        <Link to="/shipments/$id" params={{ id }} className="block" onClick={blockExit}>
          <Button
            className={cn(
              "w-full",
              missingPriceCount > 0
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-brand text-brand-foreground hover:bg-brand/90",
            )}
          >
            {missingPriceCount > 0 ? `Заповніть ціну (${missingPriceCount})` : "Готово"}
          </Button>
        </Link>
      </footer>
    </div>
  );
}

function TransportBar({ shipment }: { shipment: ShipmentRow }) {
  const qc = useQueryClient();
  const [val, setVal] = useState<string>(
    shipment.logistics_cost == null || Number(shipment.logistics_cost) === 0 ? "" : String(shipment.logistics_cost),
  );
  const [cur, setCur] = useState<string>(shipment.logistics_cost_currency ?? "EUR");
  const dirty = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isEmpty = val === "" || Number(val.replace(",", ".")) <= 0;

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(async () => {
      const normalized = val.replace(",", ".");
      // Skip incomplete numbers like "1." or "1,"
      if (/[.,]$/.test(val)) return;
      const num = normalized === "" ? 0 : Number(normalized);
      if (Number.isNaN(num)) return;
      const { error } = await supabase
        .from("shipments")
        .update({ logistics_cost: num, logistics_cost_currency: cur })
        .eq("id", shipment.id);
      if (error) toast.error(error.message);
      else {
        dirty.current = false;
        qc.invalidateQueries({ queryKey: ["shipment-products"] }); qc.invalidateQueries({ queryKey: ["shipment", shipment.id] });
      }
    }, 600);
    return () => clearTimeout(t);
  }, [val, cur, shipment.id, qc]);

  return (
    <div className={cn(
      "flex items-center gap-2 border-b px-3 py-1.5 transition-colors",
      isEmpty ? "border-destructive bg-destructive/10" : "border-border bg-muted/40",
    )}>
      <span className={cn(
        "text-[11px] font-semibold uppercase tracking-wide",
        isEmpty ? "text-destructive" : "text-muted-foreground",
      )}>
        Перевезення авто {isEmpty && "*"}
      </span>
      <Input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        placeholder="Обов'язково"
        value={val}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => {
          if (isEmpty) {
            e.preventDefault();
            toast.error("Вкажіть вартість перевезення");
            setTimeout(() => inputRef.current?.focus(), 0);
          }
        }}
        onChange={(e) => {
          dirty.current = true;
          setVal(e.target.value.replace(/[^\d.,-]/g, ""));
        }}
        className={cn(
          "h-7 flex-1 px-2 text-[12px]",
          isEmpty && "border-destructive bg-destructive/15 ring-2 ring-destructive/60",
        )}
      />
      <select
        value={cur}
        onChange={(e) => { dirty.current = true; setCur(e.target.value); }}
        className="h-7 rounded-md border border-input bg-background px-1.5 text-[11px]"
      >
        <option value="EUR">EUR</option>
        <option value="USD">USD</option>
      </select>
    </div>
  );
}

const MAX_PALLETS = 26;
const MAX_WEIGHT_KG = 21500;

function ProductRowEditor({ item, shipmentId, products, otherPallets, otherKg }: { item: ItemRow; shipmentId: string; products: ProductRef[]; otherPallets: number; otherKg: number }) {
  const qc = useQueryClient();
  const normalizedProductName = item.product_name === "Новий товар" ? "" : (item.product_name ?? "");
  const [form, setForm] = useState({
    product_name: normalizedProductName,
    variety: item.variety ?? "",
    origin_country: item.origin_country ?? "",
    caliber: item.caliber ?? "",
    sku: item.sku ?? "",
    pallet_count: item.pallet_count ?? 0,
    unit_price: item.unit_price ?? 0,
    price_currency: (item.price_currency ?? "EUR") as "EUR" | "USD",
  });
  const dirtyRef = useRef(false);
  const deletedRef = useRef(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    dirtyRef.current = true;
    setForm((f) => ({ ...f, [k]: v }));
  };

  // Auto pallet weight from products table by name
  const palletWeight = (() => {
    const match = products.find((p) => p.name.trim().toLowerCase() === form.product_name.trim().toLowerCase());
    return Number(match?.default_pallet_weight ?? item.pallet_weight ?? 0);
  })();

  // Debounced autosave + refresh to pull in trigger-computed final_cost_indicative
  useEffect(() => {
    if (!dirtyRef.current) return;
    const t = setTimeout(async () => {
      const trimmedProductName = form.product_name.trim();
      const palletCount = Number(form.pallet_count);
      if (!trimmedProductName || palletCount <= 0) {
        if (deletedRef.current) return;
        deletedRef.current = true;
        const { error } = await supabase.from("shipment_items").delete().eq("id", item.id);
        if (error) {
          deletedRef.current = false;
          toast.error(error.message);
        } else {
          dirtyRef.current = false;
          qc.invalidateQueries({ queryKey: ["shipment-products"] }); qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
        }
        return;
      }
      const totalKg = palletCount * palletWeight;
      const { error } = await supabase
        .from("shipment_items")
        .update({
          product_name: trimmedProductName,
          variety: form.variety || null,
          origin_country: form.origin_country || null,
          caliber: form.caliber || null,
          sku: form.sku || null,
          pallet_count: palletCount,
          pallet_weight: palletWeight,
          unit_price: Number(form.unit_price),
          price_currency: form.price_currency,
          qty: totalKg,
        })
        .eq("id", item.id);
      if (error) toast.error(error.message);
      else {
        dirtyRef.current = false;
        qc.invalidateQueries({ queryKey: ["shipment-products"] }); qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
      }
    }, 600);
    return () => clearTimeout(t);
  }, [form, palletWeight, item.id, qc]);

  const remove = async () => {
    if (!confirm("Видалити позицію?")) return;
    const { error } = await supabase.from("shipment_items").delete().eq("id", item.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["shipment-products"] }); qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
  };

  return (
    <tr className="border-b border-border/40">
      <td className="relative px-0.5 py-0.5">
        <AutocompleteCell
          value={form.product_name}
          onChange={(v) => set("product_name", v)}
          options={products.map((p) => p.name)}
          placeholder="Товар"
          className="font-medium"
          expandedMinWidth={200}
          required={false}
        />
      </td>
      <td className="relative px-0.5 py-0.5">
        <CellInput value={form.variety} placeholder="—" onChange={(v) => set("variety", v)} expandedMinWidth={160} />
      </td>
      <td className="relative px-0.5 py-0.5">
        <AutocompleteCell
          value={form.origin_country}
          onChange={(v) => set("origin_country", v)}
          options={COUNTRY_OPTIONS}
          aliases={COUNTRY_ALIASES}
          placeholder="Країна"
          expandedMinWidth={180}
        />
      </td>
      <td className="relative px-0.5 py-0.5">
        <CellInput value={form.caliber} placeholder="—" onChange={(v) => set("caliber", v)} expandedMinWidth={120} />
      </td>
      <td className="relative px-0.5 py-0.5">
        <CellInput value={form.sku} placeholder="—" onChange={(v) => set("sku", v)} expandedMinWidth={120} />
      </td>
      <td className="relative px-0.5 py-0.5">
        <NumCell
          value={form.pallet_count}
          onChange={(v) => {
            const maxByPallets = Math.max(0, MAX_PALLETS - otherPallets);
            const maxByWeight = palletWeight > 0 ? Math.floor((MAX_WEIGHT_KG - otherKg) / palletWeight) : Infinity;
            const max = Math.max(0, Math.min(maxByPallets, maxByWeight));
            if (v > max) {
              toast.error(`Перевищено ліміт: макс ${MAX_PALLETS} палет / ${MAX_WEIGHT_KG} кг на машину`);
              set("pallet_count", max);
            } else {
              set("pallet_count", v);
            }
          }}
        />
      </td>
      <td className="relative px-0.5 py-0.5">
        <PriceCell
          value={form.unit_price}
          currency={form.price_currency}
          onValueChange={(v) => set("unit_price", v)}
          onCurrencyChange={(c) => set("price_currency", c)}
        />
      </td>
      <td className="px-1.5 py-0.5 text-right">
        <CostPair indicative={item.final_cost_indicative} invoice={item.final_cost_invoice} size="xs" />
      </td>
      <td className="px-0.5 py-0.5">
        <button type="button" onClick={remove} className="p-1 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

const EXPANDED = "absolute left-0 top-[calc(100%+10px)] z-40 h-10 min-w-[160px] w-max max-w-[85vw] rounded-md border border-border bg-card text-sm shadow-xl ring-2 ring-brand/50";
const EXPANDED_RIGHT = "absolute right-0 left-auto top-[calc(100%+10px)] z-40 h-10 min-w-[120px] w-max max-w-[85vw] rounded-md border border-border bg-card text-sm shadow-xl ring-2 ring-brand/50";

function CellInput({ value, onChange, placeholder, className, list, expandedMinWidth }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; list?: string; expandedMinWidth?: number }) {
  const [focused, setFocused] = useState(false);
  return (
    <Input
      value={value}
      list={list}
      placeholder={focused ? "" : placeholder}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onBlur={() => setFocused(false)}
      style={focused && expandedMinWidth ? { minWidth: expandedMinWidth } : undefined}
      className={cn(
        "h-8 border-transparent bg-transparent px-1.5 text-[12px] focus:border-input focus:bg-background",
        focused && EXPANDED,
        className,
      )}
    />
  );
}


function NumCell({ value, onChange, step }: { value: number; onChange: (v: number) => void; step?: string }) {
  const [text, setText] = useState<string>(value === 0 ? "" : String(value));
  const [focused, setFocused] = useState(false);
  // Only resync from prop when NOT focused, to avoid eating typed zeros (e.g. "1.0" → "1")
  useEffect(() => {
    if (focused) return;
    const parsed = text === "" ? 0 : Number(text);
    if (parsed !== value) setText(value === 0 ? "" : String(value));
  }, [value, focused, text]);
  return (
    <Input
      type="text"
      inputMode="decimal"
      step={step ?? "1"}
      value={text}
      placeholder={focused ? "" : "—"}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        // Allow digits, comma, dot. Normalize comma → dot for parsing only.
        const raw = e.target.value.replace(/[^\d.,-]/g, "");
        setText(raw);
        const normalized = raw.replace(",", ".");
        // Don't push parent updates for incomplete numbers like "", "-", "1.", "0."
        if (normalized === "" || normalized === "-" || /[.,]$/.test(raw)) {
          if (raw === "") onChange(0);
          return;
        }
        const n = Number(normalized);
        if (!Number.isNaN(n)) onChange(n);
      }}
      className={cn(
        "h-8 border-transparent bg-transparent px-1.5 text-right text-[12px] tabular-nums focus:border-input focus:bg-background",
        focused && EXPANDED_RIGHT + " text-right",
      )}
    />
  );
}

function PriceCell({ value, currency, onValueChange, onCurrencyChange }: {
  value: number; currency: "EUR" | "USD";
  onValueChange: (v: number) => void;
  onCurrencyChange: (c: "EUR" | "USD") => void;
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
      "flex items-center gap-0.5 rounded",
      isEmpty && "ring-2 ring-destructive bg-destructive/15",
    )}>
      <Input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={focused ? "" : (isEmpty ? "Ціна*" : "—")}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
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
          "h-8 w-full border-transparent bg-transparent px-1 text-right text-[12px] tabular-nums focus:border-input focus:bg-background",
          focused && EXPANDED_RIGHT + " text-right",
          isEmpty && "text-destructive placeholder:text-destructive font-semibold",
        )}
      />
      <select
        value={currency}
        onChange={(e) => onCurrencyChange(e.target.value as "EUR" | "USD")}
        className="h-8 rounded border-transparent bg-transparent px-0.5 text-[10px] focus:border-input focus:bg-background"
      >
        <option value="EUR">€</option>
        <option value="USD">$</option>
      </select>
    </div>
  );
}
