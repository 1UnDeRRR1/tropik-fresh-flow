import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Refresh EUR/USD rate from Frankfurter and upsert into exchange_rates.
// Called daily by pg_cron with the project anon key as `apikey` header.
export const Route = createFileRoute("/api/public/hooks/refresh-fx")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const res = await fetch("https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD");
          if (!res.ok) {
            return new Response(`frankfurter failed: ${res.status}`, { status: 502 });
          }
          const json = (await res.json()) as { date: string; rates: { USD: number } };
          const rate = json.rates?.USD;
          const date = json.date;
          if (!rate || !date) return new Response("invalid frankfurter payload", { status: 502 });

          const url = process.env.SUPABASE_URL!;
          const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
          const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

          const { error } = await admin.from("exchange_rates").upsert(
            {
              base_currency: "EUR",
              target_currency: "USD",
              rate,
              source: "frankfurter",
              rate_date: date,
            },
            { onConflict: "base_currency,target_currency,rate_date" },
          );
          if (error) return new Response(error.message, { status: 500 });

          return Response.json({ ok: true, rate, date });
        } catch (err) {
          return new Response(err instanceof Error ? err.message : "error", { status: 500 });
        }
      },
    },
  },
});
