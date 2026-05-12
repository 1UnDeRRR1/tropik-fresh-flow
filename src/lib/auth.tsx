import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { logSystem } from "@/lib/system-log";

export type AppRole = "super_admin" | "admin" | "import_manager" | "branch";

export interface Profile {
  id: string;
  full_name: string | null;
  branch_id: string | null;
  avatar_url: string | null;
  phone: string | null;
}

interface AuthCtx {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  roles: AppRole[];
  loading: boolean;
  dataLoaded: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  hasRole: (r: AppRole | AppRole[]) => boolean;
  primaryRole: AppRole | null;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

const ROLE_PRIORITY: AppRole[] = ["super_admin", "admin", "import_manager", "branch"];
const AUTH_BACKUP_KEY = "tropik-auth-backup";

function parseStoredSession(raw: string | null): { session: Session | null; user: User | null; hasToken: boolean } {
  if (!raw) return { session: null, user: null, hasToken: false };
  try {
    const parsed = JSON.parse(raw);
    const candidate = (parsed?.currentSession ?? parsed?.session ?? parsed) as Session | null | undefined;
    const exp = (candidate as { expires_at?: number } | null | undefined)?.expires_at;
    if (exp && Date.now() / 1000 - exp > 60 * 60 * 24 * 7) {
      return { session: null, user: null, hasToken: true };
    }
    return {
      session: candidate ?? null,
      user: (candidate?.user as User | undefined) ?? null,
      hasToken: true,
    };
  } catch {
    return { session: null, user: null, hasToken: true };
  }
}

function readStorageSession(storage: Storage | undefined, preferredKey: string | null) {
  if (!storage) return { session: null, user: null, hasToken: false };

  const keys = [
    AUTH_BACKUP_KEY,
    ...(preferredKey ? [preferredKey] : []),
    ...Object.keys(storage).filter((key) => key.startsWith("sb-") && key.endsWith("-auth-token")),
  ];

  const seen = new Set<string>();
  for (const key of keys) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const parsed = parseStoredSession(storage.getItem(key));
    if (parsed.hasToken) {
      return parsed;
    }
  }

  return { session: null, user: null, hasToken: false };
}

function persistSessionBackup(session: Session | null) {
  if (typeof window === "undefined") return;
  try {
    if (!session) {
      localStorage.removeItem(AUTH_BACKUP_KEY);
      sessionStorage.removeItem(AUTH_BACKUP_KEY);
      return;
    }
    const raw = JSON.stringify(session);
    localStorage.setItem(AUTH_BACKUP_KEY, raw);
    sessionStorage.setItem(AUTH_BACKUP_KEY, raw);
  } catch {
    /* ignore storage failures */
  }
}

