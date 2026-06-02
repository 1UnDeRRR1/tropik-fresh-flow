import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { StatusChip } from "@/components/StatusChip";
import { cn } from "@/lib/utils";
import { toUaCountry } from "@/lib/countries";
import { useAuth } from "@/lib/auth";


export const Route = createFileRoute("/_authenticated/archive")({
  component: ArchivePage,
});

type Tab = "unloaded" | "cancelled";

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("uk-UA", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString("uk-UA", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

function ArchivePage() {
  const [tab, setTab] = useState<Tab>("unloaded");
  const { profile, primaryRole } = useAuth();
  const isBranch = primaryRole === "branch";
  const branchId = profile?.branch_id ?? null;

  const { data: unloaded = [] } = useQuery({
    queryKey: ["archive-unloaded", isBranch ? `branch:${branchId ?? ""}` : "staff"],
    enabled: isBranch ? !!branchId : true,
    queryFn: async () => {
      if (isBranch) {
        // Branch-safe path: restrict to shipments where this branch has a
        // distribution, then read only non-sensitive fields from the
        // branch-safe view (no suppliers / costs / internal notes).
        const { data: dists, error: distErr } = await supabase
          .from("distributions")
          .select("shipment_id")
          .eq("branch_id", branchId!);
        if (distErr) throw distErr;
        const ids = Array.from(
          new Set((dists ?? []).map((d) => d.shipment_id).filter(Boolean) as string[]),
        );
        if (!ids.length) return [];
        const { data, error } = await (supabase as any)
          .from("shipments_branch")
          .select("id,code,country,eta,status,unloaded_at,archived_at")
          .in("id", ids)
          .not("unloaded_at", "is", null)
          .is("archived_at", null)
          .neq("status", "cancelled")
          .order("unloaded_at", { ascending: false });
        if (error) throw error;
        return (data ?? []) as Array<{
          id: string; code: string; country: string | null;
          eta: string | null; status: string;
          unloaded_at: string | null; archived_at: string | null;
          archive_due_at?: null;
        }>;
      }
      const { data, error } = await supabase
        .from("shipments")
        .select("id,code,country,eta,status,unloaded_at,archive_due_at")
        .not("unloaded_at", "is", null)
        .is("archived_at", null)
        .neq("status", "cancelled")
        .order("unloaded_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });


  const { data: cancelled = [] } = useQuery({
    queryKey: ["archive-cancelled"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("cancelled_shipments_archive")
        .select("id,shipment_id,shipment_code,cancelled_at,cancelled_by_name,snapshot,archived_at")
        .order("cancelled_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; shipment_id: string; shipment_code: string;
        cancelled_at: string; cancelled_by_name: string | null;
        snapshot: any; archived_at: string;
      }>;
    },
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Архів" subtitle="Read-only" />

      <div className="flex gap-2">
        {(["unloaded", "cancelled"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full border px-4 py-1.5 text-xs font-semibold transition",
              tab === t
                ? "border-brand bg-brand text-brand-foreground"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {t === "unloaded" ? `Розвантажено (${unloaded.length})` : `Скасовано (${cancelled.length})`}
          </button>
        ))}
      </div>

      {tab === "unloaded" && (
        <SectionCard title="Розвантажені (зберігаються 7 днів)">
          {!unloaded.length ? (
            <EmptyState title="Поки немає розвантажених поставок" />
          ) : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-xs">
                <thead className="[&_th]:bg-table-head [&_th]:font-bold">
                  <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-2 py-2 font-medium">Поставка</th>
                    <th className="px-2 py-2 font-medium">Країна</th>
                    <th className="px-2 py-2 font-medium">ETA</th>
                    <th className="px-2 py-2 font-medium">Розвантажено</th>
                    {!isBranch && <th className="px-2 py-2 font-medium">В архів</th>}
                    <th className="px-2 py-2 font-medium">Статус</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {unloaded.map((s) => (
                    <tr key={s.id} className="hover:bg-muted/40">
                      <td className="px-2 py-2 font-mono text-[11px] font-semibold">
                        {s.code}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">{toUaCountry(s.country) ?? "—"}</td>
                      <td className="px-2 py-2 text-muted-foreground">{fmtDate(s.eta)}</td>
                      <td className="px-2 py-2 text-muted-foreground">{fmtDateTime(s.unloaded_at)}</td>
                      {!isBranch && (
                        <td className="px-2 py-2 text-muted-foreground">{fmtDate((s as any).archive_due_at ?? null)}</td>
                      )}

                      <td className="px-2 py-2"><StatusChip status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {tab === "cancelled" && (
        <SectionCard title="Скасовані поставки">
          {!cancelled.length ? (
            <EmptyState title="Скасованих поставок немає" />
          ) : (
            <ul className="divide-y divide-border">
              {cancelled.map((c) => {
                const sh = c.snapshot?.shipment ?? {};
                return (
                  <li key={c.id} className="space-y-1 px-1 py-3 text-sm">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono font-semibold">{c.shipment_code}</span>
                      <span className="text-muted-foreground">·</span>
                      <span className="text-muted-foreground">
                        {toUaCountry(sh.country) ?? "—"}
                      </span>
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        Скасовано: {fmtDateTime(c.cancelled_at)}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Хто скасував: {c.cancelled_by_name ?? "—"} ·
                      ETA на момент: {fmtDate(sh.eta ?? null)} ·
                      Статус: {sh.status ?? "—"}
                    </div>
                    {Array.isArray(c.snapshot?.items) && c.snapshot.items.length > 0 && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Товарів у снапшоті: {c.snapshot.items.length}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      )}
    </div>
  );
}
