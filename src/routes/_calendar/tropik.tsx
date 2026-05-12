import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { SectionCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";
import { toUaCountry } from "@/lib/countries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_calendar/tropik")({
  component: TropikCalendarPage,
});

interface AggRow {
  product_name: string;
  total_pallets: number;
  shipment_count: number;
}

interface ShipRow {
  shipment_id: string;
  shipment_code: string;
  status: string;
  eta: string | null;
  pallets: number;
  caliber: string | null;
  origin_country: string | null;
  manager_name: string;
  final_cost_indicative: number | null;
  final_cost_invoice: number | null;
}

const fmtEta = (eta: string | null) =>
  eta
    ? new Date(eta).toLocaleDateString("uk-UA", {
        day: "2-digit",
        month: "short",
      })
    : "—";

function TropikCalendarPage() {
  const { primaryRole, hasRole } = useAuth();
  if (primaryRole !== "calendar_tropik" && !hasRole(["admin", "super_admin"])) {
    return <Navigate to="/" />;
  }

  const aggQuery = useQuery({
    queryKey: ["tropik-calendar-agg"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("tropik_calendar_aggregate");
      if (error) throw error;
      return (data ?? []) as AggRow[];
    },
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight md:text-3xl">
          Календар Tropik
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Активні поставки по всій компанії
        </p>
      </div>

      {aggQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Завантаження…</p>
      ) : !aggQuery.data?.length ? (
        <EmptyState title="Активних поставок немає" />
      ) : (
        <SectionCard title={`Товари (${aggQuery.data.length})`}>
          <div className="divide-y divide-border">
            {aggQuery.data.map((r) => (
              <ProductRow key={r.product_name} row={r} />
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function ProductRow({ row }: { row: AggRow }) {
  const [open, setOpen] = useState(false);
  const shipQuery = useQuery({
    enabled: open,
    queryKey: ["tropik-calendar-ships", row.product_name],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "tropik_calendar_shipments",
        { _product: row.product_name },
      );
      if (error) throw error;
      return (data ?? []) as ShipRow[];
    },
  });

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-3 px-2 py-3 text-left transition hover:bg-secondary/40",
          open && "bg-secondary/30",
        )}
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <div className="flex-1">
          <div className="text-sm font-semibold">{row.product_name}</div>
          <div className="text-[11px] text-muted-foreground">
            {row.shipment_count} поставок
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-bold tabular-nums">
            {Number(row.total_pallets).toFixed(0)} п
          </div>
        </div>
      </button>
      {open && (
        <div className="bg-muted/30 px-2 pb-3">
          {shipQuery.isLoading ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              Завантаження…
            </p>
          ) : !shipQuery.data?.length ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              Немає деталей
            </p>
          ) : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-1 font-medium">ETA</th>
                    <th className="px-2 py-1 font-medium">Поставка</th>
                    <th className="px-2 py-1 font-medium">Калібр</th>
                    <th className="px-2 py-1 font-medium">Країна</th>
                    <th className="px-2 py-1 text-right font-medium">Палет</th>
                    <th className="px-2 py-1 font-medium">Статус</th>
                    <th className="px-2 py-1 font-medium">Менеджер</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {shipQuery.data.map((s) => (
                    <tr key={s.shipment_id}>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {fmtEta(s.eta)}
                      </td>
                      <td className="px-2 py-1.5 font-semibold text-brand">
                        {s.shipment_code}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {s.caliber ?? "—"}
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {toUaCountry(s.origin_country ?? "") || "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-semibold">
                        {Number(s.pallets).toFixed(0)}
                      </td>
                      <td className="px-2 py-1.5">
                        <StatusChip status={s.status} />
                      </td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {s.manager_name}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
