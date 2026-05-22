import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  if (v.startsWith(".")) v = `0${v}`;
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

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toResolverResult(payload: unknown): ResolverResult | null {
  const row = Array.isArray(payload)
    ? payload[0]
    : payload && typeof payload === "object"
      ? payload
      : null;

  if (!row || typeof row !== "object") return null;

  const record = row as Record<string, unknown>;
  const status = record.status;
  if (
    status !== "matched" &&
    status !== "pallet_no_match" &&
    status !== "product_no_match" &&
    status !== "product_ambiguous" &&
    status !== "country_no_match"
  ) {
    return null;
  }

  return {
    status,
    product_dictionary_id: asText(record.product_dictionary_id),
    canonical_product_id: asText(record.canonical_product_id),
    product_name_ua: asText(record.product_name_ua),
    product_match_status: asText(record.product_match_status),
    product_candidate_count: asNumber(record.product_candidate_count) ?? 0,
    country_name: asText(record.country_name),
    country_iso3: asText(record.country_iso3),
    country_match_status: asText(record.country_match_status),
    pallet_standard_id: asText(record.pallet_standard_id),
    package_used: asText(record.package_used),
    pallet_net_kg: asNumber(record.pallet_net_kg),
    pallet_gross_kg: asNumber(record.pallet_gross_kg),
    pallet_footprint_text: asText(record.pallet_footprint_text),
    pallet_selected_by: asText(record.pallet_selected_by),
    pallet_candidate_count: asNumber(record.pallet_candidate_count) ?? 0,
    needs_review: record.needs_review === true,
    review_reason: asText(record.review_reason),
  };
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

const EMPTY_FLAGS: Record<FieldKey, boolean> = {
  package: false,
  net: false,
  gross: false,
};

export function DraftOfferLineRow({
  onConfirmToast,
}: {
  onConfirmToast: (msg: string) => void;
}) {
  const [s, setS] = useState<RowState>(INITIAL);
  const [manuallyEdited, setManuallyEdited] = useState<Record<FieldKey, boolean>>(EMPTY_FLAGS);
  const [autoFilled, setAutoFilled] = useState<Record<FieldKey, boolean>>(EMPTY_FLAGS);
  const [resolver, setResolver] = useState<ResolverResult | null>(null);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const lastResolvedKey = useRef<string | null>(null);
  const requestSeq = useRef(0);

  const update = useCallback(<K extends keyof RowState>(key: K, value: RowState[K]) => {
    setS((prev) => ({ ...prev, [key]: value }));
  }, []);

  const markManual = useCallback((field: FieldKey) => {
    setManuallyEdited((prev) => ({ ...prev, [field]: true }));
    setAutoFilled((prev) => ({ ...prev, [field]: false }));
  }, []);

  useEffect(() => {
    const product = s.productQuery.trim();
    const country = s.countryQuery.trim();

    if (!product || !country) {
      requestSeq.current += 1;
      setResolving(false);
      setResolver(null);
      setRpcError(null);
      setAutoFilled(EMPTY_FLAGS);
      lastResolvedKey.current = null;
      return;
    }

    const seq = requestSeq.current + 1;
    requestSeq.current = seq;

    const timer = setTimeout(async () => {
      setResolving(true);
      setRpcError(null);

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

        if (seq !== requestSeq.current) return;

        if (error) {
          console.warn("[draft resolver]", error.message);
          setResolver(null);
          setRpcError(error.message);
          setAutoFilled(EMPTY_FLAGS);
          return;
        }

        const normalized = toResolverResult(data);
        if (!normalized) {
          setResolver(null);
          setRpcError("RPC повернув порожню або неочікувану відповідь");
          setAutoFilled(EMPTY_FLAGS);
          return;
        }

        setResolver(normalized);

        if (normalized.status !== "matched") {
          lastResolvedKey.current =
            normalized.canonical_product_id && normalized.country_name
              ? `${normalized.canonical_product_id}::${normalized.country_name}`
              : null;
          setAutoFilled(EMPTY_FLAGS);
          return;
        }

        const nextKey = `${normalized.canonical_product_id ?? ""}::${normalized.country_name ?? ""}`;
        const nextAutoFilled = {
          package: !manuallyEdited.package && normalized.package_used != null,
          net: !manuallyEdited.net && normalized.pallet_net_kg != null,
          gross: !manuallyEdited.gross && normalized.pallet_gross_kg != null,
        };

        lastResolvedKey.current = nextKey;
        setS((prev) => ({
          ...prev,
          packageRaw: nextAutoFilled.package ? normalized.package_used ?? prev.packageRaw : prev.packageRaw,
          netRaw: nextAutoFilled.net ? String(normalized.pallet_net_kg) : prev.netRaw,
          grossRaw: nextAutoFilled.gross ? String(normalized.pallet_gross_kg) : prev.grossRaw,
        }));
        setAutoFilled(nextAutoFilled);
      } catch (error) {
        if (seq !== requestSeq.current) return;
        setResolver(null);
        setRpcError(error instanceof Error ? error.message : "RPC виклик завершився помилкою");
        setAutoFilled(EMPTY_FLAGS);
      } finally {
        if (seq === requestSeq.current) {
          setResolving(false);
        }
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [manuallyEdited, s.countryQuery, s.productQuery]);

  const hint = useMemo(() => {
    if (resolving) {
      return {
        badgeVariant: "outline" as const,
        text: "Викликаю rpc_resolve_offer_line_defaults…",
      };
    }

    if (rpcError) {
      return {
        badgeVariant: "destructive" as const,
        text: `RPC error: ${rpcError}`,
      };
    }

    if (!resolver) return null;

    switch (resolver.status) {
      case "matched":
        return {
          badgeVariant: "default" as const,
          text: `matched · ${resolver.product_name_ua ?? "—"} · ${resolver.country_name ?? "—"}`,
        };
      case "pallet_no_match":
        return {
          badgeVariant: "secondary" as const,
          text: `pallet_no_match · ${resolver.product_name_ua ?? "—"} · ${resolver.country_name ?? "—"}. Стандарт палети не знайдено — введіть вагу вручну.`,
        };
      case "product_ambiguous":
        return {
          badgeVariant: "secondary" as const,
          text: `product_ambiguous · кандидатів: ${resolver.product_candidate_count}`,
        };
      case "product_no_match":
        return {
          badgeVariant: "destructive" as const,
          text: "product_no_match · товар не розпізнано",
        };
      case "country_no_match":
        return {
          badgeVariant: "destructive" as const,
          text: "country_no_match · країну не розпізнано",
        };
    }
  }, [resolver, resolving, rpcError]);

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

    const productOk =
      resolver.canonical_product_id != null && resolver.product_match_status === "matched";
    const countryOk = resolver.country_match_status === "matched" && resolver.country_name != null;

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
    requestSeq.current += 1;
    lastResolvedKey.current = null;
    setS(INITIAL);
    setResolver(null);
    setRpcError(null);
    setResolving(false);
    setManuallyEdited(EMPTY_FLAGS);
    setAutoFilled(EMPTY_FLAGS);
  };

  const debugFields = [
    { label: "status", value: resolver?.status ?? "—" },
    { label: "product_name_ua", value: resolver?.product_name_ua ?? "—" },
    { label: "canonical_product_id", value: resolver?.canonical_product_id ?? "—" },
    { label: "country_name", value: resolver?.country_name ?? "—" },
    { label: "country_match_status", value: resolver?.country_match_status ?? "—" },
    { label: "package_used", value: resolver?.package_used ?? "—" },
    { label: "pallet_net_kg", value: resolver?.pallet_net_kg != null ? String(resolver.pallet_net_kg) : "—" },
    {
      label: "pallet_gross_kg",
      value: resolver?.pallet_gross_kg != null ? String(resolver.pallet_gross_kg) : "—",
    },
    { label: "pallet_selected_by", value: resolver?.pallet_selected_by ?? "—" },
    {
      label: "pallet_candidate_count",
      value: resolver?.pallet_candidate_count != null ? String(resolver.pallet_candidate_count) : "—",
    },
    { label: "RPC error", value: rpcError ?? "—" },
  ];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-md border bg-background">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="w-[180px] px-2 py-2 text-left font-medium">Товар</th>
              <th className="w-[140px] px-2 py-2 text-left font-medium">Країна</th>
              <th className="w-[160px] px-2 py-2 text-left font-medium">Упаковка</th>
              <th className="w-[90px] px-2 py-2 text-right font-medium">Net, кг</th>
              <th className="w-[90px] px-2 py-2 text-right font-medium">Gross, кг</th>
              <th className="w-[80px] px-2 py-2 text-right font-medium">Палет</th>
              <th className="w-[90px] px-2 py-2 text-right font-medium">Ціна</th>
              <th className="w-[100px] px-2 py-2 text-right font-medium">Σ Net</th>
              <th className="w-[100px] px-2 py-2 text-right font-medium">Σ Gross</th>
              <th className="w-[80px] px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr className="align-top">
              <td className="px-2 py-2">
                <Input
                  value={s.productQuery}
                  onChange={(e) => update("productQuery", e.target.value)}
                  placeholder="Абрикос / Orange / Арбуз"
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  value={s.countryQuery}
                  onChange={(e) => update("countryQuery", e.target.value)}
                  placeholder="Spain / Turkey / Egypt"
                />
              </td>
              <td className="px-2 py-2">
                <Input
                  value={s.packageRaw}
                  onChange={(e) => {
                    update("packageRaw", e.target.value);
                    markManual("package");
                  }}
                  className={cn(autoFilled.package && "border-primary/40 bg-muted/40")}
                  placeholder="package_used"
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
                  className={cn("text-right", autoFilled.net && "border-primary/40 bg-muted/40")}
                  placeholder="pallet_net_kg"
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
                  className={cn("text-right", autoFilled.gross && "border-primary/40 bg-muted/40")}
                  placeholder="pallet_gross_kg"
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

      {hint ? (
        <div className="flex flex-wrap items-start gap-2 rounded-md border bg-muted/20 px-3 py-2 text-sm">
          <Badge variant={hint.badgeVariant}>{resolver?.status ?? (rpcError ? "rpc_error" : "resolving")}</Badge>
          <span>{hint.text}</span>
          {resolver?.review_reason ? (
            <span className="text-muted-foreground">review_reason: {resolver.review_reason}</span>
          ) : null}
        </div>
      ) : null}

      <section className="space-y-3 rounded-md border bg-muted/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Resolver debug</h3>
            <p className="text-xs text-muted-foreground">
              Тут видно фактичну відповідь rpc_resolve_offer_line_defaults для поточного товару і країни.
            </p>
          </div>
          <Badge variant="outline">draft-only</Badge>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {debugFields.map((field) => (
            <div key={field.label} className="rounded-md border bg-background px-3 py-2">
              <div className="text-[11px] uppercase text-muted-foreground">{field.label}</div>
              <div className="mt-1 break-all text-sm font-medium">{field.value}</div>
            </div>
          ))}
        </div>

        <div className="rounded-md border bg-background p-3">
          <div className="mb-2 text-[11px] uppercase text-muted-foreground">Raw RPC payload</div>
          <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-foreground">
            {JSON.stringify(resolver, null, 2) ?? "null"}
          </pre>
        </div>
      </section>

      <div className="flex gap-2">
        <Button onClick={handleConfirm}>Підтвердити (draft)</Button>
      </div>
    </div>
  );
}
