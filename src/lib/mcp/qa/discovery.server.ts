// src/lib/mcp/qa/discovery.server.ts
// Server-only: service_role client wrapped so ONLY read paths are exposed.
// The wrapper deliberately hides `insert / update / delete / upsert / rpc`
// so an accidental mutation cannot compile against it. Used exclusively by
// qa_probe_fixtures in this no-write Build.
//
// service_role justification (per Plan §Service_role policy):
//   - This is fixture discovery on reference/master rows.
//   - This is NOT role visibility (role visibility uses real user JWTs, later).
//   - Read-only. No mutation possible through this surface.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

type Filter = { col: string; op: "eq" | "ilike" | "in"; value: unknown };

export type ReadOnlyQuery<Row = Record<string, unknown>> = {
  select: (columns: string) => ReadOnlyQuery<Row>;
  eq: (col: string, value: unknown) => ReadOnlyQuery<Row>;
  ilike: (col: string, value: string) => ReadOnlyQuery<Row>;
  in: (col: string, values: unknown[]) => ReadOnlyQuery<Row>;
  order: (col: string, opts?: { ascending?: boolean }) => ReadOnlyQuery<Row>;
  limit: (n: number) => ReadOnlyQuery<Row>;
  run: () => Promise<{ data: Row[] | null; error: { message: string; code?: string } | null }>;
  runSingle: () => Promise<{ data: Row | null; error: { message: string; code?: string } | null }>;
};

function query<Row = Record<string, unknown>>(table: string): ReadOnlyQuery<Row> {
  const state = {
    columns: "*",
    filters: [] as Filter[],
    order: null as null | { col: string; ascending: boolean },
    limit: null as number | null,
  };
  const self: ReadOnlyQuery<Row> = {
    select(cols) { state.columns = cols; return self; },
    eq(col, value) { state.filters.push({ col, op: "eq", value }); return self; },
    ilike(col, value) { state.filters.push({ col, op: "ilike", value }); return self; },
    in(col, values) { state.filters.push({ col, op: "in", value: values }); return self; },
    order(col, opts) { state.order = { col, ascending: opts?.ascending ?? true }; return self; },
    limit(n) { state.limit = n; return self; },
    async run() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = (supabaseAdmin as any).from(table).select(state.columns);
      for (const f of state.filters) {
        if (f.op === "eq") q = q.eq(f.col, f.value);
        else if (f.op === "ilike") q = q.ilike(f.col, f.value);
        else if (f.op === "in") q = q.in(f.col, f.value as unknown[]);
      }
      if (state.order) q = q.order(state.order.col, { ascending: state.order.ascending });
      if (state.limit != null) q = q.limit(state.limit);
      const res = await q;
      return { data: (res.data as Row[] | null) ?? null, error: res.error ?? null };
    },
    async runSingle() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q: any = (supabaseAdmin as any).from(table).select(state.columns);
      for (const f of state.filters) {
        if (f.op === "eq") q = q.eq(f.col, f.value);
        else if (f.op === "ilike") q = q.ilike(f.col, f.value);
        else if (f.op === "in") q = q.in(f.col, f.value as unknown[]);
      }
      if (state.limit != null) q = q.limit(state.limit);
      const res = await q.maybeSingle();
      return { data: (res.data as Row | null) ?? null, error: res.error ?? null };
    },
  };
  return self;
}

/**
 * SELECT-only wrapper around supabaseAdmin. Exposes ONLY a `read(table)` entry
 * point. No insert / update / delete / upsert / rpc surface.
 */
export const readOnlyAdmin = {
  read<Row = Record<string, unknown>>(table: string): ReadOnlyQuery<Row> {
    return query<Row>(table);
  },
};

/** Column-existence probe: `SELECT <cols> FROM <t> LIMIT 0`. */
export async function probeColumns(
  table: string,
  cols: string[],
): Promise<{ exists: boolean; columns_present: string[]; columns_missing: string[]; sqlstate?: string; error_message?: string }> {
  // Try the full projection first — if it succeeds, all columns exist.
  const full = await readOnlyAdmin.read(table).select(cols.join(",")).limit(0).run();
  if (!full.error) {
    return { exists: true, columns_present: cols, columns_missing: [] };
  }
  // If the table itself is missing, no per-column probing possible.
  const code = full.error.code ?? "";
  if (code === "42P01") {
    return {
      exists: false,
      columns_present: [],
      columns_missing: cols,
      sqlstate: code,
      error_message: full.error.message,
    };
  }
  // Otherwise probe each column individually with `id` as a known column.
  const present: string[] = [];
  const missing: string[] = [];
  for (const c of cols) {
    const r = await readOnlyAdmin.read(table).select(c).limit(0).run();
    if (!r.error) present.push(c);
    else missing.push(c);
  }
  return {
    exists: present.length > 0 || cols.length === 0,
    columns_present: present,
    columns_missing: missing,
    sqlstate: code || undefined,
    error_message: full.error.message,
  };
}
