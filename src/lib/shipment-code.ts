// Shipment / vehicle code helpers
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

/**
 * Build a PascalCase supplier code base from a free-form name (max 10 chars).
 * Used as a fallback when supplier.code_base is not set. Examples:
 *   "Nava"               → "Nava"
 *   "BRACIA BRACIK GRUPA" → "BraciaBrac"
 *   "Bury"                → "Bury"
 */
export function buildSupplierCode(name: string): string {
  if (!name) return "SUPPLIER";
  const words = transliterate(name)
    .replace(/[^a-zA-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
  const joined = words.join("") || "SUPPLIER";
  return joined.slice(0, 10).toUpperCase();
}

/** ISO3 code from Ukrainian country name. Falls back to 3 first letters. */
export function getCountryCode(uaCountry?: string | null): string {
  if (!uaCountry) return "XXX";
  const direct = COUNTRY_CODE[uaCountry];
  if (direct) return direct;
  const lat = transliterate(uaCountry).replace(/[^a-zA-Z]/g, "");
  return (lat.slice(0, 3) || "XXX").toUpperCase();
}

/** Vehicle code: `${seq02}-${ISO3}` e.g. "01-ITA". */
export function formatVehicleCode(countryCode: string, sequenceNo: number): string {
  return `${String(sequenceNo).padStart(2, "0")}-${countryCode}`;
}

/** Shipment code: `${supplierBase}${vehicleCode}` e.g. "Nava01-ITA". */
export function formatShipmentCode(vehicleCode: string, supplierCode: string): string {
  return `${supplierCode}${vehicleCode}`;
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
