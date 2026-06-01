import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

const STORAGE_PREFIX = "tropik-activity-session-id:";
const HEARTBEAT_MS = 60_000;
const MIN_GAP_MS = 30_000;
const HIDDEN_MAX_MS = 5 * 60_000;
const ACTIVITY_WINDOW_MS = 60_000;

function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`;
}

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
  return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? "mobile-web" : "web";
}

/**
 * Phase A activity tracking. Mount once under the authenticated layout.
 * Idempotent: relies on `rpc_activity_start_session` reusing a recent active
 * row for the same user/UA/platform within 5 minutes, plus client-side
 * single-flight guard and user-scoped sessionStorage to avoid duplicate rows
 * on reload / remount / StrictMode double-invoke.
 */
export function useActivityHeartbeat(): void {
  const { user } = useAuth();
  const sessionIdRef = useRef<string | null>(null);
  const startInFlightRef = useRef<Promise<string | null> | null>(null);
  const startedForUserRef = useRef<string | null>(null);
  const lastBeatRef = useRef<number>(0);
  const lastActivityRef = useRef<number>(Date.now());
  const lastVisibleAtRef = useRef<number>(Date.now());
  const pathRef = useRef<string>(
    typeof window !== "undefined" ? window.location.pathname : "/"
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mark = () => { lastActivityRef.current = Date.now(); };
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
    const uid = user.id;
    const key = storageKey(uid);

    const ensureSession = async (): Promise<string | null> => {
      if (sessionIdRef.current && startedForUserRef.current === uid) {
        return sessionIdRef.current;
      }
      if (startInFlightRef.current) {
        return startInFlightRef.current;
      }
      startInFlightRef.current = (async () => {
        try {
          // 1) Try to reuse an existing sessionId from sessionStorage via heartbeat.
          const existing = window.sessionStorage.getItem(key);
          if (existing) {
            const { error } = await supabase.rpc("rpc_activity_heartbeat", {
              p_session_id: existing,
              p_last_path: pathRef.current.slice(0, 200),
            });
            if (!error) {
              sessionIdRef.current = existing;
              startedForUserRef.current = uid;
              lastBeatRef.current = Date.now();
              return existing;
            }
            // Stale id (deleted / expired) — fall through to start.
            try { window.sessionStorage.removeItem(key); } catch { /* ignore */ }
          }
          // 2) Start (RPC is idempotent: reuses any active <5min row server-side).
          const { data, error } = await supabase.rpc("rpc_activity_start_session", {
            p_user_agent: navigator.userAgent.slice(0, 300),
            p_platform: getPlatform(),
            p_app_version: getAppVersion() ?? undefined,
            p_last_path: pathRef.current.slice(0, 200),
          });
          if (error) return null;
          const id = (data as string | null) ?? null;
          if (id && !cancelled) {
            sessionIdRef.current = id;
            startedForUserRef.current = uid;
            lastBeatRef.current = Date.now();
            try { window.sessionStorage.setItem(key, id); } catch { /* ignore */ }
          }
          return id;
        } catch {
          return null;
        } finally {
          startInFlightRef.current = null;
        }
      })();
      return startInFlightRef.current;
    };

    void ensureSession();

    const beat = async () => {
      const id = sessionIdRef.current ?? (await ensureSession());
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
      } catch { /* swallow */ }
    };

    const intervalId = window.setInterval(() => { void beat(); }, HEARTBEAT_MS);

    const endBestEffort = () => {
      const id = sessionIdRef.current;
      if (!id) return;
      try {
        void supabase.rpc("rpc_activity_end_session", { p_session_id: id });
        window.sessionStorage.removeItem(key);
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

/** Best-effort close on explicit signOut. Clears only the current user's key. */
export async function closeCurrentActivitySession(userId?: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if (userId) {
      const key = storageKey(userId);
      const id = window.sessionStorage.getItem(key);
      if (!id) return;
      window.sessionStorage.removeItem(key);
      await supabase.rpc("rpc_activity_end_session", { p_session_id: id });
      return;
    }
    // Fallback: scan keys with our prefix.
    const ids: Array<{ key: string; id: string }> = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) {
        const v = window.sessionStorage.getItem(k);
        if (v) ids.push({ key: k, id: v });
      }
    }
    for (const { key, id } of ids) {
      window.sessionStorage.removeItem(key);
      await supabase.rpc("rpc_activity_end_session", { p_session_id: id });
    }
  } catch { /* swallow */ }
}
