// Phase 1 — mobile card form extracted from
// src/routes/_authenticated/shipments/$id.products.tsx (ProductRowEditor).
//
// Hard rule: the card is a true controlled form. It reads from `draft` and
// writes back via `onPatch` / `onRemove` — the same DraftRow that the parent
// commits through buildPayload/commitNewShipmentItem. No parallel visual
// state, no overlay layer. Resolver, package autofill, Net/Gross auto-fill,
// hint banner, customs chip, cost pair, override panel and breakdown
// chevron are all preserved verbatim from the table-row implementation —
// only the wrapping <tr>/<td> chrome was replaced with a card layout.
import { useCallback, useContext, useEffect, useRef, useState, type FocusEvent } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { supabase } from "@/integrations/supabase/client";
import { AutocompleteCell } from "@/components/AutocompleteCell";
import { CostPair } from "@/components/CostPair";
import { CustomsManualOverrideField } from "@/components/CustomsManualOverrideField";
import { CustomsStatusChip } from "@/components/CustomsStatusChip";
import { useCountryAliases } from "@/hooks/useCountryAliases";
import { useCountryOptions } from "@/hooks/useCountryOptions";
import { useProductAliases } from "@/hooks/useProductAliases";
import { useAuth } from "@/lib/auth";
import { toUaCountry } from "@/lib/countries";
import { translateError } from "@/lib/mutation-helpers";
import { resolvePalletForText } from "@/lib/pallet-resolver";
import {
  isEuCountry,
  isKnownProductName,
  type DraftRow,
  type ProductRef,
  type RowComponents,
} from "@/lib/shipment-row-engine";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { CellInput, NumCell, PackageCell, PriceCell, VarietyCell } from "@/components/shipments/cells";

// Truck capacity limits (must mirror $id.products.tsx).
const MAX_PALLETS = 26;
const MAX_WEIGHT_KG = 21500;

export type ShipmentCardDbItem = {
  id: string;
  product_name: string | null;
  pallet_count: number | null;
  final_cost_indicative: number | null;
  final_cost_invoice: number | null;
  customs_match_id: string | null;
  customs_override_duty_usd: number | null;
  customs_override_confirmed_at: string | null;
};

export type ShipmentCardPreview = {
  isDirty: boolean;
  value: { indicative: number | null; invoice: number | null } | null;
  hasCustomsInputs: boolean;
  liveCustomsStatus: "green" | "yellow" | "red" | "manual" | null;
  components: RowComponents;
};

export type ResolverHintStatus =
  | "matched"
  | "pallet_no_match"
  | "product_no_match"
  | "product_ambiguous"
  | "country_no_match";

export type ResolverHintInfo = {
  status: ResolverHintStatus;
  productKey: string;
  countryKey: string;
  packageKey: string;
};

