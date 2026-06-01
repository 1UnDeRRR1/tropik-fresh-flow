import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

const STORAGE_KEY = "tropik-activity-session-id";
const HEARTBEAT_MS = 60_000;
const MIN_GAP_MS = 30_000;
const HIDDEN_MAX_MS = 5 * 60_000;
const ACTIVITY_WINDOW_MS = 60_000;

function getAppVersion(): string | null {
  try {
    const v = (import.meta as unknown as { env?: Record<string, string | undefined> })?.env?.VITE_APP_VERSION;
    return v ? String(v).slice(0, 50) : null;
  } catch {
    return null;
  }
}

function getPlatform(): string {
  if (typeof navigator === "undefined") return "web";
  // touch-capable -> mobile-web
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile-web" : "web";
}

/**
 * Phase A activity tracking. Mount once under the authenticated layout.
 * Creates a `user_activity_sessions` row on login, sends a heartbeat
 * approximately every 60s (throttled to 30s min gap), and best-effort
 * closes the session on signOut / pagehide.
 */
export function useActivityHeartbeat(): void {
  const { user } = useAuth();
  const sessionIdRef = useRef<string | null>(null);
  const lastBeatRef = useRef<number>(0);
  const lastActivityRef = useRef<number>(Date.now());
  const lastVisibleAtRef = useRef<number>(Date.now());
  const pathRef = useRef<string>(
    typeof window !== "undefined" ? window.location.pathname : "/"
  );

  // Track user activity (very lightweight)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mark = () => {
      lastActivityRef.current = Date.now();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        lastVisibleAtRef.current = Date.now();
        mark();
      }
    };
    window.addEventListener("mousemove", mark, { passive: true });
    window.addEventListener("keydown", mark);
    window.addEventListener("touchstart", mark, { passive: true });
    window.addEventListener("click", mark);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("mousemove", mark);
      window.removeEventListener("keydown", mark);
      window.removeEventListener("touchstart", mark);
      window.removeEventListener("click", mark);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Track current path (cheap polling — avoids router coupling)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => {
      pathRef.current = window.location.pathname;
    }, 5_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!user) return;
    if (typeof window === "undefined") return;

    let cancelled = false;

    const start = async () => {
      try {
        // Try to recover existing sessionId from sessionStorage (soft reload).
        const existing = window.sessionStorage.getItem(STORAGE_KEY);
        if (existing) {
          sessionIdRef.current = existing;
          return;
        }
        const { data, error } = await supabase.rpc("rpc_activity_start_session", {
          p_user_agent: navigator.userAgent.slice(0, 300),
          p_platform: getPlatform(),
          p_app_version: getAppVersion() ?? undefined,
          p_last_path: pathRef.current.slice(0, 200),
        });
        if (error || cancelled) return;
        const id = data as string | null;
        if (id) {
          sessionIdRef.current = id;
          try { window.sessionStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
          lastBeatRef.current = Date.now();
        }
      } catch {
        /* swallow */
      }
    };

    void start();

    const beat = async () => {
      const id = sessionIdRef.current;
      if (!id) return;
      const now = Date.now();
      if (now - lastBeatRef.current < MIN_GAP_MS) return;

      const visible = document.visibilityState === "visible";
      const hiddenTooLong = !visible && now - lastVisibleAtRef.current > HIDDEN_MAX_MS;
      const hadActivity = now - lastActivityRef.current < ACTIVITY_WINDOW_MS;
      if (hiddenTooLong) return;
      if (!visible && !hadActivity) return;

      lastBeatRef.current = now;
      try {
        await supabase.rpc("rpc_activity_heartbeat", {
          p_session_id: id,
          p_last_path: pathRef.current.slice(0, 200),
        });
      } catch {
        /* swallow */
      }
    };

    const intervalId = window.setInterval(() => { void beat(); }, HEARTBEAT_MS);

    const endBestEffort = () => {
      const id = sessionIdRef.current;
      if (!id) return;
      try {
        // fire-and-forget; we can't await on unload
        void supabase.rpc("rpc_activity_end_session", { p_session_id: id });
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch { /* ignore */ }
    };
    window.addEventListener("pagehide", endBestEffort);
    window.addEventListener("beforeunload", endBestEffort);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("pagehide", endBestEffort);
      window.removeEventListener("beforeunload", endBestEffort);
    };
  }, [user]);
}

/** Best-effort close on explicit signOut. */
export async function closeCurrentActivitySession(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const id = window.sessionStorage.getItem(STORAGE_KEY);
    if (!id) return;
    window.sessionStorage.removeItem(STORAGE_KEY);
    await supabase.rpc("rpc_activity_end_session", { p_session_id: id });
  } catch {
    /* swallow */
  }
}
