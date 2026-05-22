import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ResolverStatus =
  | "matched"
  | "pallet_no_match"
  | "product_no_match"
  | "product_ambiguous"
  | "country_no_match";

interface ResolverResult {
  status: ResolverStatus;
  product_dictionary_id: string | null;
  canonical_product_id: string | null;
  product_name_ua: string | null;
  product_match_status: string | null;
  product_candidate_count: number;
  country_name: string | null;
  country_iso3: string | null;
  country_match_status: string | null;
  pallet_standard_id: string | null;
  package_used: string | null;
  pallet_net_kg: number | null;
  pallet_gross_kg: number | null;
  pallet_footprint_text: string | null;
  pallet_selected_by: string | null;
  pallet_candidate_count: number;
  needs_review: boolean;
  review_reason: string | null;
}

type FieldKey = "package" | "net" | "gross";

const NUMERIC_RAW_RE = /^[0-9]*[.,]?[0-9]*$/;
const INT_RAW_RE = /^[0-9]*$/;

function normalizeDecimal(raw: string): string {
  if (raw === "") return "";
  let v = raw.replace(",", ".");
  if (v.startsWith(".")) v = "0" + v;
  if (v.endsWith(".")) v = v.slice(0, -1);
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return v;
}

function normalizeInt(raw: string): string {
  if (raw === "") return "";
  const n = Math.trunc(Number(raw));
  if (!Number.isFinite(n) || n < 0) return "";
  return String(n);
}

function fmt(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return (Math.round(n * 100) / 100).toString();
}

interface RowState {
  productQuery: string;
  countryQuery: string;
  packageRaw: string;
  netRaw: string;
  grossRaw: string;
  palletsRaw: string;
  priceRaw: string;
}

const INITIAL: RowState = {
  productQuery: "",
  countryQuery: "",
  packageRaw: "",
  netRaw: "",
  grossRaw: "",
  palletsRaw: "",
  priceRaw: "",
};