function resolverKeyOf(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function isValidShipmentItem(item: { product_name: string | null; pallet_count: number | null }) {
  return !!item.product_name?.trim() && Number(item.pallet_count ?? 0) > 0;
}

// D1-Fix v2.5.3 — yellow fallback chip with explanation-only popover.
function YellowFallbackChip({ components }: { components: RowComponents }) {
  const usedProduct = components.matchedRef?.product_name || "—";
  const usedCountryRaw = components.matchedRef?.country || "";
  const usedCountry = (usedCountryRaw && toUaCountry(usedCountryRaw)) || usedCountryRaw || "—";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-pointer"
          title="Показати пояснення митниці для цієї позиції"
        >
          <CustomsStatusChip status="yellow" compact />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="end"
        className="w-72 border-amber-400/40 bg-amber-50 p-3 text-[11px] leading-snug text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
      >
        <div className="font-semibold">Точну країну не знайдено</div>
        <div className="mt-1">Розрахунок виконано за товаром.</div>
        <div className="mt-2">
          Використаний рядок: <b>{usedProduct}</b> · <b>{usedCountry}</b>
        </div>
        {components.customsIndicative != null && (
          <div className="mt-2">
            Митниця індикатив: <b>${components.customsIndicative.toFixed(4)}/кг</b>
          </div>
        )}
        {components.customsInvoice != null && (
          <div>
            Митниця інвойс: <b>${components.customsInvoice.toFixed(4)}/кг</b>
          </div>
        )}
        {isEuCountry(components.country) && (
          <div className="mt-1 text-[10px] text-muted-foreground">EUR1 застосовано</div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ItemCustomsConfirmedPill({
  duty,
  onReopen,
  disabled,
}: {
  duty: number;
  onReopen: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onReopen}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-full border border-success/40 bg-success/10 px-2.5 py-0.5 text-[11px] font-semibold text-success transition-colors hover:bg-success/20 disabled:cursor-not-allowed disabled:opacity-60"
      title="Натисніть, щоб переглянути або змінити"
    >
      Митниця підтверджена: ${duty.toFixed(4)}/кг
    </button>
  );
}

function ItemCustomsOverride({
  item,
  shipmentId,
  readOnly,
  onCollapse,
}: {
  item: ShipmentCardDbItem;
  shipmentId: string;
  readOnly: boolean;
  onCollapse?: () => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [pending, setPending] = useState(false);
  const confirmedDuty =
    item.customs_override_confirmed_at && item.customs_override_duty_usd != null
      ? Number(item.customs_override_duty_usd)
      : null;
  if (item.customs_match_id) return null;
  if (!isValidShipmentItem(item)) return null;
  const onConfirm = async (duty: number) => {
    setPending(true);
    try {
      const { error } = await supabase.rpc("confirm_shipment_item_customs_override", {
        p_item_id: item.id,
        p_duty: duty,
      });
      if (error) throw error;
      toast.success("Митний збір підтверджено");
      onCollapse?.();
      qc.invalidateQueries({ queryKey: ["shipment-products", user?.id, shipmentId] });
      qc.invalidateQueries({ queryKey: ["shipment", shipmentId] });
      qc.invalidateQueries({ queryKey: ["shipments-list"] });
      qc.invalidateQueries({ queryKey: ["dash-manager"] });
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="mt-2">
      <CustomsManualOverrideField
        confirmedDuty={confirmedDuty}
        onConfirm={onConfirm}
        pending={pending}
        disabled={readOnly}
      />
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

export function ShipmentProductCard({
  draft,
  dbItem,
  shipmentId,
  products,
  otherPallets,
  otherKg,
  preview,
  readOnly,
  productOriginLocked = false,
  pulse = false,
  collapseExpandedTick,
  index,
  onShowBreakdown,
  onPatch,
  onRemove,
  onResolverHint,
}: {
  draft: DraftRow;
  dbItem: ShipmentCardDbItem | null;
  shipmentId: string;
  products: ProductRef[];
  otherPallets: number;
  otherKg: number;
  preview: ShipmentCardPreview;
  readOnly: boolean;
  // Phase 1 final — identity-lock for Товар/Походження only. Independent
  // from `readOnly` (which gates the whole card). Computed by the parent
  // from saved position_id and offer-derived source_position_id.
  productOriginLocked?: boolean;
  pulse?: boolean;
  collapseExpandedTick: number;
  index: number;
  onShowBreakdown: () => void;
  onPatch: (patch: Partial<DraftRow>) => void;
  onRemove: () => void;
  onResolverHint: (info: ResolverHintInfo | null) => void;
}) {
  const dbCountries = useCountryOptions();
  const countryAliases = useCountryAliases();
  const productAliases = useProductAliases();
  const COUNTRY_OPTIONS = dbCountries;
  const knownProductNames = products.map((product) => product.name);

  // D1: draft is the source of truth — no internal form state, no autosave.
  const form = draft;
  const formRef = useRef(form);
  formRef.current = form;
  const touchedRef = useRef({ product: false, country: false });
  const set = <K extends keyof DraftRow>(k: K, v: DraftRow[K]) => {
    if (readOnly) return;
    onPatch({ [k]: v } as Partial<DraftRow>);
  };
  // Combined gate for the identity fields only (Товар + Походження).
  const productOriginReadOnly = readOnly || productOriginLocked;

  // Field-level validation
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

  type ResolverHint =
    | { status: "pallet_no_match" | "product_no_match" | "product_ambiguous" | "country_no_match" }
    | null;
  const [hint, setHint] = useState<ResolverHint>(null);
  const [resolverBusy, setResolverBusy] = useState(false);
  const resolverSeqRef = useRef(0);

  const runResolver = useCallback(async () => {
    if (readOnly) return;
    if (!touchedRef.current.product && !touchedRef.current.country) return;
    const latest = formRef.current;
    const product = latest.product_name.trim();
    const country = latest.origin_country.trim();
    if (!product || !country) return;
    const productKey = resolverKeyOf(product);
    const countryKey = resolverKeyOf(country);
    const packageKey = resolverKeyOf(latest.package_used);
    const reportHint = (status: ResolverHintStatus | null) => {
      if (status == null) {
        setHint(null);
        onResolverHint(null);
        return;
      }
      onResolverHint({ status, productKey, countryKey, packageKey });
      if (
        status === "pallet_no_match" ||
        status === "product_no_match" ||
        status === "product_ambiguous" ||
        status === "country_no_match"
      ) {
        setHint({ status });
      } else {
        setHint(null);
      }
    };
    const seq = ++resolverSeqRef.current;
    setResolverBusy(true);
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
      if (error) { reportHint(null); return; }
      const row = Array.isArray(data) ? (data as unknown[])[0] : data;
      if (!row || typeof row !== "object") { reportHint(null); return; }
      const r = row as Record<string, unknown>;
      const status = r.status;
      if (
        status === "product_no_match" ||
        status === "product_ambiguous" ||
        status === "country_no_match"
      ) {
        reportHint(status);
        return;
      }
      const pal = await resolvePalletForText(product, country);
      if (seq !== resolverSeqRef.current) return;
      const cur = formRef.current;
      if (pal.matchType !== "no_match" && pal.selected) {
        const pNet = pal.selected.pallet_net_kg;
        const pGross = pal.selected.pallet_gross_kg;
        const pkg = pal.selected.package_used;
        reportHint("matched");
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
        reportHint("pallet_no_match");
        onPatch({
          package_used: "",
          resolver_net_per_pallet_kg: null,
          resolver_gross_per_pallet_kg: null,
          net_auto: false,
          gross_auto: false,
        });
      }
    } catch {
      if (seq === resolverSeqRef.current) reportHint(null);
    } finally {
      if (seq === resolverSeqRef.current) setResolverBusy(false);
    }
  }, [readOnly, onPatch, onResolverHint]);

  const handleResolverBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    void runResolver();
  };

  const remove = () => {
    if (readOnly) {
      toast.error("Можна редагувати лише власні товари");
      return;
    }
    onRemove();
  };

  const confirmedOverrideDuty =
    dbItem && dbItem.customs_override_confirmed_at && dbItem.customs_override_duty_usd != null
      ? Number(dbItem.customs_override_duty_usd)
      : null;
  const overrideEligible =
    !!dbItem && !dbItem.customs_match_id && isValidShipmentItem(dbItem);
  const [overrideOpen, setOverrideOpen] = useState<boolean>(
    overrideEligible && confirmedOverrideDuty == null,
  );
  useEffect(() => {
    if (confirmedOverrideDuty != null) setOverrideOpen(false);
  }, [confirmedOverrideDuty]);
  const firstCollapseTickRef = useRef(collapseExpandedTick);
  useEffect(() => {
    if (collapseExpandedTick === firstCollapseTickRef.current) return;
    firstCollapseTickRef.current = collapseExpandedTick;
    setOverrideOpen(false);
  }, [collapseExpandedTick]);

  return (
    <div
      className={cn(
        "shipment-product-card rounded-xl border border-border bg-card p-3 shadow-sm",
        pulse && (invalidProduct || unknownProduct || invalidCountry || invalidPallets || invalidNet || invalidGross || invalidPrice) && "ring-1 ring-destructive/40",
      )}
    >
      {/* Header: row index + delete */}
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Позиція {index + 1}
        </div>
        <button
          type="button"
          onClick={remove}
          disabled={readOnly}
          aria-label="Видалити рядок"
          className="inline-flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive active:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      {/* Product (resolver) */}
      <div
        data-required="true"
        onBlur={handleResolverBlur}
        className={cn("relative mb-2", pulse && (invalidProduct || unknownProduct) && "field-invalid")}
      >
        <FieldLabel>Товар *</FieldLabel>
        <AutocompleteCell
          value={form.product_name}
          onChange={(v) => {
            if (productOriginReadOnly) return;
            touchedRef.current.product = true;
            setHint(null);
            onResolverHint(null);
            onPatch({ product_name: v });
          }}
          onCommit={() => { void runResolver(); }}
          options={knownProductNames}
          aliases={productAliases}
          placeholder="Товар"
          className={cn(
            "font-medium",
            (invalidProduct || unknownProduct) && "border-destructive/70 ring-1 ring-destructive/40 placeholder:text-destructive/80",
          )}
          expandedMinWidth={260}
          required
          readOnly={productOriginReadOnly}
        />
        {unknownProduct && (
          <div className="px-1 pt-0.5 text-[10px] font-medium text-destructive">
            Оберіть товар лише зі списку
          </div>
        )}
        {productOriginLocked && (
          <div className="px-1 pt-0.5 text-[10px] text-muted-foreground">
            Товар зафіксовано position_id — змінити не можна
          </div>
        )}
      </div>

      {/* Country (resolver) */}
      <div
        data-required="true"
        onBlur={handleResolverBlur}
        className={cn("relative mb-2", pulse && invalidCountry && "field-invalid")}
      >
        <FieldLabel>Походження *</FieldLabel>
        <AutocompleteCell
          value={form.origin_country}
          onChange={(v) => {
            if (productOriginReadOnly) return;
            touchedRef.current.country = true;
            setHint(null);
            onResolverHint(null);
            onPatch({ origin_country: v });
          }}
          onCommit={() => { void runResolver(); }}
          options={COUNTRY_OPTIONS}
          aliases={countryAliases}
          placeholder="Походження"
          className={cn(invalidCountry && "border-destructive/70 ring-1 ring-destructive/40 placeholder:text-destructive/80")}
          expandedMinWidth={240}
          readOnly={productOriginReadOnly}
        />
      </div>

      {/* Variety / Caliber */}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <FieldLabel>Сорт</FieldLabel>
          <VarietyCell
            value={form.variety}
            onChange={(v) => set("variety", v)}
            productName={form.product_name}
            readOnly={readOnly}
          />
        </div>
        <div>
          <FieldLabel>Калібр</FieldLabel>
          <CellInput
            value={form.caliber}
            placeholder="Калібр"
            onChange={(v) => set("caliber", v)}
            expandedMinWidth={160}
            readOnly={readOnly}
          />
        </div>
      </div>

      {/* Brand / Class — Phase 1 final, controlled inputs writing into DraftRow */}
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <FieldLabel>Бренд</FieldLabel>
          <CellInput
            value={form.brand ?? ""}
            placeholder="Бренд"
            onChange={(v) => set("brand", v)}
            expandedMinWidth={200}
            readOnly={readOnly}
          />
        </div>
        <div>
          <FieldLabel>Клас</FieldLabel>
          <CellInput
            value={form.class ?? ""}
            placeholder="Клас"
            onChange={(v) => set("class", v)}
            expandedMinWidth={160}
            readOnly={readOnly}
          />
        </div>
      </div>


      {/* Package */}
      <div className="mb-2">
        <FieldLabel>Упаковка *</FieldLabel>
        <PackageCell
          value={form.package_used}
          productName={form.product_name}
          countryName={form.origin_country}
          readOnly={readOnly}
          onChangeText={(text) => {
            onPatch({ package_used: text });
          }}
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

      {/* Pallets / Net / Gross */}
      <div className="mb-2 grid grid-cols-3 gap-2">
        <div>
          <FieldLabel>Палети *</FieldLabel>
          <NumCell
            value={form.pallet_count}
            readOnly={readOnly}
            invalid={invalidPallets}
            placeholder="Палети"
            onChange={(v) => {
              if (readOnly) return;
              const patch: Partial<DraftRow> = { pallet_count: v };
              if (form.net_auto && form.resolver_net_per_pallet_kg != null) {
                patch.net_weight_kg = form.resolver_net_per_pallet_kg * v;
              }
              if (form.gross_auto && form.resolver_gross_per_pallet_kg != null) {
                patch.gross_weight_kg = form.resolver_gross_per_pallet_kg * v;
              }
              const simGross = patch.gross_weight_kg != null ? Number(patch.gross_weight_kg) : grossNum;
              const simNet = patch.net_weight_kg != null ? Number(patch.net_weight_kg) : netNum;
              const newRowKg = simGross > 0 ? simGross : simNet;
              const newTotalPallets = otherPallets + v;
              const newTotalKg = otherKg + newRowKg;
              if (newTotalPallets > MAX_PALLETS || newTotalKg > MAX_WEIGHT_KG) {
                toast.error(`Перевищено ліміт: макс ${MAX_PALLETS} палет / ${MAX_WEIGHT_KG} кг на машину`);
              }
              onPatch(patch);
            }}
          />
        </div>
        <div>
          <FieldLabel>Нетто, кг *</FieldLabel>
          <NumCell
            value={Math.round(netNum)}
            readOnly={readOnly}
            step="1"
            invalid={invalidNet || netGtGross}
            placeholder="Нетто"
            onChange={(v) => {
              if (readOnly) return;
              const safe = Math.max(0, v);
              onPatch({ net_weight_kg: safe, net_auto: false });
            }}
          />
          {netGtGross && (
            <div className="mt-0.5 text-[10px] leading-tight text-destructive">
              Нетто не може бути більше брутто
            </div>
          )}
        </div>
        <div>
          <FieldLabel>Брутто, кг *</FieldLabel>
          <NumCell
            value={Math.round(grossNum)}
            readOnly={readOnly}
            step="1"
            invalid={invalidGross || netGtGross}
            placeholder="Брутто"
            onChange={(v) => {
              if (readOnly) return;
              const safe = Math.max(0, v);
              onPatch({ gross_weight_kg: safe, gross_auto: false });
            }}
          />
        </div>
      </div>

      {/* Price */}
      <div className="mb-2">
        <FieldLabel>Ціна за кг *</FieldLabel>
        <div className={cn(pulse && invalidPrice && "field-invalid")}>
          <PriceCell
            value={form.unit_price}
            currency={form.price_currency}
            readOnly={readOnly}
            onValueChange={(v) => set("unit_price", v)}
            onCurrencyChange={(c) => set("price_currency", c)}
          />
        </div>
      </div>

      {/* Cost summary / customs */}
      <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Собівартість $/кг
          </span>
          <div className="flex items-center gap-2">
            {(() => {
              if (
                hint &&
                (hint.status === "product_no_match" ||
                  hint.status === "product_ambiguous" ||
                  hint.status === "country_no_match")
              ) {
                return null;
              }
              if (!preview.hasCustomsInputs) return null;
              const basis = preview.components.customsBasis;
              if (basis === "manual") return null;
              const status: "green" | "yellow" | "red" =
                basis === "exact" ? "green" : basis === "fallback" ? "yellow" : "red";
              if (status === "yellow") {
                return <YellowFallbackChip components={preview.components} />;
              }
              return <CustomsStatusChip status={status} compact />;
            })()}
            {(() => {
              if (
                hint &&
                (hint.status === "product_no_match" ||
                  hint.status === "product_ambiguous" ||
                  hint.status === "country_no_match")
              ) {
                return <span className="whitespace-nowrap text-xs font-bold text-muted-foreground">—</span>;
              }
              const useDbCost = !!dbItem && !preview.isDirty;
              if (useDbCost) {
                return <CostPair indicative={dbItem!.final_cost_indicative} invoice={dbItem!.final_cost_invoice} size="sm" />;
              }
              const v = preview.value;
              if (v == null) {
                return <span className="whitespace-nowrap text-xs font-bold text-muted-foreground">—</span>;
              }
              return <CostPair indicative={v.indicative} invoice={v.invoice} size="sm" />;
            })()}
            {overrideEligible && confirmedOverrideDuty != null && !overrideOpen && (
              <ItemCustomsConfirmedPill
                duty={confirmedOverrideDuty}
                onReopen={() => setOverrideOpen(true)}
                disabled={readOnly}
              />
            )}
            <button
              type="button"
              onClick={onShowBreakdown}
              aria-label="Показати розрахунок угорі"
              className="inline-flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>
        </div>
        {overrideEligible && overrideOpen && (
          <ItemCustomsOverride
            item={dbItem!}
            shipmentId={shipmentId}
            readOnly={readOnly}
            onCollapse={() => setOverrideOpen(false)}
          />
        )}
        {hint && !resolverBusy && (
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
