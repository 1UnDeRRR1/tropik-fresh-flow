import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, AlertTriangle, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { SuperAdminTabs } from "./-super-admin-tabs";

export const Route = createFileRoute("/_authenticated/super-admin/logs")({
  component: SystemLogsPage,
});

type Level = "info" | "warning" | "critical" | "all";

interface LogRow {
  id: string;
  created_at: string;
  level: "info" | "warning" | "critical";
  message: string;
  module: string | null;
  action: string | null;
  user_id: string | null;
  user_role: string | null;
  shipment_id: string | null;
  offer_id: string | null;
  branch_id: string | null;
  vehicle_id: string | null;
  distribution_id: string | null;
  context: Record<string, unknown> | null;
}

function SystemLogsPage() {
  const qc = useQueryClient();
  const [level, setLevel] = useState<Level>("all");
  const { hasRole, loading } = useAuth();

  if (loading) return null;
  if (!hasRole("super_admin")) return <Navigate to="/" />;

  const { data, isLoading } = useQuery({
    queryKey: ["sa", "logs", level],
    queryFn: async () => {
      let q = supabase
        .from("system_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(300);
      if (level !== "all") q = q.eq("level", level);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as LogRow[];
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ["sa", "logs-profiles"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id,full_name");
      return new Map((data ?? []).map((p) => [p.id, p.full_name ?? ""]));
    },
  });

  const Icon = ({ lv }: { lv: LogRow["level"] }) =>
    lv === "critical" ? <AlertCircle className="h-4 w-4 text-destructive" /> :
    lv === "warning" ? <AlertTriangle className="h-4 w-4 text-warning" /> :
    <Info className="h-4 w-4 text-muted-foreground" />;

  const badge = (lv: LogRow["level"]) =>
    cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
      lv === "critical" ? "bg-destructive/15 text-destructive" :
      lv === "warning" ? "bg-warning/15 text-warning" :
      "bg-muted text-muted-foreground");

  return (
    <div className="space-y-4">
      <SuperAdminTabs />
      <PageHeader
        title="Системні логи"
        subtitle="Помилки, попередження та збої — лише для Супер-адміна"
        action={
          <div className="flex items-center gap-2">
            <Select value={level} onValueChange={(v) => setLevel(v as Level)}>
              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Всі рівні</SelectItem>
                <SelectItem value="critical">Критичні</SelectItem>
                <SelectItem value="warning">Попередження</SelectItem>
                <SelectItem value="info">Інформація</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["sa", "logs"] })}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <SectionCard title={`Записів: ${data?.length ?? 0}`}>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Завантаження…
          </div>
        ) : !data?.length ? (
          <EmptyState title="Логів немає" hint="Помилки, які виникатимуть, з'являтимуться тут" />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((l) => {
              const ents: Array<[string, string | null]> = [
                ["shipment", l.shipment_id],
                ["offer", l.offer_id],
                ["branch", l.branch_id],
                ["vehicle", l.vehicle_id],
                ["distribution", l.distribution_id],
              ];
              return (
                <li key={l.id} className="space-y-1 py-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon lv={l.level} />
                      <span className={badge(l.level)}>{l.level}</span>
                      {l.module && <span className="text-xs text-muted-foreground">{l.module}</span>}
                      {l.action && <span className="text-xs text-muted-foreground">· {l.action}</span>}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(l.created_at).toLocaleString("uk-UA")}
                    </span>
                  </div>
                  <div className="break-words text-sm font-medium">{l.message}</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {l.user_id && (
                      <span>
                        Користувач: {profiles?.get(l.user_id) || l.user_id.slice(0, 8)}
                        {l.user_role && ` (${l.user_role})`}
                      </span>
                    )}
                    {ents.filter(([, v]) => !!v).map(([k, v]) => (
                      <span key={k}>{k}: {v!.slice(0, 8)}</span>
                    ))}
                  </div>
                  {l.context && Object.keys(l.context).length > 0 && (
                    <details className="text-[11px]">
                      <summary className="cursor-pointer text-muted-foreground">Деталі</summary>
                      <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/50 p-2 text-[10px]">
                        {JSON.stringify(l.context, null, 2)}
                      </pre>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
