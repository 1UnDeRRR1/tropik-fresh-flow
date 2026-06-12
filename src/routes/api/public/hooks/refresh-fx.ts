import { createFileRoute } from "@tanstack/react-router";
import { requireCronSecret } from "@/lib/cron-guard.server";

// Refresh EUR/USD rate from Frankfurter and upsert into exchange_rates.
// Called daily by pg_cron with x-cron-secret header. Cron-only — manual
// user-initiated refresh goes through the authenticated server fn
// (src/lib/fx-refresh.functions.ts), not this endpoint.
export const Route = createFileRoute("/api/public/hooks/refresh-fx")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = requireCronSecret(request);
        if (denied) return denied;
        const { refreshFxRate } = await import("@/lib/refresh-fx.server");
        const result = await refreshFxRate("frankfurter");
        if (!result.ok) return new Response(result.message, { status: result.status });
        return Response.json({ ok: true, rate: result.rate, date: result.date });
      },
    },
  },
});
