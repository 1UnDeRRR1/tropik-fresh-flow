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

type ItemRow = {
  id: string;
  product_name: string | null;
  caliber: string | null;
  sku: string | null;
  pallet_count: number | null;
  pallet_weight: number | null;
  invoice_price: number | null;
  indicative_price: number | null;
};

type ShipmentRow = {
  id: string;
  code: string;
  country: string | null;
};

function ProductsFullscreen() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["shipment-products", id],
    queryFn: async () => {
      const [s, items] = await Promise.all([
        supabase.from("shipments").select("id,code,country").eq("id", id).single(),
        supabase.from("shipment_items").select("id,product_name,caliber,sku,pallet_count,pallet_weight,invoice_price,indicative_price").eq("shipment_id", id).order("created_at"),
      ]);
      return { shipment: s.data as ShipmentRow | null, items: (items.data ?? []) as ItemRow[] };
    },
  });

  const sh = data?.shipment;
  const items = data?.items ?? [];
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
      invoice_price: 0,
      indicative_price: 0,
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

      <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide">
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-success" />ІНДИКАТИВ</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-destructive" />ІНВОЙС</span>
      </div>

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
                <th className="px-1.5 py-2 text-left font-medium">Калібр</th>
                <th className="px-1.5 py-2 text-left font-medium">Спец.</th>
                <th className="px-1.5 py-2 text-right font-medium">Пал.</th>
                <th className="px-1.5 py-2 text-right font-medium">Кг/пал</th>
                <th className="px-1.5 py-2 text-right font-medium text-success">Інд.</th>
                <th className="px-1.5 py-2 text-right font-medium text-destructive">Інв.</th>
                <th className="px-1.5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <ProductRowEditor key={it.id} item={it} shipmentId={id} />
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

function ProductRowEditor({ item, shipmentId }: { item: ItemRow; shipmentId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    product_name: item.product_name ?? "",
    caliber: item.caliber ?? "",
    sku: item.sku ?? "",
    pallet_count: item.pallet_count ?? 0,
    pallet_weight: item.pallet_weight ?? 0,
    indicative_price: item.indicative_price ?? 0,
    invoice_price: item.invoice_price ?? 0,
  });
  const dirtyRef = useRef(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    dirtyRef.current = true;
    setForm((f) => ({ ...f, [k]: v }));
  };

  // Debounced autosave
  useEffect(() => {
    if (!dirtyRef.current) return;
    const t = setTimeout(async () => {
      const totalKg = Number(form.pallet_count) * Number(form.pallet_weight);
      const { error } = await supabase
        .from("shipment_items")
        .update({
          product_name: form.product_name,
          caliber: form.caliber || null,
          sku: form.sku || null,
          pallet_count: Number(form.pallet_count),
          pallet_weight: Number(form.pallet_weight),
          invoice_price: Number(form.invoice_price),
          indicative_price: Number(form.indicative_price),
          unit_price: Number(form.invoice_price),
          qty: totalKg,
        })
        .eq("id", item.id);
      if (error) toast.error(error.message);
      else dirtyRef.current = false;
    }, 600);
    return () => clearTimeout(t);
  }, [form, item.id]);

  const remove = async () => {
    if (!confirm("Видалити позицію?")) return;
    const { error } = await supabase.from("shipment_items").delete().eq("id", item.id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["shipment-products", shipmentId] });
  };

  return (
    <tr className="border-b border-border/40">
      <td className="px-0.5 py-0.5">
        <CellInput value={form.product_name} placeholder="Товар" onChange={(v) => set("product_name", v)} className="font-medium" />
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
        <NumCell value={form.pallet_weight} onChange={(v) => set("pallet_weight", v)} />
      </td>
      <td className="px-0.5 py-0.5">
        <NumCell value={form.indicative_price} onChange={(v) => set("indicative_price", v)} step="0.01" tone="success" />
      </td>
      <td className="px-0.5 py-0.5">
        <NumCell value={form.invoice_price} onChange={(v) => set("invoice_price", v)} step="0.01" tone="destructive" />
      </td>
      <td className="px-0.5 py-0.5">
        <button type="button" onClick={remove} className="p-1 text-muted-foreground hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

function CellInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <Input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      className={cn("h-8 border-transparent bg-transparent px-1.5 text-[12px] focus:border-input focus:bg-background", className)}
    />
  );
}

function NumCell({ value, onChange, step, tone }: { value: number; onChange: (v: number) => void; step?: string; tone?: "success" | "destructive" }) {
  // Show empty when 0 to avoid leading-zero typing issues
  const [text, setText] = useState<string>(value === 0 ? "" : String(value));
  useEffect(() => {
    setText(value === 0 ? "" : String(value));
  }, [value]);
  return (
    <Input
      type="number"
      inputMode="decimal"
      step={step ?? "1"}
      value={text}
      placeholder="0"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        onChange(v === "" ? 0 : Number(v));
      }}
      className={cn(
        "h-8 border-transparent bg-transparent px-1.5 text-right text-[12px] tabular-nums focus:border-input focus:bg-background",
        tone === "success" && "text-success",
        tone === "destructive" && "text-destructive",
      )}
    />
  );
}
