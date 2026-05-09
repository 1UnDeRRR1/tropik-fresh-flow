import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_PUBLISHABLE_KEY;

const accounts = [
  { email: "qa.superadmin@tropik.test", password: "QaSuper!2026", role: "super_admin" },
  { email: "qa.admin@tropik.test",      password: "QaAdmin!2026", role: "admin" },
  { email: "qa.manager@tropik.test",    password: "QaMgr!2026",   role: "import_manager" },
  { email: "qa.branch@tropik.test",     password: "QaBranch!2026",role: "branch (Шувар)" },
];

const tables = [
  "shipments", "shipment_items", "distributions", "distribution_items",
  "branch_requests", "branch_request_items", "branch_transfer_offers",
  "transfer_requests", "suppliers", "import_managers", "manager_vacations",
  "loading_plan", "vehicles", "trigger_logs", "profiles",
];

const report = [];
for (const a of accounts) {
  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { data: signin, error: serr } = await sb.auth.signInWithPassword({ email: a.email, password: a.password });
  if (serr) { console.error(a.email, "login error:", serr.message); continue; }
  const row = { role: a.role, email: a.email, uid: signin.user.id, counts: {} };
  for (const t of tables) {
    const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
    row.counts[t] = error ? `ERR:${error.code||""}` : count;
  }
  report.push(row);
  await sb.auth.signOut();
}

console.log("\n=== RLS visibility per role (row counts) ===");
const tHeader = ["table", ...accounts.map(a=>a.role)];
console.log(tHeader.join(" | "));
for (const t of tables) {
  console.log([t, ...report.map(r => String(r.counts[t]))].join(" | "));
}
