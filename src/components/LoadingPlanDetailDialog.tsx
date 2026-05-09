import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Link } from "@tanstack/react-router";
import { matchesLoadingPlanRow, type LoadingPlanMatchRow } from "@/lib/loading-plan";

export interface PlanDetailItem extends LoadingPlanMatchRow {
  id: string;
  caliber?: string | null;
  planned_pallets: number;
}

interface Props {
  plan: PlanDetailItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LoadedRow {
  shipment_id: string;
  product_name: string;
  origin_country: string | null;
  pallet_count: number | null;
  created_at: string | null;
  shipments: {
    code: string | null;
    country: string | null;
    created_at: string | null;
    eta: string | null;
    suppliers: { name: string | null } | null;
    vehicles: { code: string | null; eta: string | null } | null;
  } | null;
}

function formatEta(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}`;
}

export function LoadingPlanDetailDialog({ plan, open, onOpenChange }: Props) {
  const { data: items, isLoading } = useQuery({
    enabled: open && !!plan,
    queryKey: ["loading-plan-detail", plan?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("shipment_items")
        .select(
          "shipment_id,product_name,origin_country,pallet_count,created_at,shipments(code,country,created_at,eta,suppliers(name),vehicles(code,eta))",
        );
      return (data ?? []) as LoadedRow[];
    },
  });

  const matches = plan && items ? items.filter((i) => matchesLoadingPlanRow(plan, i)) : [];
  const totalLoaded = matches.reduce((s, i) => s + Number(i.pallet_count ?? 0), 0);
  const remaining = plan ? Number(plan.planned_pallets) - totalLoaded : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {plan?.product_name}
            {plan?.caliber ? ` ${plan.caliber}` : ""}
            {plan?.country ? ` · ${plan.country}` : ""}
          </DialogTitle>
          <DialogDescription>
            План {plan?.planned_pallets ?? 0}п · завантажено {totalLoaded}п · залишок{" "}
            {Math.max(0, remaining)}п
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Завантаження…</div>
        ) : matches.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Поки немає завантажень за цією позицією
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {matches.map((m, idx) => {
              const vehicleCode = m.shipments?.vehicles?.code ?? "";
              const code = m.shipments?.code ?? "—";
              const supplier = m.shipments?.suppliers?.name ?? "—";
              const country = m.origin_country ?? m.shipments?.country ?? "";
              return (
                <li key={`${m.shipment_id}-${idx}`} className="py-2.5">
                  <Link
                    to="/shipments/$id"
                    params={{ id: m.shipment_id }}
                    onClick={() => onOpenChange(false)}
                    className="flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-semibold">
                        {vehicleCode ? `${vehicleCode} · ` : ""}
                        {code}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {supplier}
                        {country ? ` · ${country}` : ""}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-xs font-bold text-brand">
                      {Number(m.pallet_count ?? 0)}п
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-2 flex items-center justify-between border-t border-border pt-3 text-sm font-semibold">
          <span>Всього завантажено</span>
          <span>{totalLoaded}п</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Залишок плану</span>
          <span className={remaining <= 0 ? "text-emerald-600 font-bold" : "text-brand font-bold"}>
            {Math.max(0, remaining)}п
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
