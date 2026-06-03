import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Circle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { SuperAdminTabs } from "./-super-admin-tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/super-admin/activity")({
  component: ActivityPage,
});

type Session = {
  id: string;
  user_id: string;
  started_at: string;
  last_seen_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  user_agent: string | null;
  platform: string | null;
  app_version: string | null;
  last_path: string | null;
  heartbeat_count: number;
};

type Profile = { id: string; full_name: string | null; display_name: string | null };
type RoleRow = { user_id: string; role: string };

type Period = "today" | "7d" | "30d";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", { hour12: false });
}
function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}с`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} хв`;
  const h = Math.floor(m / 60);
  return `${h} год ${m % 60} хв`;
}
function fmtSince(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 30) return "щойно";
  if (diff < 60) return `${Math.floor(diff)} с тому`;
  if (diff < 3600) return `${Math.floor(diff / 60)} хв тому`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} год тому`;
  return `${Math.floor(diff / 86400)} д тому`;
}
function shortUA(ua: string | null): string {
  if (!ua) return "—";
  const m =
    /Edg\/[\d.]+/.exec(ua) ||
    /Chrome\/[\d.]+/.exec(ua) ||
    /Firefox\/[\d.]+/.exec(ua) ||
    /Safari\/[\d.]+/.exec(ua);
  const os =
    /Windows/.exec(ua) ? "Windows" :
    /Mac OS|Macintosh/.exec(ua) ? "macOS" :
    /Android/.exec(ua) ? "Android" :
    /iPhone|iPad|iOS/.exec(ua) ? "iOS" :
    /Linux/.exec(ua) ? "Linux" : "";
  return [os, m?.[0]].filter(Boolean).join(" · ") || ua.slice(0, 30);
}
function statusOf(s: Session): "online" | "inactive" | "offline" {
  const lastSeen = new Date(s.last_seen_at).getTime();
  const ageMin = (Date.now() - lastSeen) / 60_000;
  if (!s.ended_at && ageMin <= 2) return "online";
  if (!s.ended_at && ageMin <= 5) return "inactive";
  return "offline";
}

function periodSinceIso(p: Period): string {
  const d = new Date();
  if (p === "today") {
    d.setHours(0, 0, 0, 0);
  } else if (p === "7d") {
    d.setDate(d.getDate() - 7);
  } else {
    d.setDate(d.getDate() - 30);
  }
  return d.toISOString();
}

function ActivityPage() {
  const { hasRole, loading } = useAuth();
  const qc = useQueryClient();
  const [period, setPeriod] = useState<Period>("today");
  const [userFilter, setUserFilter] = useState<string>("all");
  const [recalcBusy, setRecalcBusy] = useState(false);

  // Auth gate (defence in depth; layout already restricts to super_admin)
  if (loading) return null;
  if (!hasRole("super_admin")) return <Navigate to="/" />;

  const sinceIso = periodSinceIso(period);

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["sa", "activity", period, userFilter],
    queryFn: async () => {
      let q = supabase
        .from("user_activity_sessions")
        .select(
          "id,user_id,started_at,last_seen_at,ended_at,duration_seconds,user_agent,platform,app_version,last_path,heartbeat_count",
        )
        .gte("started_at", sinceIso)
        .order("started_at", { ascending: false })
        .limit(500);
      if (userFilter !== "all") q = q.eq("user_id", userFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Session[];
    },
    refetchInterval: 30_000,
  });

  // "Online now": independent query (no date filter)
  const { data: openSessions } = useQuery({
    queryKey: ["sa", "activity", "open"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_activity_sessions")
        .select(
          "id,user_id,started_at,last_seen_at,ended_at,duration_seconds,user_agent,platform,app_version,last_path,heartbeat_count",
        )
        .is("ended_at", null)
        .order("last_seen_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Session[];
    },
    refetchInterval: 20_000,
  });

  const { data: profiles } = useQuery({
    queryKey: ["sa", "activity-profiles"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id,full_name,display_name");
      return new Map(((data ?? []) as Profile[]).map((p) => [p.id, p]));
    },
  });

  const { data: rolesByUser } = useQuery({
    queryKey: ["sa", "activity-roles"],
    queryFn: async () => {
      const { data } = await supabase.from("user_roles").select("user_id,role");
      const map = new Map<string, string[]>();
      ((data ?? []) as RoleRow[]).forEach((r) => {
        const arr = map.get(r.user_id) ?? [];
        arr.push(r.role);
        map.set(r.user_id, arr);
      });
      return map;
    },
  });

  const nameOf = (uid: string): string => {
    const p = profiles?.get(uid);
    return p?.display_name || p?.full_name || uid.slice(0, 8);
  };
  const roleOf = (uid: string): string => {
    const arr = rolesByUser?.get(uid) ?? [];
    return arr.length ? arr.join(", ") : "—";
  };

  // Daily summary
  const dailySummary = useMemo(() => {
    if (!sessions) return [];
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const filtered = sessions.filter((s) => new Date(s.started_at) >= todayStart);
    const byUser = new Map<string, { count: number; total: number; first: string; last: string }>();
    for (const s of filtered) {
      const cur = byUser.get(s.user_id);
      const dur = s.duration_seconds ?? 0;
      if (!cur) {
        byUser.set(s.user_id, {
          count: 1, total: dur, first: s.started_at, last: s.last_seen_at,
        });
      } else {
        cur.count += 1;
        cur.total += dur;
        if (s.started_at < cur.first) cur.first = s.started_at;
        if (s.last_seen_at > cur.last) cur.last = s.last_seen_at;
      }
    }
    return Array.from(byUser.entries())
      .map(([uid, v]) => ({ uid, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [sessions]);

  // Online now: one row per user_id (freshest by last_seen_at), non-offline.
  const onlineRows = useMemo(() => {
    if (!openSessions) return [];
    const byUser = new Map<string, Session>();
    for (const s of openSessions) {
      if (statusOf(s) === "offline") continue;
      const cur = byUser.get(s.user_id);
      if (!cur || s.last_seen_at > cur.last_seen_at) byUser.set(s.user_id, s);
    }
    return Array.from(byUser.values()).sort((a, b) =>
      a.last_seen_at < b.last_seen_at ? 1 : -1,
    );
  }, [openSessions]);

  // History: hide technical micro-sessions (closed, <=5s duration) — they are
  // reload/remount/StrictMode artifacts, not real user sessions. Active sessions
  // (ended_at IS NULL) are always kept regardless of current duration.
  // Also dedup any leftover 0s rows that share (user_id, started_at, last_seen_at).
  const MICRO_SESSION_MAX_SEC = 5;
  const dedupedSessions = useMemo(() => {
    if (!sessions) return [];
    const seen = new Set<string>();
    const out: Session[] = [];
    for (const s of sessions) {
      const dur = s.duration_seconds ?? 0;
      const isClosed = s.ended_at !== null;
      if (isClosed && dur <= MICRO_SESSION_MAX_SEC) continue;
      if (dur === 0) {
        const key = `${s.user_id}|${s.started_at}|${s.last_seen_at}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }
      out.push(s);
    }
    return out;
  }, [sessions]);

  // User filter options
  const userOptions = useMemo(() => {
    const set = new Set<string>();
    sessions?.forEach((s) => set.add(s.user_id));
    openSessions?.forEach((s) => set.add(s.user_id));
    return Array.from(set).map((uid) => ({ uid, name: nameOf(uid) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, openSessions, profiles]);

  const recalc = async () => {
    setRecalcBusy(true);
    try {
      await supabase.rpc("rpc_activity_close_stale");
      await qc.invalidateQueries({ queryKey: ["sa", "activity"] });
    } finally {
      setRecalcBusy(false);
    }
  };

  const StatusDot = ({ s }: { s: Session }) => {
    const st = statusOf(s);
    const color =
      st === "online" ? "fill-emerald-500 text-emerald-500" :
      st === "inactive" ? "fill-amber-500 text-amber-500" :
      "fill-muted-foreground text-muted-foreground";
    const label = st === "online" ? "Онлайн" : st === "inactive" ? "Неактивний" : "Офлайн";
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <Circle className={cn("h-2.5 w-2.5", color)} />
        {label}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <SuperAdminTabs />
      <PageHeader
        title="Журнал активності"
        subtitle="Сесії користувачів — лише для Супер-адміна"
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={recalc} disabled={recalcBusy}>
              {recalcBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Перерахувати"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => qc.invalidateQueries({ queryKey: ["sa", "activity"] })}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {/* A. Online now */}
      <SectionCard title={`Зараз онлайн · ${onlineRows.length}`}>
        {!onlineRows.length ? (
          <EmptyState title="Нікого онлайн" hint="Сесії з'являться, коли користувачі увійдуть" />
        ) : (
          <ul className="divide-y divide-border">
            {onlineRows.map((s) => (
              <li key={s.user_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{nameOf(s.user_id)}</span>
                    <span className="text-xs text-muted-foreground">{roleOf(s.user_id)}</span>
                    <StatusDot s={s} />
                  </div>
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {s.last_path || "/"} · {shortUA(s.user_agent)}
                  </div>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {fmtSince(s.last_seen_at)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {/* C. Daily summary */}
      <SectionCard title="Зведення за сьогодні">
        {!dailySummary.length ? (
          <EmptyState title="За сьогодні даних немає" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Користувач</th>
                  <th className="py-2 pr-3">Роль</th>
                  <th className="py-2 pr-3">Сесій</th>
                  <th className="py-2 pr-3">Сумарно</th>
                  <th className="py-2 pr-3">Перша</th>
                  <th className="py-2 pr-3">Остання</th>
                </tr>
              </thead>
              <tbody>
                {dailySummary.map((r) => (
                  <tr key={r.uid} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{nameOf(r.uid)}</td>
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">{roleOf(r.uid)}</td>
                    <td className="py-1.5 pr-3">{r.count}</td>
                    <td className="py-1.5 pr-3">{fmtDuration(r.total)}</td>
                    <td className="py-1.5 pr-3 text-xs">{fmtDateTime(r.first)}</td>
                    <td className="py-1.5 pr-3 text-xs">{fmtDateTime(r.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* B. Sessions history */}
      <SectionCard
        title={`Історія сесій · ${dedupedSessions.length}`}
        action={
          <div className="flex items-center gap-2">
            <Select value={userFilter} onValueChange={setUserFilter}>
              <SelectTrigger className="h-8 w-44"><SelectValue placeholder="Користувач" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Всі користувачі</SelectItem>
                {userOptions.map((u) => (
                  <SelectItem key={u.uid} value={u.uid}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Сьогодні</SelectItem>
                <SelectItem value="7d">7 днів</SelectItem>
                <SelectItem value="30d">30 днів</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      >
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Завантаження…
          </div>
        ) : !dedupedSessions.length ? (
          <EmptyState title="Сесій за обраний період немає" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3">Користувач</th>
                  <th className="py-2 pr-3">Роль</th>
                  <th className="py-2 pr-3">Початок</th>
                  <th className="py-2 pr-3">Остання активність</th>
                  <th className="py-2 pr-3">Тривалість</th>
                  <th className="py-2 pr-3">Пристрій</th>
                  <th className="py-2 pr-3">Версія</th>
                </tr>
              </thead>
              <tbody>
                {dedupedSessions.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-3 font-medium">{nameOf(s.user_id)}</td>
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">{roleOf(s.user_id)}</td>
                    <td className="py-1.5 pr-3 text-xs">{fmtDateTime(s.started_at)}</td>
                    <td className="py-1.5 pr-3 text-xs">{fmtDateTime(s.last_seen_at)}</td>
                    <td className="py-1.5 pr-3">{fmtDuration(s.duration_seconds ?? 0)}</td>
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">{shortUA(s.user_agent)}</td>
                    <td className="py-1.5 pr-3 text-xs text-muted-foreground">{s.app_version || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* D. Phase B placeholder */}
      <SectionCard title="Останні дії">
        <EmptyState
          title="Буде додано пізніше"
          hint="Phase B: створення поставок, пропозицій, підтверджень, розподілу, зміни цін."
        />
      </SectionCard>
    </div>
  );
}
