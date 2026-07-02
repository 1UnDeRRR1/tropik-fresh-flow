import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { OfferAllocationForm, type OfferAllocationItem } from "@/components/OfferAllocationForm";

/**
 * Legacy wrapper preserved 1:1 for non-Malekhiv branches. Renders the
 * OfferAllocationForm in a bottom Sheet with the previous title/header.
 */
export function OfferDialog({
  item,
  open,
  onClose,
}: {
  item: OfferAllocationItem | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle>Запропонувати філії</SheetTitle>
        </SheetHeader>
        {item && (
          <OfferAllocationForm
            item={item}
            variant="sheet"
            onSubmitted={onClose}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
