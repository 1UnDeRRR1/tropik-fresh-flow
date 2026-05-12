import { createClient } from "@supabase/supabase-js";

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const users = [
  { email: "qa.kyiv@tropik.test",    password: "QaKyiv!2026",    full_name: "QA Філія Київ",    branch_id: "0748d5e3-eb24-449e-8e88-746570553eef" },
  { email: "qa.malehiv@tropik.test", password: "QaMalehiv!2026", full_name: "QA Філія Малехів", branch_id: "3b2b3c88-9e2c-4934-af70-b9cb86a3faa1" },
];

const out = [];
const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 });

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
  const { error: rerr } = await admin.from("user_roles").insert({ user_id: user.id, role: "branch" });
  if (rerr) console.error("role", u.email, rerr.message);
  out.push({ email: u.email, password: u.password, branch_id: u.branch_id, id: user.id });
}
console.log(JSON.stringify(out, null, 2));
