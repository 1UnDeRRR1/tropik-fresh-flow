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

// Synchronously read the cached Supabase session from localStorage so that
// when iOS Safari kills + restores the tab (background, rotation, phone call,
// app switch) we can paint the authenticated shell on the very first render
// instead of flashing the full-screen splash + redirect-to-login.
function readCachedSession(): { session: Session | null; user: User | null } {
  if (typeof window === "undefined") return { session: null, user: null };
  try {
    const projectRef = (import.meta.env.VITE_SUPABASE_PROJECT_ID as string | undefined) ?? "";
    const key = projectRef ? `sb-${projectRef}-auth-token` : null;
    const raw = key ? localStorage.getItem(key) : null;
    if (!raw) return { session: null, user: null };
    const parsed = JSON.parse(raw);
    const exp = parsed?.expires_at as number | undefined;
    // Accept slightly-expired sessions too — the SDK will silently refresh.
    if (exp && Date.now() / 1000 - exp > 60 * 60 * 24 * 7) return { session: null, user: null };
    const u = parsed?.user as User | undefined;
    return { session: parsed as Session, user: u ?? null };
  } catch {
    return { session: null, user: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const cached = readCachedSession();
  const [session, setSession] = useState<Session | null>(cached.session);
  const [user, setUser] = useState<User | null>(cached.user);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  // If we already have a cached user, never show the global splash on mount.
  const [loading, setLoading] = useState(!cached.user);

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
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        if (currentUid !== data.session.user.id) {
          currentUid = data.session.user.id;
          await loadUserData(data.session.user.id);
        }
      } else {
        // Keep the last authenticated identity during transient mobile/session restore.
        if (!currentUid) {
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

