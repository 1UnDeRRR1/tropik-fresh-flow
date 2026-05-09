import { useState, useMemo } from "react";
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
  const [step, setStep] = useState<"qty" | "branch">("qty");
  const [pallets, setPallets] = useState(1);
  const [targetBranch, setTargetBranch] = useState<string | null>(null);

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

  const reset = () => {
    setStep("qty");
    setPallets(1);
    setTargetBranch(null);
  };

  const submit = useMutation({
    mutationFn: async () => {
      if (!item || !targetBranch || !profile?.branch_id) throw new Error("missing");
      const { error } = await (supabase as any).from("branch_transfer_offers").insert({
        shipment_item_id: item.shipment_item_id,
        distribution_id: item.distribution_id,
        from_branch_id: profile.branch_id,
        to_branch_id: targetBranch,
        offered_pallets: pallets,
        created_by: profile.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Пропозицію відправлено");
      qc.invalidateQueries({ queryKey: ["offers"] });
      qc.invalidateQueries({ queryKey: ["branch-incoming"] });
      reset();
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Не вдалося"),
  });

  const valid = pallets > 0 && pallets <= max;

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <SheetContent side="bottom" className="rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle>
            {step === "qty" ? "Запропонувати" : "Кому відправити"}
          </SheetTitle>
        </SheetHeader>

        {item && step === "qty" && (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <div className="text-sm font-semibold">{item.product_name}</div>
              <div className="text-xs text-muted-foreground">
                {item.shipment_code} · доступно {max}п
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Кількість палет
              </label>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" onClick={() => setPallets((p) => Math.max(1, p - 1))}>−</Button>
                <Input
                  type="number"
                  min={1}
                  max={max}
                  value={pallets}
                  onChange={(e) => setPallets(Math.max(1, Math.min(max, Number(e.target.value) || 1)))}
                  className="text-center"
                />
                <Button variant="outline" size="icon" onClick={() => setPallets((p) => Math.min(max, p + 1))}>+</Button>
              </div>
            </div>
            <Button className="w-full" disabled={!valid} onClick={() => setStep("branch")}>
              Запропонувати
            </Button>
          </div>
        )}

        {step === "branch" && (
          <div className="mt-4 space-y-3">
            <div className="text-xs text-muted-foreground">
              {pallets}п · {item?.product_name}
            </div>
            <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
              {(branches ?? []).map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => setTargetBranch(b.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition ${
                      targetBranch === b.id ? "border-brand bg-brand/10" : "border-border hover:bg-muted/40"
                    }`}
                  >
                    {b.name}
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1" onClick={() => setStep("qty")}>
                Назад
              </Button>
              <Button
                className="flex-1"
                disabled={!targetBranch || submit.isPending}
                onClick={() => submit.mutate()}
              >
                Відправити
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
