import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireCronSecret } from "@/lib/cron-guard.server";

export const Route = createFileRoute("/api/public/hooks/shipments-lifecycle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = requireCronSecret(request);
        if (denied) return denied;

        const results: Record<string, number | string> = {};

        const { data: unloaded, error: e1 } = await supabaseAdmin.rpc("auto_unload_shipments");
        if (e1) results.auto_unload_error = e1.message;
        else results.auto_unloaded = unloaded ?? 0;

        const { data: archivedCancelled, error: e2 } = await supabaseAdmin.rpc("archive_due_cancelled_shipments");
        if (e2) results.archive_cancelled_error = e2.message;
        else results.archived_cancelled = archivedCancelled ?? 0;

        const { data: archivedUnloaded, error: e3 } = await supabaseAdmin.rpc("archive_due_unloaded_shipments");
        if (e3) results.archive_unloaded_error = e3.message;
        else results.archived_unloaded = archivedUnloaded ?? 0;

        return new Response(JSON.stringify({ ok: true, ...results }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
