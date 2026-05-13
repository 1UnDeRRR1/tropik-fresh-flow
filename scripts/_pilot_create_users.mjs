import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BRANCH_SHU = "ab83f95c-dd97-4bff-842d-c3c0c09cde27"; // Шувар
const BRANCH_KYI = "0748d5e3-eb24-449e-8e88-746570553eef"; // Київ

const users = [
  { email: "pilot.admin1@tropik.test",   password: "PilotAdmin1!2026", role: "admin",          full_name: "Pilot Адмін 1",   branch_id: null },
  { email: "pilot.admin2@tropik.test",   password: "PilotAdmin2!2026", role: "admin",          full_name: "Pilot Адмін 2",   branch_id: null },
  { email: "pilot.manager1@tropik.test", password: "PilotMgr1!2026",   role: "import_manager", full_name: "Pilot Менеджер 1", branch_id: null, im_phone: "+380000000001" },
  { email: "pilot.manager2@tropik.test", password: "PilotMgr2!2026",   role: "import_manager", full_name: "Pilot Менеджер 2", branch_id: null, im_phone: "+380000000002" },
  { email: "pilot.branch1@tropik.test",  password: "PilotBranch1!2026",role: "branch",         full_name: "Pilot Філія Шувар", branch_id: BRANCH_SHU },
  { email: "pilot.branch2@tropik.test",  password: "PilotBranch2!2026",role: "branch",         full_name: "Pilot Філія Київ",  branch_id: BRANCH_KYI },
];

const results = [];
const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

for (const u of users) {
  let user = list.users.find((x) => x.email === u.email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: u.email, password: u.password, email_confirm: true,
      user_metadata: { full_name: u.full_name },
    });
    if (error) { console.error("create", u.email, error.message); continue; }
    user = data.user;
  } else {
    await admin.auth.admin.updateUserById(user.id, { password: u.password, email_confirm: true });
  }
  await admin.from("profiles").upsert({ id: user.id, full_name: u.full_name, branch_id: u.branch_id });
  await admin.from("user_roles").delete().eq("user_id", user.id);
  const { error: rerr } = await admin.from("user_roles").insert({ user_id: user.id, role: u.role });
  if (rerr) console.error("role", u.email, rerr.message);

  if (u.role === "import_manager") {
    // ensure import_managers row linked to user
    const { data: existing } = await admin.from("import_managers").select("id").eq("user_id", user.id).maybeSingle();
    if (!existing) {
      await admin.from("import_managers").insert({
        user_id: user.id, full_name: u.full_name, email: u.email, phone: u.im_phone, is_active: true,
      });
    } else {
      await admin.from("import_managers").update({ full_name: u.full_name, email: u.email, is_active: true }).eq("id", existing.id);
    }
  }
  results.push({ email: u.email, password: u.password, role: u.role, branch_id: u.branch_id, id: user.id });
}
console.log(JSON.stringify(results, null, 2));
