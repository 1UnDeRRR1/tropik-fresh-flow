import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useAuth, ROLE_LABEL_UK } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { SectionCard } from "@/components/cards";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/settings")({
  component: Settings,
});

function Settings() {
  const { user, profile, roles, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
      <PageHeader title="Профіль" />
      <SectionCard title="Обліковий запис">
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Імʼя</dt><dd>{profile?.full_name ?? "—"}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Email</dt><dd>{user?.email}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Ролі</dt><dd>{roles.map((r) => ROLE_LABEL_UK[r]).join(", ") || "—"}</dd></div>
        </dl>
      </SectionCard>
      <Button
        variant="outline"
        className="w-full"
        onClick={async () => {
          await signOut();
          navigate({ to: "/login" });
        }}
      >
        <LogOut className="mr-2 h-4 w-4" /> Вийти
      </Button>
    </div>
  );
}
