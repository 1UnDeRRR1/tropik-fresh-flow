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
  for (const ch of input.toLowerCase()) {
    out += CYR_TO_LAT[ch] ?? ch;
  }
  return out;
}

/** 3-letter UPPER code from supplier name (Latin-only). */
export function buildSupplierCode(name: string): string {
  if (!name) return "XXX";
  const lat = transliterate(name).replace(/[^a-z]/g, "");
  return (lat.slice(0, 3) || "XXX").toUpperCase();
}

/** Country code from Ukrainian country name. Falls back to 2 first letters. */
export function getCountryCode(uaCountry?: string | null): string {
  if (!uaCountry) return "XX";
  const direct = COUNTRY_CODE[uaCountry];
  if (direct) return direct;
  const lat = transliterate(uaCountry).replace(/[^a-z]/g, "");
  return (lat.slice(0, 2) || "XX").toUpperCase();
}

export function formatVehicleCode(countryCode: string, sequenceNo: number): string {
  return `${countryCode}${String(sequenceNo).padStart(2, "0")}`;
}

export function formatShipmentCode(vehicleCode: string, supplierCode: string): string {
  return `${vehicleCode}-${supplierCode}`;
}

/** Reads next sequence_no for a country code via DB. */
export async function fetchNextVehicleSequence(countryCode: string): Promise<number> {
  const { data, error } = await supabase.rpc("next_vehicle_sequence", { p_country_code: countryCode });
  if (error) throw error;
  return Number(data ?? 1);
}
