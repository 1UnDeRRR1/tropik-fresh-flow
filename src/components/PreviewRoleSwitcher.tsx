import { useMemo, useState } from "react";
import { UserCog, X, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, ROLE_LABEL_UK, defaultRoutePerRole } from "@/lib/auth";
import { cn } from "@/lib/utils";

type PreviewAccount = {
  key: string;
  label: string;
  email: string;
  password: string;
  hint?: string;
};

const ACCOUNTS: PreviewAccount[] = [
  {
    key: "super_admin",
    label: "Супер-адмін",
    email: "tereshchenko.pavlo@lovable.local",
    password: "Super-Tereshchenko-2026!",
    hint: "Терещенко",
  },
  {
    key: "admin",
    label: "Адміністратор",
    email: "pilot.admin1@tropik.test",
    password: "PilotAdmin1!2026",
    hint: "Pilot Адмін 1",
  },
  {
    key: "manager",
    label: "Менеджер ЗЕД",
    email: "pilot.manager1@tropik.test",
    password: "PilotMgr1!2026",
    hint: "Pilot Менеджер 1",
  },
  {
    key: "branch_shu",
    label: "Філія · Шувар",
    email: "pilot.branch1@tropik.test",
    password: "PilotBranch1!2026",
  },
  {
    key: "branch_kyi",
    label: "Філія · Київ",
    email: "pilot.branch2@tropik.test",
    password: "PilotBranch2!2026",
  },
];

function isPreviewHost(): boolean {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return (
    h.includes("lovableproject.com") ||
    h.includes("lovable.app") ||
    h.includes("preview--") ||
    h.includes("sandbox.lovable") ||
    h === "localhost" ||
    h.startsWith("127.")
  );
}

export function PreviewRoleSwitcher() {
  const { user, primaryRole, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const show = useMemo(() => isPreviewHost(), []);

  if (!show) return null;

  const switchTo = async (acc: PreviewAccount) => {
    setBusy(acc.key);
    try {
      // Clear current session first to avoid stale role flicker
      await supabase.auth.signOut();
      const { error } = await supabase.auth.signInWithPassword({
        email: acc.email,
        password: acc.password,
      });
      if (error) {
        alert(`Не вдалося увійти як ${acc.label}: ${error.message}`);
        setBusy(null);
        return;
      }
      // Resolve role from key for the redirect target
      const roleKey = acc.key.startsWith("branch")
        ? "branch"
        : (acc.key as "super_admin" | "admin" | "manager");
      const target = defaultRoutePerRole(
        roleKey === "manager" ? "import_manager" : roleKey,
      );
      window.location.assign(target);
    } catch (e) {
      alert(`Помилка: ${(e as Error).message}`);
      setBusy(null);
    }
  };

  return (
    <div className="fixed right-3 top-3 z-[9999] md:right-4 md:top-4">
      {open ? (
        <div className="w-64 rounded-2xl border border-border bg-card/95 p-3 shadow-2xl backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Preview · ролі
              </span>
              {user && (
                <span className="text-[11px] text-foreground">
                  Зараз: {primaryRole ? ROLE_LABEL_UK[primaryRole] : "—"}
                  {profile?.full_name ? ` · ${profile.full_name}` : ""}
                </span>
              )}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Закрити"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {ACCOUNTS.map((a) => {
              const isBusy = busy === a.key;
              const isCurrent = user?.email === a.email;
              return (
                <button
                  key={a.key}
                  onClick={() => switchTo(a)}
                  disabled={!!busy || isCurrent}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs font-semibold transition",
                    isCurrent
                      ? "border-brand bg-brand/10 text-brand"
                      : "border-border bg-background hover:bg-secondary",
                    busy && !isBusy && "opacity-50",
                  )}
                >
                  <span className="flex flex-col">
                    <span>{a.label}</span>
                    {a.hint && (
                      <span className="text-[10px] font-normal text-muted-foreground">
                        {a.hint}
                      </span>
                    )}
                  </span>
                  {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {isCurrent && !isBusy && (
                    <span className="text-[10px] uppercase">активно</span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] leading-tight text-muted-foreground">
            Видно лише в preview. На опублікованому домені перемикач прихований.
          </p>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 rounded-full border-2 border-brand bg-brand px-4 py-2 text-xs font-bold text-brand-foreground shadow-2xl hover:bg-brand/90"
        >
          <UserCog className="h-4 w-4" />
          <span>Ролі (preview)</span>
        </button>
      )}
    </div>
  );
}
