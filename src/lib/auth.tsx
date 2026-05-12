import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [loading, setLoading] = useState(true);

  const loadUserData = async (uid: string) => {
    const [{ data: prof }, { data: rs }] = await Promise.all([
      supabase.from("profiles").select("id,full_name,branch_id,avatar_url,phone").eq("id", uid).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", uid),
    ]);
    setProfile(prof as Profile | null);
    setRoles(((rs ?? []) as { role: AppRole }[]).map((r) => r.role));
    setDataLoaded(true);
  };

  const [dataLoaded, setDataLoaded] = useState(false);

  useEffect(() => {
    let currentUid: string | null = null;
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setUser(s?.user ?? null);
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
      } else {
        currentUid = null;
        setProfile(null);
        setRoles([]);
        setDataLoaded(true);
      }
    });
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session?.user) {
        currentUid = data.session.user.id;
        await loadUserData(data.session.user.id);
      } else {
        setDataLoaded(true);
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

