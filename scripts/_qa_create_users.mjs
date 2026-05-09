import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

const BRANCH_ID = "ab83f95c-dd97-4bff-842d-c3c0c09cde27"; // Шувар

const users = [
  { email: "qa.superadmin@tropik.test", password: "QaSuper!2026", role: "super_admin", full_name: "QA Супер-адмін", branch_id: null },
  { email: "qa.admin@tropik.test",      password: "QaAdmin!2026", role: "admin",       full_name: "QA Адмін",       branch_id: null },
  { email: "qa.manager@tropik.test",    password: "QaMgr!2026",   role: "import_manager", full_name: "QA Менеджер ЗЕД", branch_id: null },
  { email: "qa.branch@tropik.test",     password: "QaBranch!2026",role: "branch",      full_name: "QA Філія Шувар", branch_id: BRANCH_ID },
];

const results = [];
for (const u of users) {
  // Try to find existing
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  let user = list.users.find((x) => x.email === u.email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email, password: u.password, email_confirm: true,
      user_metadata: { full_name: u.full_name },
    });
    if (error) { console.error("create", u.email, error.message); continue; }
    user = data.user;
  } else {
    // reset password to known value
    await admin.auth.admin.updateUserById(user.id, { password: u.password, email_confirm: true });
  }
  // ensure profile
  await admin.from("profiles").upsert({ id: user.id, full_name: u.full_name, branch_id: u.branch_id });
  // wipe existing roles, set desired
  await admin.from("user_roles").delete().eq("user_id", user.id);
  const { error: rerr } = await admin.from("user_roles").insert({ user_id: user.id, role: u.role });
  if (rerr) console.error("role", u.email, rerr.message);
  results.push({ email: u.email, password: u.password, role: u.role, id: user.id });
}
console.log(JSON.stringify(results, null, 2));
