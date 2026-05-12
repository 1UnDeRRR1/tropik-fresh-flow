// Admin-only management of lightweight calendar accounts.
// Verifies caller is admin/super_admin, then uses service role to create/update auth users.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

const EMAIL_DOMAIN = "calendar.tropik.local";

interface Body {
  action:
    | "list"
    | "create"
    | "regenerate_password"
    | "set_active"
    | "extend"
    | "delete";
  // create:
  access_type?: "branch" | "tropik";
  branch_id?: string | null;
  branch_label?: string | null; // used for username prefix on branch type
  valid_from?: string | null;
  valid_until?: string | null;
  notes?: string | null;
  // ops:
  account_id?: string;
  is_active?: boolean;
  password?: string;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });

function randomPassword(len = 12): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[arr[i] % alphabet.length];
  return out;
}

function slugify(s: string): string {
  // Translit basic Cyrillic + ASCII fallback
  const map: Record<string, string> = {
    А: "A", Б: "B", В: "V", Г: "H", Ґ: "G", Д: "D", Е: "E", Є: "Ye", Ж: "Zh", З: "Z",
    И: "Y", І: "I", Ї: "Yi", Й: "Y", К: "K", Л: "L", М: "M", Н: "N", О: "O", П: "P",
    Р: "R", С: "S", Т: "T", У: "U", Ф: "F", Х: "Kh", Ц: "Ts", Ч: "Ch", Ш: "Sh", Щ: "Shch",
    Ь: "", Ю: "Yu", Я: "Ya",
  };
  return s
    .split("")
    .map((c) => map[c.toUpperCase()] ?? c)
    .join("")
    .replace(/[^A-Za-z0-9]+/g, "")
    .slice(0, 24) || "Branch";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u } = await userClient.auth.getUser();
  if (!u.user) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: roles } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", u.user.id);
  const isAdmin = (roles ?? []).some(
    (r) => r.role === "admin" || r.role === "super_admin",
  );
  if (!isAdmin) return json({ error: "forbidden" }, 403);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  try {
    switch (body.action) {
      case "list": {
        const { data: accounts, error } = await admin
          .from("calendar_accounts")
          .select(
            "id,user_id,username,access_type,branch_id,valid_from,valid_until,is_active,notes,created_at",
          )
          .order("created_at", { ascending: false });
        if (error) throw error;
        return json({ accounts });
      }

      case "create": {
        if (!body.access_type) return json({ error: "missing_access_type" }, 400);
        const isBranch = body.access_type === "branch";
        if (isBranch && !body.branch_id)
          return json({ error: "branch_required" }, 400);

        const prefix = isBranch
          ? slugify(body.branch_label ?? "Branch")
          : "Tropik";

        const { data: seq, error: seqErr } = await admin.rpc(
          "next_calendar_username_seq",
          { _prefix: prefix },
        );
        if (seqErr) throw seqErr;
        const username = `${prefix}-${seq}`;
        const password = randomPassword(12);
        const email = `${username.toLowerCase()}@${EMAIL_DOMAIN}`;

        const { data: created, error: ce } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: username, calendar_account: true },
        });
        if (ce || !created.user) throw ce ?? new Error("create_failed");
        const uid = created.user.id;

        // handle_new_user trigger inserts a profile + branch role; reset.
        await admin.from("user_roles").delete().eq("user_id", uid);
        const role = isBranch ? "calendar_branch" : "calendar_tropik";
        const { error: re } = await admin
          .from("user_roles")
          .insert({ user_id: uid, role });
        if (re) throw re;

        const { error: pe } = await admin
          .from("profiles")
          .update({
            full_name: username,
            branch_id: isBranch ? body.branch_id : null,
          })
          .eq("id", uid);
        if (pe) throw pe;

        const { error: ie } = await admin.from("calendar_accounts").insert({
          user_id: uid,
          username,
          access_type: body.access_type,
          branch_id: isBranch ? body.branch_id : null,
          valid_from: body.valid_from ?? new Date().toISOString().slice(0, 10),
          valid_until: body.valid_until ?? null,
          is_active: true,
          notes: body.notes ?? null,
          created_by: u.user.id,
        });
        if (ie) throw ie;

        return json({ ok: true, username, password, user_id: uid });
      }

      case "regenerate_password": {
        if (!body.account_id) return json({ error: "missing_account_id" }, 400);
        const { data: acc, error: ae } = await admin
          .from("calendar_accounts")
          .select("user_id")
          .eq("id", body.account_id)
          .maybeSingle();
        if (ae || !acc) throw ae ?? new Error("not_found");
        const password = body.password && body.password.length >= 6
          ? body.password
          : randomPassword(12);
        const { error } = await admin.auth.admin.updateUserById(acc.user_id, {
          password,
        });
        if (error) throw error;
        return json({ ok: true, password });
      }

      case "set_active": {
        if (!body.account_id) return json({ error: "missing_account_id" }, 400);
        const { data: acc, error: ae } = await admin
          .from("calendar_accounts")
          .select("user_id")
          .eq("id", body.account_id)
          .maybeSingle();
        if (ae || !acc) throw ae ?? new Error("not_found");
        const { error } = await admin
          .from("calendar_accounts")
          .update({ is_active: body.is_active ?? false })
          .eq("id", body.account_id);
        if (error) throw error;
        await admin.auth.admin.updateUserById(acc.user_id, {
          ban_duration: body.is_active ? "none" : "876000h",
        });
        return json({ ok: true });
      }

      case "extend": {
        if (!body.account_id) return json({ error: "missing_account_id" }, 400);
        const { error } = await admin
          .from("calendar_accounts")
          .update({
            valid_until: body.valid_until ?? null,
            is_active: true,
          })
          .eq("id", body.account_id);
        if (error) throw error;
        const { data: acc } = await admin
          .from("calendar_accounts")
          .select("user_id")
          .eq("id", body.account_id)
          .maybeSingle();
        if (acc?.user_id) {
          await admin.auth.admin.updateUserById(acc.user_id, {
            ban_duration: "none",
          });
        }
        return json({ ok: true });
      }

      case "delete": {
        if (!body.account_id) return json({ error: "missing_account_id" }, 400);
        const { data: acc, error: ae } = await admin
          .from("calendar_accounts")
          .select("user_id")
          .eq("id", body.account_id)
          .maybeSingle();
        if (ae || !acc) throw ae ?? new Error("not_found");
        await admin.from("calendar_accounts").delete().eq("id", body.account_id);
        await admin.auth.admin.deleteUser(acc.user_id);
        return json({ ok: true });
      }

      default:
        return json({ error: "unknown_action" }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
