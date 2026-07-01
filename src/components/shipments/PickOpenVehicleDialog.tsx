// Build 2D — pick an existing open vehicle to "top up" (create child shipment).
//
// Pure UI + read-only queries. Zero DB writes. The dialog only returns the
// chosen vehicle id+code to the parent; the parent then runs the child
// orchestrator branch.
//
// Filtering rules (per Build 2D plan §1):
//   * vehicles.status = 'open'
//   * vehicles.country === draftCountry (canonical UA name)
//   * 26 - used_pallets >= draftPallets
//   * 21500 - used_gross_kg >= draftGross
//
// Capacity is aggregated from shipment_items (gross-first with fallbacks)
// — mirrors aggregateVehicleFromItems in /shipments/index.tsx.

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchActiveReservesByVehicle,
  type ActiveReserve,
} from "@/lib/vehicle-reserves";

const CAP_PALLETS = 26;
const CAP_GROSS_KG = 21500;

export type PickableVehicle = {
  id: string;
  code: string;
  country: string;
  loading_date: string | null;
  eta: string | null;
};

type Row = {
  id: string;
  code: string;
  country: string;
  loading_date: string | null;
  eta: string | null;
  shipments: {
    suppliers: { name: string | null } | null;
    shipment_items: {
      pallet_count: number | null;
      pallet_weight: number | null;
      net_weight_kg: number | null;
      gross_weight_kg: number | null;
    }[] | null;
  }[] | null;
};

function aggregate(v: Row): { pallets: number; gross: number; suppliers: string[] } {
  let pallets = 0;
  let gross = 0;
  const sup = new Set<string>();
  for (const s of v.shipments ?? []) {
    if (s.suppliers?.name) sup.add(s.suppliers.name);
    for (const it of s.shipment_items ?? []) {
      const pc = Number(it.pallet_count ?? 0);
      pallets += pc;
      const g = Number(it.gross_weight_kg ?? 0);
      if (g > 0) gross += g;
      else {
        const net = Number(it.net_weight_kg ?? 0);
        const pw = Number(it.pallet_weight ?? 0);
        gross += net > 0 ? net : pc * pw;
      }
    }
  }
  return { pallets, gross, suppliers: Array.from(sup) };
}

export function PickOpenVehicleDialog({
  open,
  country,
  draftPallets,
  draftGrossKg,
  onClose,
  onPick,
}: {
  open: boolean;
  country: string;
  draftPallets: number;
  draftGrossKg: number;
  onClose: () => void;
  onPick: (vehicle: PickableVehicle) => void;
}) {
  const q = useQuery({
    queryKey: ["pick-open-vehicles", country],
    enabled: open && !!country,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicles" as never)
        .select(
          "id,code,country,loading_date,eta,shipments(suppliers(name),shipment_items(pallet_count,pallet_weight,net_weight_kg,gross_weight_kg))",
        )
        .eq("status", "open")
        .eq("country", country)
        .order("eta", { ascending: true });
      if (error) return [] as Row[];
      return (data ?? []) as unknown as Row[];
    },
  });

  const rows = (q.data ?? []).map((v) => {
    const agg = aggregate(v);
    const freePal = Math.max(0, CAP_PALLETS - agg.pallets);
    const freeGross = Math.max(0, CAP_GROSS_KG - agg.gross);
    const fits = freePal >= draftPallets && freeGross >= draftGrossKg;
    return { v, agg, freePal, freeGross, fits };
  });
  const matched = rows.filter((r) => r.fits);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-md gap-3 p-4 sm:p-5">
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-base">Оберіть авто для довантаження</DialogTitle>
          <DialogDescription className="text-[12px]">
            Країна: <span className="font-semibold text-foreground">{country || "—"}</span>.
            Потрібно: {draftPallets} пал · {Math.round(draftGrossKg)} кг.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto">
          {!country ? (
            <p className="py-6 text-center text-[12px] text-muted-foreground">
              Спочатку оберіть країну в формі.
            </p>
          ) : q.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Завантаження…
            </div>
          ) : matched.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-muted-foreground">
              Немає відкритих авто з достатнім вільним місцем у країні {country}.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {matched.map(({ v, agg, freePal, freeGross }) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() =>
                      onPick({
                        id: v.id,
                        code: v.code,
                        country: v.country,
                        loading_date: v.loading_date,
                        eta: v.eta,
                      })
                    }
                    className="group block w-full rounded-lg border border-border bg-card px-3 py-2 text-left transition hover:border-brand/60 hover:bg-brand/5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-bold text-brand">{v.code}</span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        ETD {v.loading_date ?? "—"} · ETA {v.eta ?? "—"}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] tabular-nums text-muted-foreground">
                      <span>
                        {agg.pallets}/26 пал · {Math.round(agg.gross)}/21500 кг
                      </span>
                      <span className="text-foreground">
                        вільно: {freePal} пал · {Math.round(freeGross)} кг
                      </span>
                    </div>
                    {agg.suppliers.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {agg.suppliers.map((s, i) => (
                          <span
                            key={i}
                            className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" className="h-9 w-full sm:w-auto" onClick={onClose}>
            Скасувати
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
