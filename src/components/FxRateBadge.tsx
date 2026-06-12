import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { fmtRate } from "@/lib/currency";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { refreshFxManual } from "@/lib/fx-refresh.functions";
import { useAuth, type AppRole } from "@/lib/auth";

type Rate = { rate: number; rate_date: string; source: string | null; created_at: string };
const ALLOWED_REFRESH_ROLES: AppRole[] = ["super_admin", "admin", "import_manager", "logistics"];

async function fetchLatestRate(): Promise<Rate | null> {
  const { data } = await supabase
    .from("exchange_rates")
    .select("rate,rate_date,source,created_at")
    .eq("base_currency", "EUR")
    .eq("target_currency", "USD")
    .order("rate_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { ...data, rate: Number(data.rate) } as Rate;
}

function daysBetween(iso: string): number {
  const d = new Date(iso + "T00:00:00Z").getTime();
  const now = Date.now();
  return Math.floor((now - d) / 86_400_000);
}

export function FxRateBadge() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { data: rate } = useQuery({
    queryKey: ["fx-eur-usd-latest"],
    queryFn: fetchLatestRate,
    staleTime: 1000 * 60 * 30,
    refetchInterval: 1000 * 60 * 60, // hourly client-side refresh
    refetchOnWindowFocus: true,
  });

  const ageDays = rate ? daysBetween(rate.rate_date) : null;
  const isStale = ageDays !== null && ageDays > 3;
  const sourceLabel = rate?.source === "frankfurter"
    ? "ECB / Frankfurter"
    : rate?.source === "manual"
      ? "Ручне значення"
      : rate?.source ?? "—";

  const refreshNow = async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/public/hooks/refresh-fx", { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await qc.invalidateQueries({ queryKey: ["fx-eur-usd-latest"] });
      toast.success("Курс EUR/USD оновлено");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не вдалося оновити курс");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Курс EUR/USD"
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums transition",
            isStale
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-border bg-secondary/60 text-foreground hover:bg-secondary",
          )}
        >
          {isStale && <AlertTriangle className="h-3 w-3" />}
          <span>€/$</span>
          <span>{rate ? fmtRate(rate.rate) : "—"}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2 text-sm">
        <div className="flex items-baseline justify-between">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">EUR/USD (активний курс)</div>
          <div className="text-lg font-bold tabular-nums">{rate ? fmtRate(rate.rate) : "—"}</div>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <div>Джерело: <span className="font-medium text-foreground">{sourceLabel}</span></div>
          <div>Дата курсу: <span className="font-medium text-foreground">{rate?.rate_date ?? "—"}</span></div>
          {rate?.created_at && (
            <div>Завантажено: <span className="font-medium text-foreground">{new Date(rate.created_at).toLocaleString("uk-UA")}</span></div>
          )}
          <div>Оновлюється автоматично кожен робочий день після публікації ECB.</div>
        </div>
        {isStale && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              Курс не оновлювався {ageDays} {ageDays === 1 ? "день" : "днів"}. Можлива проблема з джерелом — використовується останнє кешоване значення.
            </div>
          </div>
        )}
        <div className="text-[11px] text-muted-foreground">
          Цей курс застосовується для митниці, транспорту, індикативної та інвойсної собівартості й аналітики.
          Для конкретної поставки можна задати ручний курс на вкладці «Логістика».
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="w-full"
          onClick={refreshNow}
          disabled={refreshing}
        >
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", refreshing && "animate-spin")} />
          Оновити зараз
        </Button>
      </PopoverContent>
    </Popover>
  );
}
