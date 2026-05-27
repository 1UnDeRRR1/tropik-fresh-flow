import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { resolvePalletForText } from "@/lib/pallet-resolver";
import { blurOnEnter, MOBILE_ENTER_KEY_HINT, scrollFocusedIntoView } from "@/lib/mobile-input";

type ResolverStatus =
  | "matched"
  | "pallet_no_match"
  | "product_no_match"
  | "product_ambiguous"
  | "country_no_match";

interface ResolverResult {
  status: ResolverStatus;
  product_name_ua: string | null;
  product_candidate_count: number;
  country_name: string | null;
  package_used: string | null;
  pallet_net_kg: number | null;
  pallet_gross_kg: number | null;
  pallet_selected_by: string | null;
}

const NUMERIC_RE = /^[0-9]*[.,]?[0-9]*$/;
const INT_RE = /^[0-9]*$/;

function asNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function asText(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function toResolverResult(payload: unknown): ResolverResult | null {
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const status = r.status;
  if (
    status !== "matched" &&
    status !== "pallet_no_match" &&
    status !== "product_no_match" &&
    status !== "product_ambiguous" &&
    status !== "country_no_match"
  )
    return null;
  return {
    status,
    product_name_ua: asText(r.product_name_ua),
    product_candidate_count: asNumber(r.product_candidate_count) ?? 0,
    country_name: asText(r.country_name),
    package_used: asText(r.package_used),
    pallet_net_kg: asNumber(r.pallet_net_kg),
    pallet_gross_kg: asNumber(r.pallet_gross_kg),
    pallet_selected_by: asText(r.pallet_selected_by),
  };
}

function fmtKg(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "";
  return String(Math.round(n * 100) / 100);
}

export function DraftOfferLineRow({
  onConfirmToast,
}: {
  onConfirmToast: (msg: string) => void;
}) {
  // Visible field state
  const [productQuery, setProductQuery] = useState("");
  const [countryQuery, setCountryQuery] = useState("");
  const [packageRaw, setPackageRaw] = useState("");
  const [palletsRaw, setPalletsRaw] = useState("1");
  const [netRaw, setNetRaw] = useState("");
  const [grossRaw, setGrossRaw] = useState("");
  const [priceRaw, setPriceRaw] = useState("");

  // Internal base values from resolver (not shown in UI)
  const [baseNet, setBaseNet] = useState<number | null>(null);
  const [baseGross, setBaseGross] = useState<number | null>(null);

  // Hidden manual-override flags (no UI). Reset on clearRow only.
  const pkgManualRef = useRef(false);
  const netManualRef = useRef(false);
  const grossManualRef = useRef(false);

  const [resolver, setResolver] = useState<ResolverResult | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const seqRef = useRef(0);

  // Resolver call
  useEffect(() => {
    const product = productQuery.trim();
    const country = countryQuery.trim();

    // Clear stale resolver state immediately on product/country change
    seqRef.current += 1;
    setResolver(null);
    setRpcError(null);

    if (!product || !country) {
      setResolving(false);
      return;
    }

    setResolving(true);
    const seq = seqRef.current;


    const timer = setTimeout(async () => {
      setRpcError(null);

      try {
        // Unified pallet resolver — same source as the packaging dropdown.
        const pal = await resolvePalletForText(product, country);
        if (seq !== seqRef.current) return;

        // Derive a status compatible with the existing hint UI.
        // Product/country recognition: if dict_id missing → product_no_match.
        // Pallet: matchType exact/compound_group/all_fallback → matched.
        //         no_match (with dict resolved) → pallet_no_match.
        let r: ResolverResult;
        if (!pal.dictionaryId) {
          r = {
            status: "product_no_match",
            product_name_ua: null,
            product_candidate_count: 0,
            country_name: null,
            package_used: null,
            pallet_net_kg: null,
            pallet_gross_kg: null,
            pallet_selected_by: null,
          };
        } else if (pal.matchType === "no_match" || !pal.selected) {
          r = {
            status: "pallet_no_match",
            product_name_ua: pal.productNameUa,
            product_candidate_count: 1,
            country_name: country || null,
            package_used: null,
            pallet_net_kg: null,
            pallet_gross_kg: null,
            pallet_selected_by: null,
          };
        } else {
          r = {
            status: "matched",
            product_name_ua: pal.productNameUa,
            product_candidate_count: 1,
            country_name: country || null,
            package_used: pal.selected.package_used,
            pallet_net_kg: pal.selected.pallet_net_kg,
            pallet_gross_kg: pal.selected.pallet_gross_kg,
            pallet_selected_by: pal.isFallback
              ? (pal.fallbackExplanation ?? pal.matchType)
              : pal.matchType,
          };
        }
        setResolver(r);

        if (r.status === "matched") {
          setBaseNet(r.pallet_net_kg);
          setBaseGross(r.pallet_gross_kg);

          // Package: fill from resolver only if user hasn't manually edited it
          if (!pkgManualRef.current && r.package_used) {
            setPackageRaw(r.package_used);
          }

          // Pallets: default to 1 ONLY if currently empty. Never overwrite existing qty.
          const currentQty =
            palletsRaw.trim() === "" ? 0 : Number(palletsRaw);
          const qty =
            Number.isFinite(currentQty) && currentQty > 0 ? currentQty : 1;
          if (palletsRaw.trim() === "") setPalletsRaw("1");

          // Net/Gross: recompute from base × qty unless user manually overrode them
          if (!netManualRef.current && r.pallet_net_kg != null) {
            setNetRaw(fmtKg(r.pallet_net_kg * qty));
          }
          if (!grossManualRef.current && r.pallet_gross_kg != null) {
            setGrossRaw(fmtKg(r.pallet_gross_kg * qty));
          }
        } else if (r.status === "pallet_no_match") {
          // Product recognized, no pallet standard → manual entry for net/gross
          setBaseNet(null);
          setBaseGross(null);
          if (!pkgManualRef.current) setPackageRaw("");
          if (!netManualRef.current) setNetRaw("");
          if (!grossManualRef.current) setGrossRaw("");
          if (palletsRaw.trim() === "") setPalletsRaw("1");
        } else {
          // Hard fails: clear auto-derived fields that weren't manually edited
          setBaseNet(null);
          setBaseGross(null);
          if (!pkgManualRef.current) setPackageRaw("");
          if (!netManualRef.current) setNetRaw("");
          if (!grossManualRef.current) setGrossRaw("");
        }
      } catch (e) {
        if (seq !== seqRef.current) return;
        setResolver(null);
        setRpcError(e instanceof Error ? e.message : "RPC error");
      } finally {
        if (seq === seqRef.current) setResolving(false);
      }
    }, 350);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productQuery, countryQuery]);

  // Pallets change → recompute net/gross unless manually overridden
  const onPalletsChange = (raw: string) => {
    if (!INT_RE.test(raw)) return;
    setPalletsRaw(raw);
    const qty = raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(qty)) return;
    if (!netManualRef.current && baseNet != null) {
      setNetRaw(fmtKg(baseNet * qty));
    }
    if (!grossManualRef.current && baseGross != null) {
      setGrossRaw(fmtKg(baseGross * qty));
    }
  };

  const onPackageChange = (raw: string) => {
    pkgManualRef.current = true;
    setPackageRaw(raw);
  };
  const onNetChange = (raw: string) => {
    if (!NUMERIC_RE.test(raw)) return;
    netManualRef.current = true;
    setNetRaw(raw);
  };
  const onGrossChange = (raw: string) => {
    if (!NUMERIC_RE.test(raw)) return;
    grossManualRef.current = true;
    setGrossRaw(raw);
  };
  const onPriceChange = (raw: string) => {
    if (!NUMERIC_RE.test(raw)) return;
    setPriceRaw(raw);
  };

  const netNum = netRaw === "" ? NaN : Number(netRaw.replace(",", "."));
  const grossNum = grossRaw === "" ? NaN : Number(grossRaw.replace(",", "."));
  const palletsNum = palletsRaw === "" ? NaN : Number(palletsRaw);
  const priceNum = priceRaw === "" ? NaN : Number(priceRaw.replace(",", "."));

  const hint = useMemo(() => {
    if (resolving)
      return { variant: "outline" as const, text: "Resolver…" };
    if (rpcError)
      return { variant: "destructive" as const, text: `RPC error: ${rpcError}` };
    if (!resolver) return null;
    switch (resolver.status) {
      case "matched":
        return {
          variant: "default" as const,
          text: `matched · ${resolver.product_name_ua ?? "—"} · ${resolver.country_name ?? "—"}${resolver.pallet_selected_by ? ` · ${resolver.pallet_selected_by}` : ""}`,
        };
      case "pallet_no_match":
        if (resolving) return null;
        return {
          variant: "secondary" as const,
          text: `pallet_no_match · ${resolver.product_name_ua ?? "—"} · ${resolver.country_name ?? "—"} — введіть вагу вручну`,
        };

      case "product_ambiguous":
        return {
          variant: "secondary" as const,
          text: `product_ambiguous · кандидатів: ${resolver.product_candidate_count}`,
        };
      case "product_no_match":
        return { variant: "destructive" as const, text: "product_no_match" };
      case "country_no_match":
        return { variant: "destructive" as const, text: "country_no_match" };
    }
  }, [resolver, resolving, rpcError]);

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
      onConfirmToast("Не підтверджено: товар/країна не розпізнані");
      return;
    }
    if (
      !Number.isFinite(netNum) || netNum <= 0 ||
      !Number.isFinite(grossNum) || grossNum <= 0 ||
      !Number.isFinite(palletsNum) || palletsNum <= 0 ||
      !Number.isFinite(priceNum) || priceNum <= 0
    ) {
      onConfirmToast("Заповніть Нетто / Брутто / К-ть палет / Ціну");
      return;
    }
    onConfirmToast("Draft валідний — запис у БД вимкнено в тестовій версії");
  };

  const clearRow = () => {
    seqRef.current += 1;
    setProductQuery("");
    setCountryQuery("");
    setPackageRaw("");
    setPalletsRaw("1");
    setNetRaw("");
    setGrossRaw("");
    setPriceRaw("");
    setBaseNet(null);
    setBaseGross(null);
    pkgManualRef.current = false;
    netManualRef.current = false;
    grossManualRef.current = false;
    setResolver(null);
    setRpcError(null);
    setResolving(false);
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border bg-background">
        <table className="min-w-[1000px] w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-[180px] px-2 py-2 text-left font-medium">Товар</th>
              <th className="w-[150px] px-2 py-2 text-left font-medium">Країна</th>
              <th className="w-[170px] px-2 py-2 text-left font-medium">Упаковка</th>
              <th className="w-[90px] px-2 py-2 text-right font-medium">К-ть палет</th>
              <th className="w-[110px] px-2 py-2 text-right font-medium">Нетто, кг</th>
              <th className="w-[110px] px-2 py-2 text-right font-medium">Брутто, кг</th>
              <th className="w-[110px] px-2 py-2 text-right font-medium">Ціна закупки</th>
              <th className="w-[120px] px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr className="align-top">
              <td className="px-2 py-2">
                <Input
                  value={productQuery}
                  onChange={(e) => setProductQuery(e.target.value)}
                  placeholder="Абрикос"
                  enterKeyHint={MOBILE_ENTER_KEY_HINT}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
                  onKeyDown={blurOnEnter}
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  value={countryQuery}
                  onChange={(e) => setCountryQuery(e.target.value)}
                  placeholder="Іспанія"
                  enterKeyHint={MOBILE_ENTER_KEY_HINT}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
                  onKeyDown={blurOnEnter}
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  value={packageRaw}
                  onChange={(e) => onPackageChange(e.target.value)}
                  placeholder="—"
                  enterKeyHint={MOBILE_ENTER_KEY_HINT}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
                  onKeyDown={blurOnEnter}
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  inputMode="numeric"
                  enterKeyHint={MOBILE_ENTER_KEY_HINT}
                  className="text-right"
                  value={palletsRaw}
                  onChange={(e) => onPalletsChange(e.target.value)}
                  onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
                  onKeyDown={blurOnEnter}
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  inputMode="decimal"
                  enterKeyHint={MOBILE_ENTER_KEY_HINT}
                  className="text-right"
                  value={netRaw}
                  onChange={(e) => onNetChange(e.target.value)}
                  placeholder="—"
                  onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
                  onKeyDown={blurOnEnter}
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  inputMode="decimal"
                  enterKeyHint={MOBILE_ENTER_KEY_HINT}
                  className="text-right"
                  value={grossRaw}
                  onChange={(e) => onGrossChange(e.target.value)}
                  placeholder="—"
                  onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
                  onKeyDown={blurOnEnter}
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  inputMode="decimal"
                  enterKeyHint={MOBILE_ENTER_KEY_HINT}
                  className="text-right"
                  value={priceRaw}
                  onChange={(e) => onPriceChange(e.target.value)}
                  placeholder="—"
                  onFocus={(e) => scrollFocusedIntoView(e.currentTarget)}
                  onKeyDown={blurOnEnter}
                />
              </td>

              <td className="px-2 py-2">
                <div className="flex gap-2 justify-end">
                  <Button size="sm" onClick={handleConfirm}>
                    Підтвердити
                  </Button>
                  <Button size="sm" variant="ghost" onClick={clearRow}>
                    Очистити
                  </Button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {hint && (
        <div>
          <Badge variant={hint.variant}>{hint.text}</Badge>
        </div>
      )}
    </div>
  );
}
