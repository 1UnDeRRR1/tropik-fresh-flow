import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, RotateCcw, ShieldOff, ShieldCheck, Trash2, Calendar, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SectionCard, EmptyState } from "@/components/cards";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/calendar-access")({
  component: CalendarAccessPage,
});

interface AccountRow {
  id: string;
  user_id: string;
  username: string;
  access_type: "branch" | "tropik";
  branch_id: string | null;
  valid_from: string;
  valid_until: string | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
}

interface BranchRow {
  id: string;
  name: string;
  city: string | null;
  code: string | null;
}

function CalendarAccessPage() {
  const { hasRole } = useAuth();
  if (!hasRole(["admin", "super_admin"])) return <Navigate to="/" />;

  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null);

  const branchQuery = useQuery({
    queryKey: ["admin-calendar-branches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("id,name,city,code")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data ?? []) as BranchRow[];
    },
  });

  const accountsQuery = useQuery({
    queryKey: ["admin-calendar-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "calendar-account-admin",
        { body: { action: "list" } },
      );
      if (error) throw error;
      return (data?.accounts ?? []) as AccountRow[];
    },
  });

  const branchMap = new Map(
    (branchQuery.data ?? []).map((b) => [b.id, b]),
  );

  const today = new Date().toISOString().slice(0, 10);
  const statusOf = (a: AccountRow) => {
    if (!a.is_active) return { label: "Вимкнено", tone: "bg-muted text-muted-foreground" };
    if (a.valid_until && a.valid_until < today)
      return { label: "Завершено", tone: "bg-destructive/15 text-destructive" };
    return { label: "Активний", tone: "bg-success/15 text-success" };
  };

  const setActive = async (id: string, is_active: boolean) => {
    const { error } = await supabase.functions.invoke("calendar-account-admin", {
      body: { action: "set_active", account_id: id, is_active },
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(is_active ? "Увімкнено" : "Вимкнено");
    qc.invalidateQueries({ queryKey: ["admin-calendar-accounts"] });
  };

  const regenerate = async (id: string) => {
    const { data, error } = await supabase.functions.invoke(
      "calendar-account-admin",
      { body: { action: "regenerate_password", account_id: id } },
    );
    if (error) {
      toast.error(error.message);
      return;
    }
    const acc = (accountsQuery.data ?? []).find((a) => a.id === id);
    if (acc && data?.password) {
      setCredentials({ username: acc.username, password: data.password });
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Видалити акаунт?")) return;
    const { error } = await supabase.functions.invoke("calendar-account-admin", {
      body: { action: "delete", account_id: id },
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Видалено");
    qc.invalidateQueries({ queryKey: ["admin-calendar-accounts"] });
  };

  const extend = async (id: string) => {
    const value = prompt("Нова дата завершення (YYYY-MM-DD), порожньо = безстроково", "");
    if (value === null) return;
    const { error } = await supabase.functions.invoke("calendar-account-admin", {
      body: {
        action: "extend",
        account_id: id,
        valid_until: value.trim() === "" ? null : value.trim(),
      },
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Збережено");
    qc.invalidateQueries({ queryKey: ["admin-calendar-accounts"] });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight md:text-3xl">
            Доступи до календарів
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Легкі read-only акаунти: філія або глобальний Tropik
          </p>
        </div>
        <Button
          size="sm"
          className="bg-brand text-brand-foreground hover:bg-brand/90"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="mr-1 h-4 w-4" /> Створити
        </Button>
      </div>

      {accountsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Завантаження…</p>
      ) : !accountsQuery.data?.length ? (
        <EmptyState title="Акаунтів ще немає" />
      ) : (
        <SectionCard title={`Акаунти (${accountsQuery.data.length})`}>
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[760px] text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2 font-medium">Логін</th>
                  <th className="px-2 py-2 font-medium">Тип</th>
                  <th className="px-2 py-2 font-medium">Філія</th>
                  <th className="px-2 py-2 font-medium">Дійсний</th>
                  <th className="px-2 py-2 font-medium">Статус</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {accountsQuery.data.map((a) => {
                  const st = statusOf(a);
                  const branch = a.branch_id ? branchMap.get(a.branch_id) : null;
                  return (
                    <tr key={a.id}>
                      <td className="px-2 py-2 font-semibold">{a.username}</td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {a.access_type === "branch" ? "Філія" : "Tropik"}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground">
                        {branch ? `${branch.name}${branch.city ? ` · ${branch.city}` : ""}` : "—"}
                      </td>
                      <td className="px-2 py-2 text-muted-foreground whitespace-nowrap">
                        {a.valid_from} → {a.valid_until ?? "∞"}
                      </td>
                      <td className="px-2 py-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.tone}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => regenerate(a.id)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                            title="Новий пароль"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => extend(a.id)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                            title="Подовжити"
                          >
                            <Calendar className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setActive(a.id, !a.is_active)}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                            title={a.is_active ? "Вимкнути" : "Увімкнути"}
                          >
                            {a.is_active ? (
                              <ShieldOff className="h-3.5 w-3.5" />
                            ) : (
                              <ShieldCheck className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => remove(a.id)}
                            className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"
                            title="Видалити"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      <CreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        branches={branchQuery.data ?? []}
        onCreated={(c) => {
          setCredentials(c);
          qc.invalidateQueries({ queryKey: ["admin-calendar-accounts"] });
        }}
      />

      <CredentialsDialog
        creds={credentials}
        onClose={() => setCredentials(null)}
      />
    </div>
  );
}

function CreateDialog({
  open,
  onOpenChange,
  branches,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  branches: BranchRow[];
  onCreated: (c: { username: string; password: string }) => void;
}) {
  const [accessType, setAccessType] = useState<"branch" | "tropik">("branch");
  const [branchId, setBranchId] = useState<string>("");
  const [duration, setDuration] = useState<"permanent" | "days" | "range" | "once">("permanent");
  const [days, setDays] = useState("7");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (accessType === "branch" && !branchId) {
      toast.error("Оберіть філію");
      return;
    }
    let vu: string | null = null;
    const today = new Date();
    if (duration === "days") {
      const n = Math.max(1, parseInt(days || "1", 10));
      const d = new Date(today);
      d.setDate(d.getDate() + n);
      vu = d.toISOString().slice(0, 10);
    } else if (duration === "range") {
      vu = validUntil || null;
    } else if (duration === "once") {
      vu = today.toISOString().slice(0, 10);
    }
    const branch = branches.find((b) => b.id === branchId);
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke(
      "calendar-account-admin",
      {
        body: {
          action: "create",
          access_type: accessType,
          branch_id: accessType === "branch" ? branchId : null,
          branch_label:
            accessType === "branch"
              ? branch?.code || branch?.city || branch?.name || "Branch"
              : null,
          valid_from: validFrom,
          valid_until: vu,
          notes: notes || null,
        },
      },
    );
    setSubmitting(false);
    if (error || !data?.ok) {
      toast.error(error?.message ?? data?.error ?? "Помилка");
      return;
    }
    onOpenChange(false);
    setBranchId("");
    setNotes("");
    onCreated({ username: data.username, password: data.password });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новий доступ до календаря</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Тип доступу</Label>
            <Select
              value={accessType}
              onValueChange={(v) => setAccessType(v as "branch" | "tropik")}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="branch">Календар філії</SelectItem>
                <SelectItem value="tropik">Календар Tropik</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {accessType === "branch" && (
            <div>
              <Label>Філія</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger><SelectValue placeholder="Оберіть" /></SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}{b.city ? ` · ${b.city}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label>Термін</Label>
            <Select value={duration} onValueChange={(v) => setDuration(v as typeof duration)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="permanent">Безстроково</SelectItem>
                <SelectItem value="days">Кількість днів</SelectItem>
                <SelectItem value="range">Діапазон дат</SelectItem>
                <SelectItem value="once">Тільки сьогодні (одноразово)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {duration === "days" && (
            <div>
              <Label>Днів</Label>
              <Input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
          )}
          {duration === "range" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>З</Label>
                <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
              </div>
              <div>
                <Label>До</Label>
                <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
              </div>
            </div>
          )}
          <div>
            <Label>Примітка (опц.)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Скасувати</Button>
          <Button onClick={submit} disabled={submitting} className="bg-brand text-brand-foreground hover:bg-brand/90">
            Створити
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CredentialsDialog({
  creds,
  onClose,
}: {
  creds: { username: string; password: string } | null;
  onClose: () => void;
}) {
  const copy = (v: string) => {
    navigator.clipboard.writeText(v);
    toast.success("Скопійовано");
  };
  return (
    <Dialog open={!!creds} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Облікові дані</DialogTitle>
        </DialogHeader>
        {creds && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Збережіть зараз — пароль показується лише один раз.
            </p>
            <CredRow label="Логін" value={creds.username} onCopy={copy} />
            <CredRow label="Пароль" value={creds.password} onCopy={copy} />
          </div>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Готово</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CredRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <Input readOnly value={value} className="font-mono" />
        <Button variant="outline" size="sm" onClick={() => onCopy(value)}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
