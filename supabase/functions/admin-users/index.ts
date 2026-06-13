// Super-admin user management. Verifies caller is super_admin, then uses
// service-role to mutate auth users + user_roles + profiles.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Role = "super_admin" | "admin" | "import_manager" | "branch" | "owner";

interface Body {
  action:
    | "list"
    | "create"
    | "set_role"
    | "set_branch"
    | "deactivate"
    | "reactivate"
    | "delete"
    | "reset_password";
  email?: string;
  password?: string;
  full_name?: string;
  user_id?: string;
  role?: Role;
  branch_id?: string | null;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  // 1. identify caller via anon client + bearer
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u.user) return json({ error: "unauthorized" }, 401);

  // 2. service-role client for privileged work
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // 3. verify caller is super_admin
  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", u.user.id);
  const isSuper = (roles ?? []).some((r) => r.role === "super_admin");
  if (!isSuper) return json({ error: "forbidden" }, 403);

  let body: Body;
  try { body = await req.json() as Body; } catch { return json({ error: "bad_json" }, 400); }

  try {
    switch (body.action) {
      case "list": {
        const { data: profiles, error: pe } = await admin
          .from("profiles")
          .select("id,full_name,phone,branch_id,is_active,created_at")
          .order("created_at", { ascending: false });
        if (pe) throw pe;
        const { data: rs, error: re } = await admin.from("user_roles").select("user_id,role");
        if (re) throw re;
        const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
        const emailMap = new Map<string, string>();
        usersList?.users.forEach((x) => emailMap.set(x.id, x.email ?? ""));
        const roleMap = new Map<string, Role[]>();
        rs?.forEach((r: { user_id: string; role: Role }) => {
          const arr = roleMap.get(r.user_id) ?? [];
          arr.push(r.role);
          roleMap.set(r.user_id, arr);
        });
        return json({
          users: (profiles ?? []).map((p) => ({
            ...p,
            email: emailMap.get(p.id) ?? "",
            roles: roleMap.get(p.id) ?? [],
          })),
        });
      }

      case "create": {
        if (!body.email || !body.password || !body.role) return json({ error: "missing_fields" }, 400);
        const { data: created, error: ce } = await admin.auth.admin.createUser({
          email: body.email,
          password: body.password,
          email_confirm: true,
          user_metadata: { full_name: body.full_name ?? body.email },
        });
        if (ce || !created.user) throw ce ?? new Error("create_failed");
        const uid = created.user.id;
        // handle_new_user trigger inserts profile + branch role; reset to chosen role
        await admin.from("user_roles").delete().eq("user_id", uid);
        const { error: re } = await admin.from("user_roles").insert({ user_id: uid, role: body.role });
        if (re) throw re;
        if (body.branch_id !== undefined) {
          await admin.from("profiles").update({ branch_id: body.branch_id }).eq("id", uid);
        }
        if (body.full_name) {
          await admin.from("profiles").update({ full_name: body.full_name }).eq("id", uid);
        }
        return json({ ok: true, user_id: uid });
      }

      case "set_role": {
        if (!body.user_id || !body.role) return json({ error: "missing_fields" }, 400);
        await admin.from("user_roles").delete().eq("user_id", body.user_id);
        const { error } = await admin.from("user_roles").insert({ user_id: body.user_id, role: body.role });
        if (error) throw error;
        return json({ ok: true });
      }

      case "set_branch": {
        if (!body.user_id) return json({ error: "missing_fields" }, 400);
        const { error } = await admin
          .from("profiles")
          .update({ branch_id: body.branch_id ?? null })
          .eq("id", body.user_id);
        if (error) throw error;
        return json({ ok: true });
      }

      case "deactivate": {
        if (!body.user_id) return json({ error: "missing_fields" }, 400);
        if (body.user_id === u.user.id) return json({ error: "self_protected" }, 400);
        await admin.from("profiles").update({ is_active: false }).eq("id", body.user_id);
        // also revoke session by banning
        await admin.auth.admin.updateUserById(body.user_id, { ban_duration: "876000h" });
        return json({ ok: true });
      }

      case "reactivate": {
        if (!body.user_id) return json({ error: "missing_fields" }, 400);
        await admin.from("profiles").update({ is_active: true }).eq("id", body.user_id);
        await admin.auth.admin.updateUserById(body.user_id, { ban_duration: "none" });
        return json({ ok: true });
      }

      case "delete": {
        if (!body.user_id) return json({ error: "missing_fields" }, 400);
        if (body.user_id === u.user.id) return json({ error: "self_protected" }, 400);
        const { error } = await admin.auth.admin.deleteUser(body.user_id);
        if (error) throw error;
        return json({ ok: true });
      }

      case "reset_password": {
        if (!body.user_id || !body.password) return json({ error: "missing_fields" }, 400);
        const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password });
        if (error) throw error;
        return json({ ok: true });
      }

      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error("[admin-users] internal error:", e);
    return json({ error: "internal_server_error" }, 500);
  }
});
