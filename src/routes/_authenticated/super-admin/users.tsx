import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, UserPlus, KeyRound, Power, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ROLE_LABEL_UK, type AppRole } from "@/lib/auth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/super-admin/users")({
  component: UsersAdmin,
});

interface UserRow {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  branch_id: string | null;
  is_active: boolean;
  roles: AppRole[];
  created_at: string;
}

const ROLES: AppRole[] = ["super_admin", "admin", "import_manager", "branch"];

async function callAdmin<T = unknown>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) throw error;
  if (data && typeof data === "object" && "error" in data && data.error) {
    throw new Error(String((data as { error: string }).error));
  }
  return data as T;
}

function UsersAdmin() {
  const qc = useQueryClient();

  const { data: branches } = useQuery({
    queryKey: ["sa", "branches"],
    queryFn: async () => {
      const { data } = await supabase
        .from("branches")
        .select("id,name")
        .order("sort_order")
        .order("name");
      return data ?? [];
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["sa", "users"],
    queryFn: async () => {
      const r = await callAdmin<{ users: UserRow[] }>({ action: "list" });
      return r.users;
    },
  });

  const [form, setForm] = useState({
    email: "",
    password: "",
    full_name: "",
    role: "branch" as AppRole,
    branch_id: "",
  });
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      await callAdmin({
        action: "create",
        email: form.email.trim(),
        password: form.password,
        full_name: form.full_name.trim() || form.email.trim(),
        role: form.role,
        branch_id: form.role === "branch" ? form.branch_id || null : null,
      });
    },
    onSuccess: () => {
      toast.success("Користувача створено");
      setForm({ email: "", password: "", full_name: "", role: "branch", branch_id: "" });
      qc.invalidateQueries({ queryKey: ["sa", "users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setRole = useMutation({
    mutationFn: async ({ user_id, role }: { user_id: string; role: AppRole }) =>
      callAdmin({ action: "set_role", user_id, role }),
    onSuccess: () => {
      toast.success("Роль оновлено");
      qc.invalidateQueries({ queryKey: ["sa", "users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setBranch = useMutation({
    mutationFn: async ({ user_id, branch_id }: { user_id: string; branch_id: string | null }) =>
      callAdmin({ action: "set_branch", user_id, branch_id }),
    onSuccess: () => {
      toast.success("Філію оновлено");
      qc.invalidateQueries({ queryKey: ["sa", "users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async (u: UserRow) =>
      callAdmin({ action: u.is_active ? "deactivate" : "reactivate", user_id: u.id }),
    onSuccess: () => {
      toast.success("Статус оновлено");
      qc.invalidateQueries({ queryKey: ["sa", "users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetPwd = useMutation({
    mutationFn: async ({ user_id, password }: { user_id: string; password: string }) =>
      callAdmin({ action: "reset_password", user_id, password }),
    onSuccess: () => toast.success("Пароль скинуто"),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteUser = useMutation({
    mutationFn: async (user_id: string) => callAdmin({ action: "delete", user_id }),
    onSuccess: () => {
      toast.success("Користувача видалено");
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ["sa", "users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Користувачі" subtitle="Управління всіма обліковими записами" />

      <SectionCard title="Створити користувача" action={<UserPlus className="h-4 w-4 text-muted-foreground" />}>
        <div className="grid gap-2 md:grid-cols-2">
          <Input
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            placeholder="Тимчасовий пароль"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
          <Input
            placeholder="ПІБ"
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
          />
          <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as AppRole })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>{ROLE_LABEL_UK[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {form.role === "branch" && (
            <Select value={form.branch_id} onValueChange={(v) => setForm({ ...form, branch_id: v })}>
              <SelectTrigger><SelectValue placeholder="Філія" /></SelectTrigger>
              <SelectContent>
                {(branches ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <Button
          className="mt-3 w-full"
          disabled={!form.email || !form.password || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Створити
        </Button>
      </SectionCard>

      <SectionCard title="Список користувачів">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Завантаження…
          </div>
        ) : !data?.length ? (
          <EmptyState title="Користувачів немає" />
        ) : (
          <ul className="divide-y divide-border">
            {data.map((u) => {
              const role = u.roles[0] ?? "branch";
              return (
                <li key={u.id} className="space-y-2 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {u.full_name || u.email}
                        {!u.is_active && <span className="ml-2 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] text-destructive">Деактивовано</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                    </div>
                  </div>
                  <div className="grid gap-2 md:grid-cols-3">
                    <Select value={role} onValueChange={(v) => setRole.mutate({ user_id: u.id, role: v as AppRole })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>{ROLE_LABEL_UK[r]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={u.branch_id ?? "__none"}
                      onValueChange={(v) =>
                        setBranch.mutate({ user_id: u.id, branch_id: v === "__none" ? null : v })
                      }
                    >
                      <SelectTrigger><SelectValue placeholder="Філія" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">— без філії —</SelectItem>
                        {(branches ?? []).map((b) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          const p = window.prompt("Новий пароль (мін. 6 символів):");
                          if (p && p.length >= 6) resetPwd.mutate({ user_id: u.id, password: p });
                        }}
                      >
                        <KeyRound className="mr-1 h-3.5 w-3.5" /> Пароль
                      </Button>
                      <Button
                        size="sm"
                        variant={u.is_active ? "outline" : "default"}
                        onClick={() => toggleActive.mutate(u)}
                      >
                        <Power className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setConfirmDelete(u)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </SectionCard>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Видалити користувача?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete?.email} — дію не можна відмінити.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Скасувати</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDelete && deleteUser.mutate(confirmDelete.id)}>
              Видалити
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
