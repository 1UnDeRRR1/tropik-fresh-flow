import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Set a known password
const userId = "7a778ddd-7919-4862-a826-cc548958015e";
const pw = "TestProbe!2026";
await admin.auth.admin.updateUserById(userId, { password: pw, email_confirm: true });
const { data: u } = await admin.auth.admin.getUserById(userId);
console.log("email:", u.user.email);

const sb = createClient(url, anon, { auth: { persistSession: false } });
const { data: s, error: serr } = await sb.auth.signInWithPassword({ email: u.user.email, password: pw });
if (serr) { console.error("login err", serr); process.exit(1); }
console.log("logged in as", s.user.id);

const r1 = await sb.from("distributions").select("id,shipment_id,branch_id,status").order("created_at", { ascending: false }).limit(5);
console.log("distributions:", JSON.stringify(r1, null, 2));

const r2 = await sb.from("distributions").select("id,status,shipment_id,distribution_items(pallets,qty,shipment_item_id)").limit(3);
console.log("dist+items:", JSON.stringify(r2, null, 2));

const r3 = await sb.from("shipments_branch").select("id,code,eta").limit(5);
console.log("ships view:", JSON.stringify(r3, null, 2));

const r4 = await sb.from("shipment_items_branch").select("id,product_name").limit(5);
console.log("items view:", JSON.stringify(r4, null, 2));
