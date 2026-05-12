// Best-effort system logger. Writes a row into public.system_logs. Never throws.
import { supabase } from "@/integrations/supabase/client";

export type LogLevel = "info" | "warning" | "critical";

export interface LogEntry {
  level: LogLevel;
  message: string;
  module?: string;
  action?: string;
  shipment_id?: string | null;
  offer_id?: string | null;
  branch_id?: string | null;
  vehicle_id?: string | null;
  distribution_id?: string | null;
  context?: Record<string, unknown>;
}

let installed = false;

export async function logSystem(entry: LogEntry): Promise<void> {
  try {
    await supabase.from("system_logs").insert({
      level: entry.level,
      message: (entry.message ?? "").slice(0, 4000),
      module: entry.module ?? null,
      action: entry.action ?? null,
      shipment_id: entry.shipment_id ?? null,
      offer_id: entry.offer_id ?? null,
      branch_id: entry.branch_id ?? null,
      vehicle_id: entry.vehicle_id ?? null,
      distribution_id: entry.distribution_id ?? null,
      context: entry.context ?? null,
    });
  } catch {
    /* swallow */
  }
}

export function installGlobalErrorLogger(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (ev) => {
    const err = (ev as ErrorEvent).error ?? ev;
    void logSystem({
      level: "critical",
      message: err instanceof Error ? err.message : String(err),
      module: window.location.pathname,
      action: "window.onerror",
      context: {
        stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
        filename: (ev as ErrorEvent).filename,
        lineno: (ev as ErrorEvent).lineno,
      },
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = (ev as PromiseRejectionEvent).reason;
    void logSystem({
      level: "critical",
      message: reason instanceof Error ? reason.message : String(reason ?? "unhandledrejection"),
      module: window.location.pathname,
      action: "unhandledrejection",
      context: {
        stack: reason instanceof Error ? reason.stack?.slice(0, 2000) : undefined,
      },
    });
  });
}