export function DraftOfferLineRow({
  onConfirmToast,
}: {
  onConfirmToast: (msg: string) => void;
}) {
  const [s, setS] = useState<RowState>(INITIAL);
  const [manuallyEdited, setManuallyEdited] = useState<Record<FieldKey, boolean>>({
    package: false,
    net: false,
    gross: false,
  });
  const [autoFilled, setAutoFilled] = useState<Record<FieldKey, boolean>>({
    package: false,
    net: false,
    gross: false,
  });
  const lastResolvedKey = useRef<string | null>(null);
  const [resolver, setResolver] = useState<ResolverResult | null>(null);
  const [resolving, setResolving] = useState(false);

  const update = useCallback(<K extends keyof RowState>(k: K, v: RowState[K]) => {
    setS((p) => ({ ...p, [k]: v }));
  }, []);

  const markManual = (f: FieldKey) => {
    setManuallyEdited((p) => ({ ...p, [f]: true }));
    setAutoFilled((p) => ({ ...p, [f]: false }));
  };

  // Debounced resolver
  useEffect(() => {
    const product = s.productQuery.trim();
    const country = s.countryQuery.trim();
    if (!product || !country) {
      setResolver(null);
      return;
    }
    const t = setTimeout(async () => {
      setResolving(true);
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
        if (error) {
          console.warn("[draft resolver]", error.message);
          setResolver(null);
          return;
        }
        const rows = data as unknown as ResolverResult[] | null;
        const r = rows && rows.length > 0 ? rows[0] : null;
        if (!r) {
          setResolver(null);
          return;
        }
        const norm: ResolverResult = {
          ...r,
          pallet_net_kg: r.pallet_net_kg == null ? null : Number(r.pallet_net_kg),
          pallet_gross_kg: r.pallet_gross_kg == null ? null : Number(r.pallet_gross_kg),
        };
        setResolver(norm);

        if (norm.status === "matched") {
          const key = `${norm.canonical_product_id}::${norm.country_name}`;
          if (key !== lastResolvedKey.current) {
            lastResolvedKey.current = key;
            setS((prev) => {
              const next = { ...prev };
              if (!manuallyEdited.package && norm.package_used != null) {
                next.packageRaw = norm.package_used;
              }
              if (!manuallyEdited.net && norm.pallet_net_kg != null) {
                next.netRaw = String(norm.pallet_net_kg);
              }
              if (!manuallyEdited.gross && norm.pallet_gross_kg != null) {
                next.grossRaw = String(norm.pallet_gross_kg);
              }
              return next;
            });
            setAutoFilled({
              package: !manuallyEdited.package && norm.package_used != null,
              net: !manuallyEdited.net && norm.pallet_net_kg != null,
              gross: !manuallyEdited.gross && norm.pallet_gross_kg != null,
            });
          }
        }
        // pallet_no_match / product_*/ country_no_match → no writes, no clears
      } finally {
        setResolving(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [s.productQuery, s.countryQuery, manuallyEdited]);

  const hint = useMemo(() => {
    if (resolving) return { tone: "muted", text: "Розпізнаю…" };
    if (!resolver) return null;
    const p = resolver.product_name_ua;
    const c = resolver.country_name;
    const code = resolver.canonical_product_id;
    switch (resolver.status) {
      case "matched":
        return {
          tone: "ok",
          text: `Розпізнано: ${p} · ${c}${code ? ` · ${code}` : ""}`,
        };
      case "pallet_no_match":
        return {
          tone: "warn",
          text: `Розпізнано: ${p} · ${c}. Палетний стандарт не знайдено — введіть вручну`,
        };
      case "product_ambiguous":
        return {
          tone: "warn",
          text: `Кілька варіантів товару (${resolver.product_candidate_count}) — уточніть запит`,
        };
      case "product_no_match":
        return { tone: "err", text: "Товар не розпізнано" };
      case "country_no_match":
        return { tone: "err", text: "Країна не розпізнана" };
    }
  }, [resolver, resolving]);

  const netNum = s.netRaw === "" ? NaN : Number(s.netRaw.replace(",", "."));
  const grossNum = s.grossRaw === "" ? NaN : Number(s.grossRaw.replace(",", "."));
  const palletsNum = s.palletsRaw === "" ? NaN : Number(s.palletsRaw);
  const priceNum = s.priceRaw === "" ? NaN : Number(s.priceRaw.replace(",", "."));

  const totalNet = Number.isFinite(netNum) && Number.isFinite(palletsNum) ? netNum * palletsNum : null;
  const totalGross =
    Number.isFinite(grossNum) && Number.isFinite(palletsNum) ? grossNum * palletsNum : null;

  const handleConfirm = () => {
    if (!resolver) {
      onConfirmToast("Введіть товар і країну");
      return;
    }
    if (
      resolver.status === "product_no_match" ||
      resolver.status === "product_ambiguous" ||
      resolver.status === "country_no_match"
    ) {
      const why =
        resolver.status === "product_no_match"
          ? "товар не розпізнано"
          : resolver.status === "country_no_match"
            ? "країна не розпізнана"
            : "товар не однозначний";
      onConfirmToast(`Не підтверджено: ${why}`);
      return;
    }
    // matched | pallet_no_match → validate numbers
    const productOk =
      resolver.canonical_product_id != null && resolver.product_match_status === "matched";
    const countryOk =
      resolver.country_match_status === "matched" && resolver.country_name != null;
    if (!productOk || !countryOk) {
      onConfirmToast("Не підтверджено: товар/країна не розпізнані");
      return;
    }
    if (
      !Number.isFinite(netNum) ||
      netNum <= 0 ||
      !Number.isFinite(grossNum) ||
      grossNum <= 0 ||
      !Number.isFinite(palletsNum) ||
      palletsNum <= 0 ||
      !Number.isFinite(priceNum) ||
      priceNum <= 0
    ) {
      onConfirmToast("Заповніть net / gross / кількість палет / ціну");
      return;
    }
    onConfirmToast("Draft валідний — запис у БД вимкнено в тестовій версії");
  };

  const clearRow = () => {
    setS(INITIAL);
    setManuallyEdited({ package: false, net: false, gross: false });
    setAutoFilled({ package: false, net: false, gross: false });
    lastResolvedKey.current = null;
    setResolver(null);
  };

  const hintColor =
    hint?.tone === "ok"
      ? "text-emerald-600"
      : hint?.tone === "warn"
        ? "text-amber-600"
        : hint?.tone === "err"
          ? "text-destructive"
          : "text-muted-foreground";

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-2 py-2 text-left font-medium w-[180px]">Товар</th>
              <th className="px-2 py-2 text-left font-medium w-[140px]">Країна</th>
              <th className="px-2 py-2 text-left font-medium w-[160px]">Упаковка</th>
              <th className="px-2 py-2 text-right font-medium w-[90px]">Net, кг</th>
              <th className="px-2 py-2 text-right font-medium w-[90px]">Gross, кг</th>
              <th className="px-2 py-2 text-right font-medium w-[80px]">Палет</th>
              <th className="px-2 py-2 text-right font-medium w-[90px]">Ціна</th>
              <th className="px-2 py-2 text-right font-medium w-[100px]">Σ Net</th>
              <th className="px-2 py-2 text-right font-medium w-[100px]">Σ Gross</th>
              <th className="px-2 py-2 w-[80px]"></th>
            </tr>
          </thead>
          <tbody>
            <tr className="align-top">
              <td className="px-2 py-2">
                <Input
                  value={s.productQuery}
                  onChange={(e) => update("productQuery", e.target.value)}
                  placeholder="кавун / watermelon"
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  value={s.countryQuery}
                  onChange={(e) => update("countryQuery", e.target.value)}
                  placeholder="Spain / Іспанія"
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  value={s.packageRaw}
                  onChange={(e) => {
                    update("packageRaw", e.target.value);
                    markManual("package");
                  }}
                  className={cn(autoFilled.package && "bg-emerald-50/40")}
                  placeholder="картон 5 кг"
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  inputMode="decimal"
                  value={s.netRaw}
                  onChange={(e) => {
                    if (!NUMERIC_RAW_RE.test(e.target.value)) return;
                    update("netRaw", e.target.value);
                    markManual("net");
                  }}
                  onBlur={() => update("netRaw", normalizeDecimal(s.netRaw))}
                  className={cn("text-right", autoFilled.net && "bg-emerald-50/40")}
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  inputMode="decimal"
                  value={s.grossRaw}
                  onChange={(e) => {
                    if (!NUMERIC_RAW_RE.test(e.target.value)) return;
                    update("grossRaw", e.target.value);
                    markManual("gross");
                  }}
                  onBlur={() => update("grossRaw", normalizeDecimal(s.grossRaw))}
                  className={cn("text-right", autoFilled.gross && "bg-emerald-50/40")}
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  inputMode="numeric"
                  value={s.palletsRaw}
                  onChange={(e) => {
                    if (!INT_RAW_RE.test(e.target.value)) return;
                    update("palletsRaw", e.target.value);
                  }}
                  onBlur={() => update("palletsRaw", normalizeInt(s.palletsRaw))}
                  className="text-right"
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  inputMode="decimal"
                  value={s.priceRaw}
                  onChange={(e) => {
                    if (!NUMERIC_RAW_RE.test(e.target.value)) return;
                    update("priceRaw", e.target.value);
                  }}
                  onBlur={() => update("priceRaw", normalizeDecimal(s.priceRaw))}
                  className="text-right"
                />
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                {fmt(totalNet)}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                {fmt(totalGross)}
              </td>
              <td className="px-2 py-2">
                <Button variant="ghost" size="sm" onClick={clearRow}>
                  Очистити
                </Button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {hint && (
        <div className={cn("text-xs", hintColor)}>
          {hint.text}
          {resolver?.review_reason ? (
            <span className="ml-2 text-muted-foreground">({resolver.review_reason})</span>
          ) : null}
        </div>
      )}

      <div className="flex gap-2">
        <Button onClick={handleConfirm}>Підтвердити (draft)</Button>
      </div>
    </div>
  );
}
