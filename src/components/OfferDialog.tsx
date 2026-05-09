import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

type Item = {
  shipment_item_id: string;
  distribution_id: string;
  product_name: string;
  caliber?: string | null;
  available_pallets: number;
  shipment_code: string;
};

export function OfferDialog({
  item,
  open,
  onClose,
}: {
  item: Item | null;
  open: boolean;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  // map of branch_id -> pallets to offer
  const [allocations, setAllocations] = useState<Record<string, number>>({});

  useEffect(() => {
    if (open) setAllocations({});
  }, [open, item?.shipment_item_id]);

  const { data: branches } = useQuery({
    queryKey: ["branches-for-offer", profile?.branch_id],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("branches")
        .select("id,name")
        .eq("is_active", true)
        .neq("id", profile?.branch_id ?? "")
        .order("name");
      return data ?? [];
    },
  });

  const max = item?.available_pallets ?? 0;
  const allocated = useMemo(
    () => Object.values(allocations).reduce((s, n) => s + (n || 0), 0),
    [allocations],
  );
  const remaining = Math.max(0, max - allocated);

  const setQty = (branchId: string, qty: number) => {
    setAllocations((prev) => {
      const others = Object.entries(prev)
        .filter(([id]) => id !== branchId)
        .reduce((s, [, n]) => s + (n || 0), 0);
      const cap = Math.max(0, max - others);
      const v = Math.max(0, Math.min(cap, qty));
      const next = { ...prev };
      if (v <= 0) delete next[branchId];
      else next[branchId] = v;
      return next;
    });
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (!item || !profile?.branch_id) throw new Error("missing");
      const entries = Object.entries(allocations).filter(([, n]) => n > 0);
      if (!entries.length) throw new Error("Виберіть кількість палет");
      const rows = entries.map(([branchId, pallets]) => ({
        shipment_item_id: item.shipment_item_id,
        distribution_id: item.distribution_id,
        from_branch_id: profile.branch_id,
        to_branch_id: branchId,
        offered_pallets: pallets,
        created_by: profile.id,
      }));
      const { error } = await (supabase as any)
        .from("branch_transfer_offers")
        .insert(rows);
      if (error) throw error;
      return entries.length;
    },
    onSuccess: (n) => {
      toast.success(`Відправлено пропозицій: ${n}`);
      qc.invalidateQueries({ queryKey: ["offers"] });
      qc.invalidateQueries({ queryKey: ["branch-incoming"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Не вдалося"),
  });

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle>Запропонувати філії</SheetTitle>
        </SheetHeader>

        {item && (
          <div className="mt-3 space-y-3">
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <div className="text-sm font-semibold">{item.product_name}</div>
              <div className="text-xs text-muted-foreground">
                {item.shipment_code} · всього {max}п
              </div>
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Розподілено</span>
                <span className="font-bold tabular-nums">
                  {allocated}п / {max}п · вільно {remaining}п
                </span>
              </div>
            </div>

            <ul className="space-y-2">
              {(branches ?? []).map((b) => {
                const v = allocations[b.id] ?? 0;
                const others = allocated - v;
                const cap = Math.max(0, max - others);
                return (
                  <li
                    key={b.id}
                    className={`rounded-xl border p-3 transition ${
                      v > 0 ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1 text-sm font-medium">{b.name}</div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          disabled={v <= 0}
                          onClick={() => setQty(b.id, v - 1)}
                        >
                          −
                        </Button>
                        <Input
                          type="number"
                          min={0}
                          max={cap}
                          value={v}
                          onChange={(e) => setQty(b.id, Number(e.target.value) || 0)}
                          className="h-8 w-14 text-center"
                        />
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          disabled={v >= cap}
                          onClick={() => setQty(b.id, v + 1)}
                        >
                          +
                        </Button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="sticky bottom-0 -mx-6 border-t border-border bg-background px-6 pb-2 pt-3">
              <Button
                className="w-full"
                disabled={allocated <= 0 || submit.isPending}
                onClick={() => submit.mutate()}
              >
                Запропонувати ({allocated}п)
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
