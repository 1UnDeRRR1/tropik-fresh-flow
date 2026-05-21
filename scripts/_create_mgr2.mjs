import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const EMAIL = "manager2@tropik.ua";
const PASSWORD = "TestManager2!2026";
const FULL_NAME = "Pilot Менеджер 2";

const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
let user = list.users.find((x) => x.email === EMAIL);
if (!user) {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: FULL_NAME },
  });
  if (error) { console.error("create error:", error.message); process.exit(1); }
  user = data.user;
} else {
  await admin.auth.admin.updateUserById(user.id, { password: PASSWORD, email_confirm: true });
}
const { error: pe } = await admin.from("profiles").upsert({ id: user.id, full_name: FULL_NAME, is_active: true });
if (pe) console.error("profile:", pe.message);

const { data: existingRole } = await admin.from("user_roles").select("role").eq("user_id", user.id);
const hasRole = (existingRole || []).some(r => r.role === "import_manager");
if (!hasRole) {
  const { error: re } = await admin.from("user_roles").insert({ user_id: user.id, role: "import_manager" });
  if (re) console.error("role:", re.message);
}

const { data: im } = await admin.from("import_managers").select("id").eq("user_id", user.id).maybeSingle();
let import_manager_id;
if (!im) {
  const { data: ins, error: ie } = await admin.from("import_managers").insert({
    user_id: user.id, full_name: FULL_NAME, email: EMAIL, is_active: true,
  }).select("id").single();
  if (ie) console.error("im:", ie.message);
  import_manager_id = ins?.id;
} else {
  await admin.from("import_managers").update({ full_name: FULL_NAME, email: EMAIL, is_active: true }).eq("id", im.id);
  import_manager_id = im.id;
}

console.log(JSON.stringify({ user_id: user.id, email: EMAIL, import_manager_id }, null, 2));
