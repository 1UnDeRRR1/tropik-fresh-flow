import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import xlsx from "xlsx";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key);

// --- Manager directory: name → email/password ---
const MANAGERS = {
  "Богомолов Ілля":     { email: "ilya.bogomolov@lovable.local",   password: "Manager-Bogomolov-2026!" },
  "Заставна Надія":     { email: "nadiia.zastavna@lovable.local",  password: "Manager-Zastavna-2026!" },
  "Калимон Наталка":    { email: "natalka.kalymon@lovable.local",  password: "Manager-Kalymon-2026!" },
  "Лукач Назарій":      { email: "nazarii.lukach@lovable.local",   password: "Manager-Lukach-2026!" },
  "Масалітіна Альона":  { email: "alona.masalitina@lovable.local", password: "Manager-Masalitina-2026!" },
  "Сахарчук Оксана":    { email: "oksana.sakharchuk@lovable.local",password: "Manager-Sakharchuk-2026!" },
  "Сапіга Олександр":   { email: "oleksandr.sapiha@lovable.local", password: "Manager-Sapiha-2026!" },
};

// ISO3 → Ukrainian country
const ISO3_TO_UA = {
  POL: "Польща", MDA: "Молдова", ITA: "Італія", GRC: "Греція", ESP: "Іспанія",
  NLD: "Нідерланди", BEL: "Бельгія", ALB: "Албанія", MKD: "Македонія", SRB: "Сербія",
  TUR: "Туреччина", AZE: "Азербайджан", GEO: "Грузія", EGY: "Єгипет", PER: "Перу",
};

function parseCode(code) {
  // e.g. "NavaXX-ITA" → { base: "Nava", iso3: "ITA" }
  const m = /^(.+?)XX-([A-Z]{3})$/.exec(code.trim());
  if (!m) return { base: code.replace(/XX.*$/, ""), iso3: "" };
  return { base: m[1], iso3: m[2] };
}

async function ensureUser(email, password, fullName) {
  const { data: list } = await sb.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((u) => u.email === email);
  let uid;
  if (existing) {
    uid = existing.id;
    await sb.auth.admin.updateUserById(uid, { password, user_metadata: { full_name: fullName } });
  } else {
    const { data, error } = await sb.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    uid = data.user.id;
  }
  // Set role = import_manager (replace any default)
  await sb.from("user_roles").delete().eq("user_id", uid);
  await sb.from("user_roles").insert({ user_id: uid, role: "import_manager" });
  await sb.from("profiles").update({ full_name: fullName }).eq("id", uid);
  return uid;
}

async function ensureImportManager(fullName, userId) {
  const { data: existing } = await sb.from("import_managers").select("id").eq("full_name", fullName).maybeSingle();
  if (existing) {
    await sb.from("import_managers").update({ user_id: userId, is_active: true }).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await sb.from("import_managers").insert({ full_name: fullName, user_id: userId, is_active: true }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function upsertSupplier(name, base, iso3, managerId) {
  const country = ISO3_TO_UA[iso3] || null;
  const { data: existing } = await sb.from("suppliers").select("id").eq("name", name).maybeSingle();
  const patch = { code_base: base, iso3, import_manager_id: managerId, country, is_active: true };
  if (existing) {
    await sb.from("suppliers").update(patch).eq("id", existing.id);
    return existing.id;
  }
  const { data, error } = await sb.from("suppliers").insert({ name, ...patch }).select("id").single();
  if (error) throw error;
  return data.id;
}

async function main() {
  const wb = xlsx.read(readFileSync("/tmp/import.xlsx"));
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 }).slice(1);

  // 1. Create users + import_managers
  const managerIdByName = {};
  for (const [name, creds] of Object.entries(MANAGERS)) {
    const uid = await ensureUser(creds.email, creds.password, name);
    const imId = await ensureImportManager(name, uid);
    managerIdByName[name] = imId;
    console.log(`✓ Manager: ${name} → user=${uid} im=${imId}`);
  }

  // 2. Suppliers
  const norm = (s) => String(s).normalize("NFC").replace(/\s+/g, "").toLowerCase();
  const byNorm = {};
  for (const [n, id] of Object.entries(managerIdByName)) byNorm[norm(n)] = id;

  let count = 0;
  for (const row of rows) {
    const [managerName, supplierName, code] = row;
    if (!managerName || !supplierName || !code) continue;
    const imId = byNorm[norm(managerName)];
    if (!imId) { console.warn(`! Unknown manager: ${managerName}`); continue; }
    const { base, iso3 } = parseCode(String(code));
    await upsertSupplier(supplierName.trim(), base, iso3, imId);
    count++;
  }
  console.log(`✓ Suppliers processed: ${count}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