// Synchronously read the cached Supabase session from localStorage so that
// when iOS Safari kills + restores the tab (background, rotation, phone call,
// app switch) we can paint the authenticated shell on the very first render
// instead of flashing the full-screen splash + redirect-to-login.
function readCachedSession(): { session: Session | null; user: User | null; hasPersistedToken: boolean } {
  if (typeof window === "undefined") return { session: null, user: null, hasPersistedToken: false };
  try {
    const projectRef = (import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined) ?? "";
    const key = projectRef ? `sb-${projectRef}-auth-token` : null;
    const local = readStorageSession(localStorage, key);
    if (local.user || local.session || local.hasToken) {
      return { session: local.session, user: local.user, hasPersistedToken: local.hasToken };
    }

    const session = readStorageSession(sessionStorage, key);
    return { session: session.session, user: session.user, hasPersistedToken: session.hasToken };
  } catch {
    return { session: null, user: null, hasPersistedToken: false };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [cached] = useState(() => readCachedSession());
  const [session, setSession] = useState<Session | null>(cached.session);
  const [user, setUser] = useState<User | null>(cached.user);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  // Keep the very first render deterministic across SSR and client hydration.
  // iPhone rotation can recreate the webview; if client-side storage makes the
  // client render AppShell while SSR rendered the splash, React throws a
  // hydration mismatch and remounts the tree, which looks like a logout/reset.
  const [loading, setLoading] = useState(true);

  const loadUserData = async (uid: string) => {
    const [{ data: prof, error: profileError }, { data: rs, error: rolesError }] = await Promise.all([
      supabase.from("profiles").select("id,full_name,branch_id,avatar_url,phone").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);

    const nextRoles = ((rs ?? []) as { role: AppRole }[]).map((r) => r.role);
    if (profileError || rolesError || nextRoles.length === 0) {
      void logSystem({
        level: "warning",
        message: "Skipped auth/profile overwrite because refresh returned incomplete identity data",
        module: "auth",
        action: "load_user_data_guard",
        context: {
          user_id: uid,
          profile_error: profileError?.message ?? null,
          roles_error: rolesError?.message ?? null,
          roles_count: nextRoles.length,
          timestamp: new Date().toISOString(),
        },
      });
      setDataLoaded((prev) => prev || !!user);
      return;
    }

    setProfile((prof as Profile | null) ?? profile);
    setRoles(nextRoles);
    setDataLoaded(true);
  };

  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    // Seed currentUid from the synchronously-restored session so that the
    // SIGNED_IN event fired right after re-hydration is treated as a no-op
    // instead of triggering a full profile/roles reload (which would briefly
    // wipe roles and flash empty pages on mobile resume).
    let currentUid: string | null = cached.user?.id ?? null;
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      persistSessionBackup(s);
      setSession(s);
      if (s?.user) setUser(s.user);
      const nextUid = s?.user?.id ?? null;
      if (nextUid) {
        // Only reload profile/roles when the user identity actually changes
        // (initial sign-in or account switch). TOKEN_REFRESHED / USER_UPDATED
        // events keep the same uid — do NOT reset dataLoaded or wipe roles,
        // otherwise UI gated on dataLoaded/roles flashes empty every ~50 min
        // when Supabase silently rotates the access token.
        if (nextUid !== currentUid) {
          currentUid = nextUid;
          setDataLoaded(false);
          setTimeout(() => loadUserData(nextUid), 0);
        }
      } else if (event === "SIGNED_OUT") {
        const fallback = readCachedSession();
        if (fallback.user && fallback.session) {
          void logSystem({
            level: "warning",
            message: "Suppressed transient signed-out state while persisted mobile session still exists",
            module: "auth",
            action: "signed_out_guard",
            context: {
              cached_user_id: fallback.user.id,
              timestamp: new Date().toISOString(),
            },
          });
          setSession(fallback.session);
          setUser(fallback.user);
          setLoading(true);
          return;
        }
        currentUid = null;
        setUser(null);
        setSession(null);
        setProfile(null);
        setRoles([]);
        setDataLoaded(true);
      }
    });
    // If we have a cached user, fetch profile/roles in the background so that
    // the shell renders instantly while role-gated UI hydrates a moment later.
    if (cached.user) {
      void loadUserData(cached.user.id);
    }
    supabase.auth.getSession().then(async ({ data }) => {
      let nextSession = data.session ?? null;

      if (!nextSession && cached.session?.access_token && cached.session?.refresh_token) {
        const { data: restored, error } = await supabase.auth.setSession({
          access_token: cached.session.access_token,
          refresh_token: cached.session.refresh_token,
        });

        if (error) {
          void logSystem({
            level: "warning",
            message: "Failed to restore persisted auth session during mobile resume",
            module: "auth",
            action: "restore_session_failed",
            context: {
              cached_user_id: cached.user?.id ?? null,
              error: error.message,
              timestamp: new Date().toISOString(),
            },
          });
        }

        nextSession = restored.session ?? null;
      }

      persistSessionBackup(nextSession);
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      if (nextSession?.user) {
        if (currentUid !== nextSession.user.id) {
          currentUid = nextSession.user.id;
          await loadUserData(nextSession.user.id);
        }
      } else {
        const fallback = readCachedSession();
        if (fallback.user && fallback.session) {
          setSession(fallback.session);
          setUser(fallback.user);
          if (currentUid !== fallback.user.id) {
            currentUid = fallback.user.id;
            await loadUserData(fallback.user.id);
          }
          void logSystem({
            level: "warning",
            message: "Recovered auth state from persisted storage after empty getSession result",
            module: "auth",
            action: "restore_session_fallback",
            context: {
              cached_user_id: fallback.user.id,
              timestamp: new Date().toISOString(),
            },
          });
        } else if (!currentUid) {
          setDataLoaded(true);
        }
      }
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthCtx = {
    user,
    session,
    profile,
    roles,
    loading,
    dataLoaded,
    signOut: async () => {
      await supabase.auth.signOut();
    },
    refresh: async () => {
      if (user) await loadUserData(user.id);
    },
    hasRole: (r) => {
      const arr = Array.isArray(r) ? r : [r];
      return roles.some((x) => arr.includes(x));
    },
    primaryRole: ROLE_PRIORITY.find((r) => roles.includes(r)) ?? null,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}

export const ROLE_LABEL_UK: Record<AppRole, string> = {
  super_admin: "Супер-адмін",
  admin: "Адміністратор",
  import_manager: "Менеджер ЗЕД",
  branch: "Філія",
};

export function defaultRoutePerRole(role: AppRole | null): string {
  switch (role) {
    case "super_admin":
      return "/dashboard/super-admin";
    case "admin":
      return "/dashboard/admin";
    case "import_manager":
      return "/dashboard/manager";
    case "branch":
      return "/dashboard/branch";
    default:
      return "/dashboard/branch";
  }
}

/**
 * Centralized post-login destination resolver.
 * Returns { ready, target } — `target` is the role-specific "Головна" page.
 * Use in any redirect entry point (login page, _authenticated/index, OAuth callback, etc.)
 * so that the landing rule is identical everywhere.
 */
export function usePostLoginTarget(): { ready: boolean; target: string } {
  const { user, loading, dataLoaded, primaryRole } = useAuth();
  const ready = !loading && !!user && dataLoaded;
  return { ready, target: defaultRoutePerRole(primaryRole) };
}

