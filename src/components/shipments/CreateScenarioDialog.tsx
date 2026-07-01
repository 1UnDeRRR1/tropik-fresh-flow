// Build 2B-B-2 — Этап A.
// Scenario picker that appears AFTER /shipments/new validation passes and
// BEFORE the orchestrator writes anything to the database.
//
// Visual: project Dialog (Radix) styled to match the create screen.
// Behavior: closing the dialog (overlay click / Esc / Cancel) creates 0
// records. Confirming a scenario invokes the supplied handler.

import { Loader2, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { CreateShipmentScenario } from "@/lib/create-shipment-orchestrator";

type OptionId = CreateShipmentScenario | "with_reserve" | "and_topup";
type Option = {
  id: OptionId;
  title: string;
  hint: string;
  disabled?: boolean;
  comingSoon?: boolean;
};

// Build 2D — "and_topup" is now active. Selecting it does NOT immediately
// invoke the orchestrator: the parent opens PickOpenVehicleDialog and only
// then runs createShipmentFlow with mode='child'.
function buildOptions(childMode: boolean): Option[] {
  if (childMode) {
    // Child mode: only standalone "Створити" is meaningful. "Створити та
    // закрити" must not appear (closing a vehicle that already hosts a
    // parent shipment is the parent owner's action, not the child's).
    return [
      {
        id: "create",
        title: "Створити",
        hint: "Створити поставку всередині обраного авто. Авто залишається відкритим.",
      },
    ];
  }
  return [
    {
      id: "create",
      title: "Створити",
      hint: "Авто залишається відкритим, інші менеджери можуть додавати свої поставки.",
    },
    {
      id: "with_reserve",
      title: "Створити з резервом",
      hint: "Створити поставку та зарезервувати вільне місце в цьому ж авто під наступну довантаження.",
    },
    {
      id: "create_and_close",
      title: "Створити та закрити",
      hint: "Авто закривається одразу після створення — додавати інші поставки не можна.",
    },
    {
      id: "and_topup",
      title: "Створити та довантажити",
      hint: "Обрати існуюче відкрите авто і додати в нього цю поставку (фрахт успадковується).",
    },
  ];
}

export function CreateScenarioDialog({
  open,
  isSubmitting,
  onConfirm,
  onClose,
  childMode = false,
  onTopUp,
}: {
  open: boolean;
  isSubmitting: boolean;
  onConfirm: (scenario: CreateShipmentScenario) => void;
  onClose: () => void;
  /** Form is already locked to a parent vehicle (entry via "Додати"). */
  childMode?: boolean;
  /** Called when user picks "Створити та довантажити" in standalone mode. */
  onTopUp?: () => void;
}) {
  const options = buildOptions(childMode);
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
          <DialogTitle className="text-base">Створення поставки</DialogTitle>
          <DialogDescription className="text-[12px]">
            Оберіть сценарій. До підтвердження жодних записів у базі не створюється.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-2">
          {options.map((opt) => {
            const active = !opt.disabled;
            return (
              <button
                key={opt.id}
                type="button"
                disabled={!active || isSubmitting}
                onClick={() => {
                  if (!active) return;
                  if (opt.id === "and_topup") {
                    onTopUp?.();
                    return;
                  }
                  if (opt.id === "with_reserve") return;
                  onConfirm(opt.id as CreateShipmentScenario);
                }}
                className={cn(
                  "group flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40",
                  active
                    ? "border-border bg-card hover:border-brand/60 hover:bg-brand/5"
                    : "cursor-not-allowed border-dashed border-border/60 bg-muted/30 text-muted-foreground",
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                    {!active && <Lock className="h-3 w-3 text-muted-foreground" />}
                    <span className={cn(!active && "text-muted-foreground")}>{opt.title}</span>
                    {opt.comingSoon && (
                      <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        буде доступно пізніше
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                    {opt.hint}
                  </div>
                </div>
              </button>
            );
          })}
        </div>


        <DialogFooter className="mt-1 sm:justify-between">
          <Button
            type="button"
            variant="outline"
            className="h-9 w-full sm:w-auto"
            disabled={isSubmitting}
            onClick={onClose}
          >
            Скасувати
          </Button>
          {isSubmitting && (
            <div className="flex items-center justify-center gap-2 text-[12px] text-muted-foreground sm:w-auto">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Створення…
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
