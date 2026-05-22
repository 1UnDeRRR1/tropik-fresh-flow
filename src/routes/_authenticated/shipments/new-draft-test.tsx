import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { DraftOfferLineRow } from "@/components/DraftOfferLineRow";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/shipments/new-draft-test")({
  component: NewDraftTestPage,
});

function NewDraftTestPage() {
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
      <PageHeader
        title="Нова поставка · draft test"
        subtitle="Тестова таблиця для перевірки resolver/autofill. Дані не зберігаються в БД."
        action={
          <Button variant="outline" onClick={() => navigate({ to: "/shipments" })}>
            Закрити
          </Button>
        }
      />
      <DraftOfferLineRow onConfirmToast={(m) => toast(m)} />
    </div>
  );
}
