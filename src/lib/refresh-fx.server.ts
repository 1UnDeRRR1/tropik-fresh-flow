// Server-only helper: fetch latest EUR/USD from Frankfurter and upsert into
// exchange_rates. Shared between the cron hook
// (/api/public/hooks/refresh-fx) and the authenticated manual refresh
// server function. No business formulas live here — only fetch + persist
// of the raw rate row.
//
// SECURITY: this file imports the service-role admin client and must never
// be imported from client-reachable code. Callers (cron route, server fn)
// load it via a top-level import inside server-only execution paths or via
// dynamic `await import(...)` inside a handler.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type RefreshFxResult =
  | { ok: true; rate: number; date: string; source: "frankfurter" | "manual" }
  | { ok: false; status: number; message: string };

export async function refreshFxRate(source: "frankfurter" | "manual" = "frankfurter"): Promise<RefreshFxResult> {
  try {
    const res = await fetch("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD");
    if (!res.ok) {
      return { ok: false, status: 502, message: `Джерело курсу недоступне (HTTP ${res.status})` };
    }
    const json = (await res.json()) as { date?: string; rates?: { USD?: number } };
    const rate = json.rates?.USD;
    const date = json.date;
    if (!rate || !date) {
      return { ok: false, status: 502, message: "Невірна відповідь джерела курсу" };
    }

    const { error } = await supabaseAdmin.from("exchange_rates").upsert(
      {
        base_currency: "EUR",
        target_currency: "USD",
        rate,
        source,
        rate_date: date,
      },
      { onConflict: "base_currency,target_currency,rate_date" },
    );
    if (error) {
      return { ok: false, status: 500, message: error.message };
    }

    return { ok: true, rate, date, source };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      message: err instanceof Error ? err.message : "Не вдалося оновити курс",
    };
  }
}
