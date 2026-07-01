// Build 2E-B — modal to input reserve params before invoking
// create_vehicle_reserve. Zero DB writes here; the parent runs the RPC.
//
// Validation (client-side, UI only; server-side truth stays in the RPC):
//   * pallets: integer 1..26
//   * gross_kg: number > 0 and <= 21500
//   * for scenario "Створити з резервом" the caller passes draft totals
//     (draftPallets, draftGrossKg) so the modal also refuses combinations
//     that would exceed 26 / 21500 together with the pending shipment.

import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

const CAP_PALLETS = 26;
const CAP_GROSS_KG = 21500;

export type ReserveInput = {
  pallets: number;
  grossKg: number;
  note: string | null;
};

export function ReserveInputDialog({
  open,
  isSubmitting,
  draftPallets,
  draftGrossKg,
  onClose,
  onConfirm,
}: {
  open: boolean;
  isSubmitting: boolean;
  /** Draft totals from the pending shipment (0 in reserve-only entry). */
  draftPallets: number;
  draftGrossKg: number;
  onClose: () => void;
  onConfirm: (input: ReserveInput) => void;
}) {
  const [pallets, setPallets] = useState<string>("");
  const [grossKg, setGrossKg] = useState<string>("");
  const [note, setNote] = useState<string>("");

  useEffect(() => {
    if (!open) {
      setPallets("");
      setGrossKg("");
      setNote("");
    }
  }, [open]);

  const palletsNum = Number.parseInt(pallets.trim(), 10);
  const grossNum = Number.parseFloat(grossKg.trim().replace(",", "."));

  const palletsValid =
    Number.isFinite(palletsNum) && palletsNum >= 1 && palletsNum <= CAP_PALLETS;
  const grossValid = Number.isFinite(grossNum) && grossNum > 0 && grossNum <= CAP_GROSS_KG;

  const combinedPallets = (palletsValid ? palletsNum : 0) + draftPallets;
  const combinedGross = (grossValid ? grossNum : 0) + draftGrossKg;
  const overCombined =
    (draftPallets > 0 || draftGrossKg > 0) &&
    (combinedPallets > CAP_PALLETS || combinedGross > CAP_GROSS_KG);

  const canSubmit = palletsValid && grossValid && !overCombined && !isSubmitting;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !isSubmitting) onClose();
      }}
    >
      <DialogContent
        className="max-w-md gap-3 p-4 sm:p-5"
        onInteractOutside={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (isSubmitting) e.preventDefault();
        }}
      >
        <DialogHeader className="space-y-1">
          <DialogTitle className="text-base">Резерв</DialogTitle>
          <DialogDescription className="text-[12px]">
            Зарезервуйте місце в авто. Ліміт: {CAP_PALLETS} пал / {CAP_GROSS_KG} кг брутто.
            {draftPallets > 0 || draftGrossKg > 0 ? (
              <>
                {" "}Поставка займає {draftPallets} пал / {Math.round(draftGrossKg)} кг.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Палети
            </Label>
            <Input
              inputMode="numeric"
              value={pallets}
              onChange={(e) => setPallets(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="1..26"
              disabled={isSubmitting}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Брутто, кг
            </Label>
            <Input
              inputMode="decimal"
              value={grossKg}
              onChange={(e) =>
                setGrossKg(e.target.value.replace(/[^\d.,]/g, ""))
              }
              placeholder="кг"
              disabled={isSubmitting}
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Нотатка
          </Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 500))}
            placeholder="Опційно"
            disabled={isSubmitting}
            className="min-h-[60px]"
          />
        </div>

        {overCombined && (
          <p className="text-[12px] font-medium text-destructive">
            Поставка + резерв перевищують ліміт авто (
            {combinedPallets}/{CAP_PALLETS} пал · {Math.round(combinedGross)}/
            {CAP_GROSS_KG} кг).
          </p>
        )}

        <DialogFooter className="mt-1 gap-2 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="h-9"
            disabled={isSubmitting}
            onClick={onClose}
          >
            Скасувати
          </Button>
          <Button
            type="button"
            className="h-9 bg-brand text-brand-foreground hover:bg-brand/90"
            disabled={!canSubmit}
            onClick={() => {
              if (!canSubmit) return;
              onConfirm({
                pallets: palletsNum,
                grossKg: grossNum,
                note: note.trim() ? note.trim() : null,
              });
            }}
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Створення…
              </span>
            ) : (
              "Створити з резервом"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
