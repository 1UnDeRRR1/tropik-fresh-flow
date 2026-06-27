// Build 2A.5 — /shipments/new-only draft card.
//
// This component is intentionally separate from
// src/components/shipments/ShipmentProductCard.tsx so that the create screen
// can ship its required layout (Товар + Походження on one row, compact
// 8-row body, local-only Ящ./пал. and Вага палети) without touching the
// shared card used by /shipments/$id/products.
//
// Hard rules respected here:
//   - Zero DB writes. Reads only (autocomplete options, pallet resolver).
//   - Cost block is a visual placeholder for Build 2A; full FX/customs/
//     transport wiring is scheduled for Build 2B.
//   - Identity-lock: Товар + Походження become read-only ONLY when
//     productOriginLocked is true (parent passes it when source_position_id
//     is present — i.e. fromOffer prefill).
//   - All other product detail fields stay editable in this Build because
//     they live only in local DraftRow state. Persistence guarantees for the
//     saved editor are unchanged.

import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

import { useCountryAliases } from "@/hooks/useCountryAliases";
import { useCountryOptions } from "@/hooks/useCountryOptions";
import { useCustomsCountries } from "@/hooks/useCustomsCountries";
import { useProductAliases } from "@/hooks/useProductAliases";
import { useVarietiesFor } from "@/hooks/useProductVarieties";
import { CellInput, NumCell, PackageCell, PriceCell } from "@/components/shipments/cells";
import { StrictSelectCard } from "@/components/shipments/StrictSelectCard";
import { StrictAutocompleteCard } from "@/components/shipments/StrictAutocompleteCard";
import { isKnownProductName, type DraftRow, type ProductRef } from "@/lib/shipment-row-engine";
import { resolvePalletForText } from "@/lib/pallet-resolver";
import { resolveProductOption } from "@/lib/product-aliases";
import { matchesWordStart } from "@/lib/compact-search";
import { triggerInvalidFeedback } from "@/lib/invalid-feedback";
import { fetchCustomsRef, resolveOfferCost } from "@/lib/offer-cost";
import { getCustomsStatusFromRef, CUSTOMS_STRINGS } from "@/lib/customs-status";
import { CustomsStatusChip } from "@/components/CustomsStatusChip";
import { getLatestEurUsdRate } from "@/lib/currency";
import { CostPair } from "@/components/CostPair";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type DictItem = { key: string; label: string; searchStrings: string[] };

