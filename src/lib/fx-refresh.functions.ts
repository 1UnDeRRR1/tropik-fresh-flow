// Authenticated manual FX refresh. Backs the "Оновити зараз" button in
// FxRateBadge. Distinct from the cron hook (/api/public/hooks/refresh-fx)
// which stays X-Cron-Secret-protected and is never called by the UI.
//
// Allowed roles: super_admin, admin, import_manager, logistics.
// Other roles (branch, broker, calendar_*, owner) get a clean 403.

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ALLOWED_ROLES = ["super_admin", "admin", "import_manager", "logistics"] as const;

export const refreshFxManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // Role check via SECURITY DEFINER has_role(uid, role). Run in parallel
    // and short-circuit if any returns true.
    const checks = await Promise.all(
      ALLOWED_ROLES.map((role) =>
        context.supabase.rpc("has_role", { _user_id: context.userId, _role: role }),
      ),
    );
    const allowed = checks.some((r) => r.data === true);
    if (!allowed) {
      throw new Response("Недостатньо прав для оновлення курсу", { status: 403 });
    }

    const { refreshFxRate } = await import("@/lib/refresh-fx.server");
    const result = await refreshFxRate("frankfurter");
    if (!result.ok) {
      throw new Response(result.message, { status: result.status });
    }
    return { ok: true as const, rate: result.rate, date: result.date };
  });
