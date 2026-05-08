// Multi-currency helpers. Base accounting currency = USD.
// Original entry currencies: EUR (default) or USD.
// EUR values get converted using a per-shipment EUR/USD snapshot rate.

import { supabase } from "@/integrations/supabase/client";

export type Currency = "EUR" | "USD";
export const CURRENCIES: Currency[] = ["EUR", "USD"];

export function convertToUsd(amount: number, currency: Currency, rate: number | null | undefined): number {
  const a = Number(amount || 0);
  if (currency === "USD") return a;
  return a * Number(rate || 0);
}

export const fmtUSD = (v: number) =>
  new Intl.NumberFormat("uk-UA", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v || 0);

export const fmtEUR = (v: number) =>
  new Intl.NumberFormat("uk-UA", { style: "currency", currency: "EUR", maximumFractionDigits: 2 }).format(v || 0);

export const fmtMoneyByCurrency = (v: number, currency: Currency) =>
  currency === "USD" ? fmtUSD(v) : fmtEUR(v);

export const fmtRate = (rate: number | null | undefined) =>
  rate ? new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 4 }).format(rate) : "—";

/** Fetch the latest stored EUR/USD rate from the database. */
export async function getLatestEurUsdRate(): Promise<{ rate: number; date: string } | null> {
  const { data } = await supabase
    .from("exchange_rates")
    .select("rate,rate_date")
    .eq("base_currency", "EUR")
    .eq("target_currency", "USD")
    .order("rate_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { rate: Number(data.rate), date: data.rate_date };
}