function buildDictItems(options: string[], aliases?: Record<string, string>): DictItem[] {
  const norm = Array.from(new Set(options.map((o) => o.trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "uk"),
  );
  return norm.map((opt) => {
    const lower = opt.toLowerCase();
    const aliasStrs = aliases
      ? Object.entries(aliases)
          .filter(([, t]) => t.toLowerCase() === lower)
          .map(([a]) => a)
      : [];
    return { key: opt, label: opt, searchStrings: [opt, ...aliasStrs].filter(Boolean) };
  });
}

function resolveDictionary(
  raw: string,
  options: string[],
  aliases?: Record<string, string>,
): string | null {
  const l = raw.trim().toLowerCase();
  if (!l) return null;
  const norm = options.map((o) => o.trim()).filter(Boolean);
  if (!aliases) {
    const p = resolveProductOption(raw, norm);
    if (p) return p;
  }
  const direct = norm.find((o) => o.toLowerCase() === l);
  if (direct) return direct;
  if (aliases && aliases[l]) {
    const t = aliases[l].toLowerCase();
    const aliased = norm.find((o) => o.toLowerCase() === t);
    if (aliased) return aliased;
    return aliases[l];
  }
  const subs = norm.filter((o) => matchesWordStart(o, l));
  if (subs.length === 1) return subs[0];
  return null;
}

const CLASS_OPTIONS = ["LUX", "1", "1,5", "1b", "2", "IND"];

const MAX_PALLETS = 26;
const MAX_WEIGHT_KG = 21500;

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

export function NewShipmentProductCard({
  draft,
  products,
  otherPallets,
  otherKg,
  productOriginLocked = false,
  index,
  transportAmount,
  transportCurrency,
  onPatch,
  onRemove,
}: {
  draft: DraftRow;
  products: ProductRef[];
  otherPallets: number;
  otherKg: number;
  productOriginLocked?: boolean;
  index: number;
  transportAmount: number | null;
  transportCurrency: "EUR" | "USD";
  onPatch: (patch: Partial<DraftRow>) => void;
  onRemove: () => void;
}) {
  const productAliases = useProductAliases();
  const countryAliases = useCountryAliases();
  const COUNTRY_OPTIONS = useCountryOptions();
  const customsCountriesRaw = useCustomsCountries();
  const knownProductNames = products.map((p) => p.name);

  // Build 2A.9 — Походження list must only show countries present in
  // customs_reference. Resolve each customs row to a canonical countries.name
  // via case-insensitive match + country aliases; drop rows that don't map.
  const allowedOriginCountries = useMemo(() => {
    const byLc = new Map(COUNTRY_OPTIONS.map((c) => [c.toLowerCase(), c]));
    const out = new Set<string>();
    for (const raw of customsCountriesRaw) {
      const lc = raw.trim().toLowerCase();
      if (!lc) continue;
      const direct = byLc.get(lc);
      if (direct) { out.add(direct); continue; }
      const aliased = countryAliases[lc];
      if (aliased) {
        const hit = byLc.get(aliased.toLowerCase());
        if (hit) out.add(hit);
      }
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b, "uk"));
  }, [COUNTRY_OPTIONS, customsCountriesRaw, countryAliases]);

  const form = draft;
  const formRef = useRef(form);
  formRef.current = form;
  const touchedRef = useRef({ product: false, country: false });
  const productWrapRef = useRef<HTMLDivElement>(null);
  const originWrapRef = useRef<HTMLDivElement>(null);
  const productItems = useMemo(() => buildDictItems(knownProductNames, productAliases), [knownProductNames, productAliases]);
  const originItems = useMemo(() => buildDictItems(allowedOriginCountries, countryAliases), [allowedOriginCountries, countryAliases]);

  // Build 2A.9 — variety options for the picked product (existing source).
  // Auto-pick when there is exactly one option and nothing is selected.
  const varieties = useVarietiesFor(form.product_name);
  useEffect(() => {
    if (!form.product_name.trim()) return;
    if (form.variety) return;
    if (varieties.length === 1) onPatch({ variety: varieties[0] });
  }, [form.product_name, form.variety, varieties, onPatch]);


  const palletCountNum = Number(form.pallet_count) || 0;
  const netNum = Number(form.net_weight_kg) || 0;
  const grossNum = Number(form.gross_weight_kg) || 0;
  const invalidProduct = !form.product_name.trim();
  const unknownProduct = !!form.product_name.trim() && !isKnownProductName(form.product_name, products);
  const invalidCountry = !form.origin_country.trim();
  const invalidPallets = palletCountNum <= 0;
  const invalidNet = netNum <= 0;
  const invalidGross = grossNum <= 0;
  const netGtGross = netNum > 0 && grossNum > 0 && netNum > grossNum;
  const invalidPrice = !form.unit_price || Number(form.unit_price) <= 0;

  type Hint =
    | { status: "pallet_no_match" | "product_no_match" | "product_ambiguous" | "country_no_match" }
    | null;
  const [hint, setHint] = useState<Hint>(null);
  const resolverSeqRef = useRef(0);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const productOriginReadOnly = productOriginLocked;

  // --- Build 2B-A: cost preview (open / preliminary). Read-only. -----------
  const priceCcy: "EUR" | "USD" = form.price_currency === "USD" ? "USD" : "EUR";
  const needsFxLocal =
    priceCcy === "EUR" || transportCurrency === "EUR";

  const fxQ = useQuery({
    queryKey: ["fx-eur-usd-latest"],
    enabled: needsFxLocal,
    staleTime: 5 * 60_000,
    queryFn: async () => await getLatestEurUsdRate(),
  });

  const productKey = form.product_name.trim();
  const countryKey = form.origin_country.trim();
  const customsQ = useQuery({
    queryKey: ["customs-ref", productKey.toLowerCase(), countryKey.toLowerCase()],
    enabled: !!productKey && !!countryKey,
    staleTime: 5 * 60_000,
    queryFn: async () => await fetchCustomsRef(productKey, countryKey),
  });

  // Derive net/gross per pallet from current local fields (no fallbacks
  // beyond what's already entered). Mirrors logic used elsewhere.
  const palletsForCalc = palletCountNum > 0 ? palletCountNum : 0;
  const netPerPallet = palletsForCalc > 0 && netNum > 0
    ? netNum / palletsForCalc
    : (form.resolver_net_per_pallet_kg != null ? Number(form.resolver_net_per_pallet_kg) : 0);
  const grossPerPallet =
    form.pallet_weight_override_kg != null && Number(form.pallet_weight_override_kg) > 0
      ? Number(form.pallet_weight_override_kg)
      : palletsForCalc > 0 && grossNum > 0
        ? grossNum / palletsForCalc
        : (form.resolver_gross_per_pallet_kg != null ? Number(form.resolver_gross_per_pallet_kg) : 0);

  const customsRef = customsQ.data ?? null;
  const customsStatus = customsQ.isFetched
    ? getCustomsStatusFromRef(customsRef)
    : null;
  const manualDuty =
    form.customs_override_duty_usd != null && Number(form.customs_override_duty_usd) > 0
      ? Number(form.customs_override_duty_usd)
      : null;
  const manualActive = customsStatus === "red" && manualDuty != null;

  const costRes = useMemo(() => {
    return resolveOfferCost({
      pricePerKg: Number(form.unit_price || 0),
      priceCurrency: priceCcy,
      freight: Number(transportAmount ?? 0),
      freightCurrency: transportCurrency,
      netPerPalletKg: netPerPallet,
      grossPerPalletKg: grossPerPallet,
      fxRate: fxQ.data?.rate ?? null,
      country: countryKey,
      ref: customsRef,
      manualCustomsDuty: manualDuty,
    });
  }, [form.unit_price, priceCcy, transportAmount, transportCurrency, netPerPallet, grossPerPallet, fxQ.data?.rate, countryKey, customsRef, manualDuty]);

  // Reset manual customs duty when product or country changes — manual value
  // is bound to a specific (product, country) pair.
  const lastKeyRef = useRef<string>(`${productKey.toLowerCase()}|${countryKey.toLowerCase()}`);
  useEffect(() => {
    const key = `${productKey.toLowerCase()}|${countryKey.toLowerCase()}`;
    if (key !== lastKeyRef.current) {
      lastKeyRef.current = key;
      if (form.customs_override_duty_usd != null) {
        onPatch({ customs_override_duty_usd: null });
      }
    }
  }, [productKey, countryKey, form.customs_override_duty_usd, onPatch]);


  const runResolver = useCallback(async () => {
    if (!touchedRef.current.product && !touchedRef.current.country) return;
    const latest = formRef.current;
    const product = latest.product_name.trim();
    const country = latest.origin_country.trim();
    if (!product || !country) return;
    const seq = ++resolverSeqRef.current;
    try {
      const { data, error } = await supabase.rpc(
        "rpc_resolve_offer_line_defaults" as never,
        {
          p_product_query: product,
          p_country_query: country,
          p_package_used: null,
          p_include_reserve: false,
        } as never,
      );
      if (seq !== resolverSeqRef.current) return;
      if (error) { setHint(null); return; }
      const row = Array.isArray(data) ? (data as unknown[])[0] : data;
      const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
      const status = r.status;
      if (status === "product_no_match" || status === "product_ambiguous" || status === "country_no_match") {
        setHint({ status });
        return;
      }
      const pal = await resolvePalletForText(product, country);
      if (seq !== resolverSeqRef.current) return;
      const cur = formRef.current;
      if (pal.matchType !== "no_match" && pal.selected) {
        const pNet = pal.selected.pallet_net_kg;
        const pGross = pal.selected.pallet_gross_kg;
        const pkg = pal.selected.package_used;
        setHint(null);
        const pc = (Number(cur.pallet_count) || 0) > 0 ? Number(cur.pallet_count) : 1;
        onPatch({
          pallet_count: pc,
          package_used: pkg ?? cur.package_used,
          resolver_net_per_pallet_kg: pNet,
          resolver_gross_per_pallet_kg: pGross,
          net_auto: true,
          gross_auto: true,
          net_weight_kg: pNet != null ? pNet * pc : cur.net_weight_kg,
          gross_weight_kg: pGross != null ? pGross * pc : cur.gross_weight_kg,
        });
      } else {
        setHint({ status: "pallet_no_match" });
      }
    } catch {
      if (seq === resolverSeqRef.current) setHint(null);
    }
  }, [onPatch]);

  const handleResolverBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    void runResolver();
  };

  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-sm">
      {/* Header: index + delete */}
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Позиція {index + 1}
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Видалити рядок"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Row 1: Товар + Походження */}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div ref={productWrapRef} onBlur={handleResolverBlur}>
          <FieldLabel>Товар</FieldLabel>
          <StrictAutocompleteCard
            value={form.product_name}
            onValueChange={(v) => {
              if (productOriginReadOnly) return;
              touchedRef.current.product = true;
              setHint(null);
              const cleaned = v.replace(/[^\p{L}\s\-']/gu, "");
              onPatch({ product_name: cleaned });
            }}
            items={productItems}
            getKey={(i) => i.key}
            getLabel={(i) => i.label}
            getSearchStrings={(i) => i.searchStrings}
            onSelect={(i) => onPatch({ product_name: i.label })}
            onInputBlur={(raw) => {
              if (productOriginReadOnly) return;
              const c = resolveDictionary(raw, knownProductNames, productAliases);
              if (c && c !== raw.trim()) { onPatch({ product_name: c }); return; }
              if (!raw.trim()) return;
              if (!c) {
                triggerInvalidFeedback(productWrapRef.current);
                window.setTimeout(() => onPatch({ product_name: "" }), 700);
              }
            }}
            onCommit={() => { void runResolver(); }}
            placeholder="Товар"
            readOnly={productOriginReadOnly}
            inputClassName={cn(
              "h-9 w-full text-[13px] font-medium",
              (invalidProduct || unknownProduct) && "border-destructive/70 ring-1 ring-destructive/40",
              productOriginReadOnly && "cursor-default",
            )}
          />
        </div>
        <div ref={originWrapRef} onBlur={handleResolverBlur}>
          <FieldLabel>Походження</FieldLabel>
          <StrictAutocompleteCard
            value={form.origin_country}
            onValueChange={(v) => {
              if (productOriginReadOnly) return;
              touchedRef.current.country = true;
              setHint(null);
              const cleaned = v.replace(/[^\p{L}\s\-']/gu, "");
              onPatch({ origin_country: cleaned });
            }}
            items={originItems}
            getKey={(i) => i.key}
            getLabel={(i) => i.label}
            getSearchStrings={(i) => i.searchStrings}
            onSelect={(i) => onPatch({ origin_country: i.label })}
            onInputBlur={(raw) => {
              if (productOriginReadOnly) return;
              const c = resolveDictionary(raw, allowedOriginCountries, countryAliases);
              if (c && c !== raw.trim()) { onPatch({ origin_country: c }); return; }
              if (!raw.trim()) return;
              if (!c) {
                triggerInvalidFeedback(originWrapRef.current);
                window.setTimeout(() => onPatch({ origin_country: "" }), 700);
              }
            }}
            onCommit={() => { void runResolver(); }}
            placeholder="Походження"
            readOnly={productOriginReadOnly}
            inputClassName={cn(
              "h-9 w-full text-[13px]",
              invalidCountry && "border-destructive/70 ring-1 ring-destructive/40",
              productOriginReadOnly && "cursor-default",
            )}
          />
        </div>
      </div>
      {productOriginLocked && (
        <div className="mb-2 -mt-1 text-[10px] text-muted-foreground">
          Товар і Походження зафіксовано position_id — змінити не можна
        </div>
      )}

      {/* Row 2: Сорт + Калібр */}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <FieldLabel>Сорт</FieldLabel>
          <StrictSelectCard
            value={form.variety}
            onChange={(v) => onPatch({ variety: v })}
            options={varieties}
            placeholder="Сорт"
            ariaLabel="Сорт"
          />
        </div>
        <div>
          <FieldLabel>Калібр</FieldLabel>
          <CellInput
            value={form.caliber}
            placeholder="Калібр"
            onChange={(v) => {
              // Hard 5-char limit; silently trim extras instead of letting
              // them sneak into local draft state.
              onPatch({ caliber: v.slice(0, 5) });
            }}
            expandedMinWidth={160}
          />
        </div>
      </div>

      {/* Row 3: Бренд + Клас */}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <FieldLabel>Бренд</FieldLabel>
          <CellInput
            value={form.brand ?? ""}
            placeholder="Бренд"
            onChange={(v) => onPatch({ brand: v })}
            expandedMinWidth={180}
          />
        </div>
        <div>
          <FieldLabel>Клас</FieldLabel>
          <StrictSelectCard
            value={form.class ?? ""}
            onChange={(v) => onPatch({ class: v })}
            options={CLASS_OPTIONS}
            placeholder="—"
            ariaLabel="Клас"
          />
        </div>
      </div>


      {/* Row 4: Упаковка (full width) */}
      <div className="mb-2">
        <FieldLabel>Упаковка</FieldLabel>
        <PackageCell
          value={form.package_used}
          productName={form.product_name}
          countryName={form.origin_country}
          readOnly={false}
          onChangeText={(text) => onPatch({ package_used: text })}
          onSelect={(opt) => {
            const pc = Number(form.pallet_count) > 0 ? Number(form.pallet_count) : 1;
            const pNet = opt.pallet_net_kg;
            const pGross = opt.pallet_gross_kg;
            onPatch({
              package_used: opt.package_used,
              pallet_count: Number(form.pallet_count) > 0 ? Number(form.pallet_count) : pc,
              resolver_net_per_pallet_kg: pNet,
              resolver_gross_per_pallet_kg: pGross,
              net_auto: true,
              gross_auto: true,
              net_weight_kg: pNet != null ? pNet * pc : form.net_weight_kg,
              gross_weight_kg: pGross != null ? pGross * pc : form.gross_weight_kg,
            });
          }}
        />
      </div>

      {/* Row 5: Ящ./пал. + К-ть палет + Вага палети */}
      <div className="mb-2 grid grid-cols-3 gap-2">
        <div>
          <FieldLabel>Ящ./пал.</FieldLabel>
          <NumCell
            value={Number(form.boxes_per_pallet ?? 0)}
            step="1"
            placeholder="Ящ."
            onChange={(v) => onPatch({ boxes_per_pallet: v > 0 ? v : null })}
          />
        </div>
        <div>
          <FieldLabel>К-ть палет</FieldLabel>
          <NumCell
            value={form.pallet_count}
            invalid={invalidPallets}
            placeholder="Палети"
            onChange={(v) => {
              const patch: Partial<DraftRow> = { pallet_count: v };
              const overrideGross =
                form.pallet_weight_override_kg != null && Number(form.pallet_weight_override_kg) > 0
                  ? Number(form.pallet_weight_override_kg)
                  : null;
              if (overrideGross != null) {
                patch.gross_weight_kg = overrideGross * v;
              } else if (form.gross_auto && form.resolver_gross_per_pallet_kg != null) {
                patch.gross_weight_kg = form.resolver_gross_per_pallet_kg * v;
              }
              if (form.net_auto && form.resolver_net_per_pallet_kg != null) {
                patch.net_weight_kg = form.resolver_net_per_pallet_kg * v;
              }
              const simGross = patch.gross_weight_kg != null ? Number(patch.gross_weight_kg) : grossNum;
              const simNet = patch.net_weight_kg != null ? Number(patch.net_weight_kg) : netNum;
              const newRowKg = simGross > 0 ? simGross : simNet;
              const newTotalPallets = otherPallets + v;
              const newTotalKg = otherKg + newRowKg;
              if (newTotalPallets > MAX_PALLETS) {
                toast.error(`Перевищено ліміт авто: ${newTotalPallets}/${MAX_PALLETS} палет.`);
              } else if (newTotalKg > MAX_WEIGHT_KG) {
                toast.error(`Перевищено ліміт ваги: ${Math.round(newTotalKg)}/${MAX_WEIGHT_KG} кг.`);
              }
              onPatch(patch);
            }}
          />
        </div>
        <div>
          <FieldLabel>Вага палети брутто</FieldLabel>
          <NumCell
            value={
              form.pallet_weight_override_kg != null
                ? Math.round(Number(form.pallet_weight_override_kg))
                : form.resolver_gross_per_pallet_kg != null
                  ? Math.round(Number(form.resolver_gross_per_pallet_kg))
                  : form.pallet_count > 0 && grossNum > 0
                    ? Math.round(grossNum / form.pallet_count)
                    : 0
            }
            step="1"
            placeholder="кг/пал"
            onChange={(v) => {
              const safe = v > 0 ? v : null;
              const patch: Partial<DraftRow> = {
                pallet_weight_override_kg: safe,
                gross_auto: false,
              };
              if (safe != null && form.pallet_count > 0) {
                patch.gross_weight_kg = safe * form.pallet_count;
              }
              onPatch(patch);
            }}
          />
        </div>
      </div>

      {/* Row 6: Нетто + Брутто */}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <FieldLabel>Нетто, кг</FieldLabel>
          <NumCell
            value={Math.round(netNum)}
            step="1"
            invalid={invalidNet || netGtGross}
            placeholder="Нетто"
            onChange={(v) => onPatch({ net_weight_kg: Math.max(0, v), net_auto: false })}
          />
          {netGtGross && (
            <div className="mt-0.5 text-[10px] text-destructive">Нетто не може бути більше брутто</div>
          )}
        </div>
        <div>
          <FieldLabel>Брутто, кг</FieldLabel>
          <NumCell
            value={Math.round(grossNum)}
            step="1"
            invalid={invalidGross || netGtGross}
            placeholder="Брутто"
            onChange={(v) => onPatch({
              gross_weight_kg: Math.max(0, v),
              gross_auto: false,
              pallet_weight_override_kg: null,
            })}
          />
        </div>
      </div>

      {/* Auto helper */}
      {(form.net_auto || form.gross_auto) &&
        (form.resolver_net_per_pallet_kg != null || form.resolver_gross_per_pallet_kg != null) && (
          <div className="mb-2 -mt-1 text-[10px] text-muted-foreground">
            Авто: 1 пал ={" "}
            {form.resolver_net_per_pallet_kg != null
              ? `${Math.round(Number(form.resolver_net_per_pallet_kg))} нетто`
              : "—"}{" "}
            /{" "}
            {form.resolver_gross_per_pallet_kg != null
              ? `${Math.round(Number(form.resolver_gross_per_pallet_kg))} брутто`
              : "—"}{" "}
            кг
          </div>
        )}

      {/* Row 7: Price + Currency */}
      <div className="mb-2">
        <FieldLabel>Ціна за кг</FieldLabel>
        <div className={cn(invalidPrice && "field-invalid")}>
          <PriceCell
            value={form.unit_price}
            currency={form.price_currency}
            onValueChange={(v) => onPatch({ unit_price: v })}
            onCurrencyChange={(c) => onPatch({ price_currency: c })}
          />
        </div>
      </div>

      {/* Row 8: Cost preview (Build 2B-A — read-only, no DB writes). */}
      <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Розрахунок собівартості
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">індикативна / інвойсна</span>
            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-label={detailsOpen ? "Сховати деталі" : "Показати деталі"}
              className="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronDown className={cn("h-4 w-4 transition-transform", detailsOpen && "rotate-180")} />
            </button>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between rounded-md border border-border bg-background px-2 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
            Собівартість, $/кг
          </span>
          {costRes.ok && costRes.result ? (
            <CostPair
              indicative={costRes.result.indicativeCost}
              invoice={costRes.result.invoiceCost}
              suffix="/кг"
              size="md"
            />
          ) : (
            <span className="text-sm font-bold tabular-nums text-muted-foreground">—</span>
          )}
        </div>
        {!costRes.ok && (costRes.needsFx || costRes.needsCustoms || costRes.needsNetGross) && (
          <div className="mt-1 text-[10px] leading-snug text-amber-600 dark:text-amber-400">
            {costRes.needsNetGross && "Заповніть Нетто/Брутто. "}
            {costRes.needsFx && "Немає курсу EUR→USD. "}
            {costRes.needsCustoms && "Митну довідку не знайдено для цього товару/країни."}
          </div>
        )}
        {detailsOpen && (
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
            <div>FX EUR→USD</div>
            <div className="text-right">
              {needsFxLocal
                ? (fxQ.data?.rate ? fxQ.data.rate.toFixed(4) : "—")
                : "не потрібен"}
            </div>
            <div>Очікувані палети</div>
            <div className="text-right">
              {costRes.result ? `${costRes.result.expectedPallets} / 26` : "—"}
            </div>
            <div>Транспорт, $/кг</div>
            <div className="text-right">
              {costRes.result ? costRes.result.transportPerKg.toFixed(3) : "—"}
            </div>
            <div>Митниця індикативна, $/кг</div>
            <div className="text-right">
              {costRes.result ? costRes.result.indicativeDuty.toFixed(3) : "—"}
            </div>
            <div>Митниця інвойсна, $/кг</div>
            <div className="text-right">
              {costRes.result ? costRes.result.invoiceDuty.toFixed(3) : "—"}
            </div>
            <div>Ціна товару, $/кг</div>
            <div className="text-right">
              {costRes.result ? costRes.result.unitUsd.toFixed(3) : "—"}
            </div>
            <div className="col-span-2 mt-1 text-[10px] italic text-muted-foreground">
              Open / preliminary: транспорт розподілено на теоретичні палети
              (min(26, floor(21500 / брутто/пал))). Без збереження в БД.
            </div>
          </div>
        )}
        {hint && (
          <div className="mt-1 text-[10px] leading-snug">
            {hint.status === "pallet_no_match" && (
              <span className="text-amber-600 dark:text-amber-400">
                Стандарт палети не знайдено — введіть Упаковка/Нетто/Брутто вручну
              </span>
            )}
            {hint.status === "product_no_match" && (
              <span className="text-destructive">Товар не розпізнано</span>
            )}
            {hint.status === "product_ambiguous" && (
              <span className="text-destructive">Уточніть назву товару</span>
            )}
            {hint.status === "country_no_match" && (
              <span className="text-destructive">Країну не розпізнано</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
