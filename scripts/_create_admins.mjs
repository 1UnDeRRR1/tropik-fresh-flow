import { createClient } from '@supabase/supabase-js';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

const users = [
  { email: 'poyminov.oleksandr@lovable.local', password: 'Admin-Poyminov-2026!', full_name: 'Пойминов Олександр', role: 'admin' },
  { email: 'pazynych.pavlo@lovable.local',     password: 'Admin-Pazynych-2026!', full_name: 'Пазинич Павло',     role: 'admin' },
  { email: 'tereshchenko.pavlo@lovable.local', password: 'Super-Tereshchenko-2026!', full_name: 'Терещенко Павло', role: 'super_admin' },
];

for (const u of users) {
  // delete existing if any
  const { data: list } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list?.users?.find(x => x.email === u.email);
  if (existing) await sb.auth.admin.deleteUser(existing.id);

  const { data, error } = await sb.auth.admin.createUser({
    email: u.email, password: u.password, email_confirm: true,
    user_metadata: { full_name: u.full_name },
  });
  if (error) { console.error(u.email, error.message); continue; }
  const uid = data.user.id;
  await sb.from('profiles').update({ full_name: u.full_name }).eq('id', uid);
  await sb.from('user_roles').delete().eq('user_id', uid);
  const { error: rErr } = await sb.from('user_roles').insert({ user_id: uid, role: u.role });
  if (rErr) console.error('role', u.email, rErr.message);
  console.log('OK', u.email, u.role);
}
