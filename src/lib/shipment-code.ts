// Shipment / vehicle code helpers.
//
// New unified format: `AAAAA-XXX-VVV-YYY`
//   AAAAA — 5-letter supplier alias
//   XXX   — per-supplier shipment sequence (zero-padded to 3)
//   VVV   — ISO3 country code
//   YYY   — per-country vehicle sequence (zero-padded to 3)
import { COUNTRY_CODE } from "@/lib/arrival";
import { supabase } from "@/integrations/supabase/client";

const CYR_TO_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "h", ґ: "g", д: "d", е: "e", є: "ie", ж: "zh",
  з: "z", и: "y", і: "i", ї: "i", й: "i", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ь: "", ю: "iu", я: "ia",
};

function transliterate(input: string): string {
  let out = "";
  for (const ch of input) {
    const lower = ch.toLowerCase();
    const mapped = CYR_TO_LAT[lower];
    if (mapped !== undefined) {
      out += ch === lower ? mapped : (mapped ? mapped[0].toUpperCase() + mapped.slice(1) : "");
    } else {
      out += ch;
    }
  }
  return out;
}

const pad3 = (n: number | string) => String(n).padStart(3, "0");

/**
 * Resolve the supplier 5-letter alias.
 * Prefers the explicit `alias` column, falls back to the first 5 letters of
 * the legacy `code_base` or a transliterated name. Always returns 5 chars,
 * uppercase, padded with `X` if input is too short.
 */
export function getSupplierAlias(supplier: { alias?: string | null; code_base?: string | null; name?: string | null } | null | undefined): string {
  const candidates = [supplier?.alias, supplier?.code_base, supplier?.name];
  for (const raw of candidates) {
    if (!raw) continue;
    const letters = transliterate(raw).replace(/[^a-zA-Z]/g, "").toUpperCase();
    if (letters.length >= 5) return letters.slice(0, 5);
    if (letters.length > 0) return (letters + "XXXXX").slice(0, 5);
  }
  return "XXXXX";
}

/** ISO3 code from Ukrainian country name. Falls back to 3 first letters. */
export function getCountryCode(uaCountry?: string | null): string {
  if (!uaCountry) return "XXX";
  const direct = COUNTRY_CODE[uaCountry];
  if (direct) return direct;
  const lat = transliterate(uaCountry).replace(/[^a-zA-Z]/g, "");
  return (lat.slice(0, 3) || "XXX").toUpperCase();
}

/** Vehicle code: `${ISO3}-${seq03}` e.g. "ITA-001". */
export function formatVehicleCode(countryCode: string, sequenceNo: number): string {
  return `${countryCode}-${pad3(sequenceNo)}`;
}

/** Full shipment code: `${alias}-${supplierSeq03}-${vehicleCode}` e.g. "NAVAN-001-ITA-001". */
export function formatShipmentCode(params: {
  alias: string;
  supplierSeq: number;
  vehicleCode: string;
}): string {
  return `${params.alias}-${pad3(params.supplierSeq)}-${params.vehicleCode}`.toUpperCase();
}

/** Reads next sequence_no for a country code via DB. */
export async function fetchNextVehicleSequence(countryCode: string): Promise<number> {
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: number | null; error: { message: string } | null }>)(
    "next_vehicle_sequence",
    { p_country_code: countryCode },
  );
  if (error) throw new Error(error.message);
  return Number(data ?? 1);
}

/** Reads next per-supplier shipment sequence via DB. */
export async function fetchNextSupplierSequence(supplierId: string): Promise<number> {
  const { data, error } = await (supabase.rpc as unknown as (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: number | null; error: { message: string } | null }>)(
    "next_supplier_sequence",
    { p_supplier_id: supplierId },
  );
  if (error) throw new Error(error.message);
  return Number(data ?? 1);
}
