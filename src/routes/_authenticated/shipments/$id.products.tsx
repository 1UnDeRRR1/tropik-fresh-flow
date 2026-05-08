import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { toUaCountry } from "@/lib/countries";

export const Route = createFileRoute("/_authenticated/shipments/$id/products")({
  component: ProductsFullscreen,
});

const ORIGIN_COUNTRIES = ["Греція", "Італія", "Іспанія", "Нідерланди", "Бельгія", "Польща", "Молдова", "Албанія", "Македонія"];

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
  cost_price_usd: number | null;
};

type ShipmentRow = {
  id: string;
  code: string;
  country: string | null;
  logistics_cost: number | null;
  logistics_cost_currency: string | null;
};

type ProductRef = { name: string; default_pallet_weight: number | null };

function ProductsFullscreen() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["shipment-products", id],
    queryFn: async () => {
      const [s, items, prods] = await Promise.all([
        supabase.from("shipments").select("id,code,country,logistics_cost,logistics_cost_currency").eq("id", id).single(),
        supabase.from("shipment_items").select("id,product_name,variety,origin_country,caliber,sku,pallet_count,pallet_weight,unit_price,price_currency,cost_price_usd").eq("shipment_id", id).order("created_at"),
        supabase.from("products").select("name,default_pallet_weight").eq("is_active", true),
      ]);
      return {
        shipment: s.data as ShipmentRow | null,
        items: (items.data ?? []) as ItemRow[],
        products: (prods.data ?? []) as ProductRef[],
      };
    },
  });

  const sh = data?.shipment;
  const items = data?.items ?? [];
  const products = data?.products ?? [];
  const country = toUaCountry(sh?.country) || "—";

  const addItem = async () => {
    const { error } = await supabase.from("shipment_items").insert({
      shipment_id: id,
      product_name: "",
      qty: 0,
      unit: "kg",
      unit_price: 0,
      price_currency: "EUR",
      pallet_count: 0,
      pallet_weight: 0,
      cost_price_usd: 0,
    });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["shipment-products", id] });
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 pt-safe">
        <button
          type="button"
          onClick={() => navigate({ to: "/shipments/$id", params: { id } })}
          className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Назад
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="truncate text-sm font-semibold">{sh?.code ?? "…"}</div>
          <div className="truncate text-[10px] uppercase tracking-wide text-muted-foreground">{country} · {items.length} поз.</div>
        </div>
        <Button size="sm" onClick={addItem} className="bg-brand text-brand-foreground hover:bg-brand/90">
          <Plus className="h-4 w-4" />
        </Button>
      </header>

      {sh && <TransportBar shipment={sh} />}

      <div className="flex-1 overflow-auto">
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
                <th className="px-1.5 py-2 text-right font-medium">Собів. $</th>
                <th className="px-1.5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <ProductRowEditor key={it.id} item={it} shipmentId={id} products={products} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <footer className="border-t border-border bg-card px-3 py-2 pb-safe">
        <Link to="/shipments/$id" params={{ id }} className="block">
          <Button className="w-full bg-brand text-brand-foreground hover:bg-brand/90">Готово</Button>
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

  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(async () => {
      const { error } = await supabase
        .from("shipments")
        .update({ logistics_cost: val === "" ? 0 : Number(val), logistics_cost_currency: cur })
        .eq("id", shipment.id);
      if (error) toast.error(error.message);
      else {
        dirty.current = false;
        qc.invalidateQueries({ queryKey: ["shipment-products", shipment.id] });
      }
    }, 600);
    return () => clearTimeout(t);
  }, [val, cur, shipment.id, qc]);

  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Перевезення авто</span>
      <Input
        type="number"
        inputMode="decimal"
        step="0.01"
        placeholder="0"
        value={val}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => { dirty.current = true; setVal(e.target.value); }}
        className="h-7 flex-1 px-2 text-[12px]"
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

function ProductRowEditor({ item, shipmentId, products }: { item: ItemRow; shipmentId: string; products: ProductRef[] }) {
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
    cost_price_usd: item.cost_price_usd ?? 0,
  });
  const dirtyRef = useRef(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    dirtyRef.current = true;
    setForm((f) => ({ ...f, [k]: v }));
  };

  // Auto pallet weight from products table by name
  const palletWeight = (() => {
    const match = products.find((p) => p.name.trim().toLowerCase() === form.product_name.trim().toLowerCase());
    return Number(match?.default_pallet_weight ?? item.pallet_weight ?? 0);
  })();

  // Debounced autosave
  useEffect(() => {
    if (!dirtyRef.current) return;
    const t = setTimeout(async () => {
      const totalKg = Number(form.pallet_count) * palletWeight;
      const { error } = await supabase
        .from("shipment_items")
        .update({
          product_name: form.product_name,
          variety: form.variety || null,
          origin_country: form.origin_country || null,
          caliber: form.caliber || null,
          sku: form.sku || null,
          pallet_count: Number(form.pallet_count),
          pallet_weight: palletWeight,
          unit_price: Number(form.unit_price),
          price_currency: form.price_currency,
          cost_price_usd: Number(form.cost_price_usd),
          qty: totalKg,
        })
        .eq("id", item.id);
      if (error) toast.error(error.message);
      else dirtyRef.current = false;
    }, 600);
    return () => clearTimeout(t);
  }, [form, palletWeight, item.id]);

  const remove = async () => {
    if (!confirm("Видалити позицію?")) return;
    const { error } = await supabase.from("shipment_items").delete().eq("id", item.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["shipment-products", shipmentId] });
  };

  return (
    <tr className="border-b border-border/40">
      <td className="px-0.5 py-0.5">
        <CellInput value={form.product_name} placeholder="Товар" onChange={(v) => set("product_name", v)} className="font-medium" list="products-list" />
        <datalist id="products-list">
          {products.map((p) => <option key={p.name} value={p.name} />)}
        </datalist>
      </td>
      <td className="px-0.5 py-0.5">
        <CellInput value={form.variety} placeholder="—" onChange={(v) => set("variety", v)} />
      </td>
      <td className="px-0.5 py-0.5">
        <SelectCell value={form.origin_country} options={ORIGIN_COUNTRIES} onChange={(v) => set("origin_country", v)} />
      </td>
      <td className="px-0.5 py-0.5">
        <CellInput value={form.caliber} placeholder="—" onChange={(v) => set("caliber", v)} />
      </td>
      <td className="px-0.5 py-0.5">
        <CellInput value={form.sku} placeholder="—" onChange={(v) => set("sku", v)} />
      </td>
      <td className="px-0.5 py-0.5">
        <NumCell value={form.pallet_count} onChange={(v) => set("pallet_count", v)} />
      </td>
      <td className="px-0.5 py-0.5">
        <PriceCell
          value={form.unit_price}
          currency={form.price_currency}
          onValueChange={(v) => set("unit_price", v)}
          onCurrencyChange={(c) => set("price_currency", c)}
        />
      </td>
      <td className="px-0.5 py-0.5">
        <NumCell value={form.cost_price_usd} onChange={(v) => set("cost_price_usd", v)} step="0.01" />
      </td>
      <td className="px-0.5 py-0.5">
        <button type="button" onClick={remove} className="p-1 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

function CellInput({ value, onChange, placeholder, className, list }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; list?: string }) {
  const [focused, setFocused] = useState(false);
  return (
    <Input
      value={value}
      list={list}
      placeholder={focused ? "" : placeholder}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onBlur={() => setFocused(false)}
      className={cn("h-8 border-transparent bg-transparent px-1.5 text-[12px] focus:border-input focus:bg-background", className)}
    />
  );
}

function SelectCell({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-full rounded-md border border-transparent bg-transparent px-1 text-[12px] focus:border-input focus:bg-background"
    >
      <option value="">—</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function NumCell({ value, onChange, step }: { value: number; onChange: (v: number) => void; step?: string }) {
  const [text, setText] = useState<string>(value === 0 ? "" : String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    setText(value === 0 ? "" : String(value));
  }, [value]);
  return (
    <Input
      type="number"
      inputMode="decimal"
      step={step ?? "1"}
      value={text}
      placeholder={focused ? "" : "0"}
      onFocus={(e) => {
        setFocused(true);
        e.currentTarget.select();
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        onChange(v === "" ? 0 : Number(v));
      }}
      className="h-8 border-transparent bg-transparent px-1.5 text-right text-[12px] tabular-nums focus:border-input focus:bg-background"
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
  useEffect(() => { setText(value === 0 ? "" : String(value)); }, [value]);
  return (
    <div className="flex items-center gap-0.5">
      <Input
        type="number"
        inputMode="decimal"
        step="0.01"
        value={text}
        placeholder={focused ? "" : "0"}
        onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
        onBlur={() => setFocused(false)}
        onChange={(e) => { setText(e.target.value); onValueChange(e.target.value === "" ? 0 : Number(e.target.value)); }}
        className="h-8 w-full border-transparent bg-transparent px-1 text-right text-[12px] tabular-nums focus:border-input focus:bg-background"
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
