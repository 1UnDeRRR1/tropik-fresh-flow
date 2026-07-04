// src/lib/mcp/tools/qa-probe-fixtures.ts
// Read-only preflight: validates or discovers reference/master fixtures for
// the future write-runner. Uses service_role via a SELECT-only wrapper — no
// insert/update/delete/rpc surface is exposed to this tool. Reference/master
// data is never mutated.
//
// When QA_MCP_FIXTURES_JSON is set → validate the ids/names.
// When it is missing/invalid → run read-only discovery and return
// `suggested_fixtures_json` that the user can paste back into the secret.

import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { isQaAdminUser, qaGateStatus, readFixturesConfig, type QaFixturesConfig } from "../qa/env";
import { readOnlyAdmin } from "../qa/discovery.server";

type Ref<T> = T & { exists: boolean };

const DEFAULT_CALIBER = "1";
const DEFAULT_COUNTRY_HINT = "Іспанія";
const DEFAULT_PRODUCT_HINT = "Мандарин";

async function firstNonEmpty<T>(...qs: Array<Promise<{ data: T | null; error: unknown }>>): Promise<T | null> {
  for (const p of qs) {
    // eslint-disable-next-line no-await-in-loop
    const r = await p;
    if (!r.error && r.data) return r.data;
  }
  return null;
}

async function validateSupplier(id: string) {
  const r = await readOnlyAdmin
    .read<{ id: string; name: string | null; country: string | null; import_manager_id: string | null; is_active: boolean | null }>("suppliers")
    .select("id,name,country,import_manager_id,is_active")
    .eq("id", id)
    .runSingle();
  return { id, exists: !r.error && !!r.data, name: r.data?.name ?? null, country: r.data?.country ?? null, import_manager_id: r.data?.import_manager_id ?? null, is_active: r.data?.is_active ?? null };
}

async function discoverSupplier() {
  const r = await readOnlyAdmin
    .read<{ id: string; name: string | null; country: string | null; import_manager_id: string | null; is_active: boolean | null }>("suppliers")
    .select("id,name,country,import_manager_id,is_active")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(5)
    .run();
  const rows = r.data ?? [];
  const primary = rows.find((s) => !!s.import_manager_id) ?? rows[0] ?? null;
  return { primary, candidates: rows };
}

async function validateCountry(name: string) {
  const r = await readOnlyAdmin
    .read<{ name: string; code: string | null }>("countries")
    .select("name,code")
    .eq("name", name)
    .runSingle();
  return { name, exists: !r.error && !!r.data, code: r.data?.code ?? null };
}

async function discoverCountry() {
  const hinted = await readOnlyAdmin
    .read<{ name: string; code: string | null }>("countries")
    .select("name,code")
    .eq("name", DEFAULT_COUNTRY_HINT)
    .runSingle();
  if (!hinted.error && hinted.data) return { primary: hinted.data, candidates: [hinted.data] };
  const list = await readOnlyAdmin
    .read<{ name: string; code: string | null }>("countries")
    .select("name,code")
    .order("name", { ascending: true })
    .limit(5)
    .run();
  const rows = list.data ?? [];
  return { primary: rows[0] ?? null, candidates: rows };
}

// Product source: the app reads its product list from
// `product_dictionary.product_name_ua` (see src/routes/_authenticated/shipments/new.tsx
// and src/hooks/useProductAliases.ts). The `products` table exists but does
// not carry the same UA canonical names, so probing it misses items like
// "Мандарин". Mirror the app path: product_dictionary → product_aliases →
// product_dictionary, with `products` only as a last-resort tie-breaker.

type ProductSource = "product_dictionary" | "product_aliases->product_dictionary" | "products" | "none";
type ProductHit = { name: string; exists: boolean; product_id: string | null; note: string; source: ProductSource };

async function validateProduct(name: string): Promise<ProductHit> {
  // 1) Direct match on product_dictionary.product_name_ua (case-insensitive).
  const direct = await readOnlyAdmin
    .read<{ id: string; product_name_ua: string | null }>("product_dictionary")
    .select("id,product_name_ua")
    .ilike("product_name_ua", name)
    .limit(1)
    .run();
  if (!direct.error && direct.data && direct.data[0]) {
    const row = direct.data[0];
    return { name: row.product_name_ua ?? name, exists: true, product_id: row.id, note: "matched product_dictionary.product_name_ua (ilike)", source: "product_dictionary" };
  }
  // 2) Alias → product_dictionary. Try both alias and alias_normalized columns.
  for (const col of ["alias", "alias_normalized"] as const) {
    const alias = await readOnlyAdmin
      .read<{ canonical_product_id: string }>("product_aliases")
      .select(`canonical_product_id,${col}`)
      .ilike(col, name)
      .limit(1)
      .run();
    if (!alias.error && alias.data && alias.data[0]) {
      const canon = alias.data[0].canonical_product_id;
      const dict = await readOnlyAdmin
        .read<{ id: string; product_name_ua: string | null }>("product_dictionary")
        .select("id,product_name_ua")
        .eq("canonical_product_id", canon)
        .runSingle();
      if (!dict.error && dict.data && dict.data.product_name_ua) {
        return { name: dict.data.product_name_ua, exists: true, product_id: dict.data.id, note: `matched via product_aliases.${col} → product_dictionary`, source: "product_aliases->product_dictionary" };
      }
    }
  }
  // 3) Last resort: legacy products table.
  const legacy = await readOnlyAdmin
    .read<{ id: string; name: string | null }>("products")
    .select("id,name")
    .ilike("name", name)
    .limit(1)
    .run();
  if (!legacy.error && legacy.data && legacy.data[0]) {
    return { name: legacy.data[0].name ?? name, exists: true, product_id: legacy.data[0].id, note: "matched products.name (legacy fallback)", source: "products" };
  }
  return { name, exists: false, product_id: null, note: "not found in product_dictionary, product_aliases, or products", source: "none" };
}

async function discoverProduct(): Promise<{ primary: { name: string; product_id: string; source: ProductSource } | null; candidates: { name: string }[]; checked_sources: string[] }> {
  const checked_sources = ["product_dictionary.product_name_ua", "product_aliases.alias", "product_aliases.alias_normalized", "products.name"];
  const hinted = await validateProduct(DEFAULT_PRODUCT_HINT);
  // First 10 canonical names from product_dictionary — mirrors app assortment.
  const list = await readOnlyAdmin
    .read<{ id: string; product_name_ua: string | null }>("product_dictionary")
    .select("id,product_name_ua")
    .order("product_name_ua", { ascending: true })
    .limit(10)
    .run();
  const rows = (list.data ?? []).filter((r) => !!r.product_name_ua);
  const candidates = rows.map((r) => ({ name: r.product_name_ua as string }));

  if (hinted.exists && hinted.product_id) {
    return { primary: { name: hinted.name, product_id: hinted.product_id, source: hinted.source }, candidates, checked_sources };
  }
  if (rows[0]) {
    return { primary: { name: rows[0].product_name_ua as string, product_id: rows[0].id, source: "product_dictionary" }, candidates, checked_sources };
  }
  // Absolute last resort: legacy products table.
  const legacy = await readOnlyAdmin
    .read<{ id: string; name: string | null; is_active: boolean | null }>("products")
    .select("id,name,is_active")
    .eq("is_active", true)
    .order("name", { ascending: true })
    .limit(10)
    .run();
  const legacyRows = (legacy.data ?? []).filter((r) => !!r.name);
  if (legacyRows[0]) {
    return {
      primary: { name: legacyRows[0].name as string, product_id: legacyRows[0].id, source: "products" },
      candidates: legacyRows.map((r) => ({ name: r.name as string })),
      checked_sources,
    };
  }
  return { primary: null, candidates: [], checked_sources };
}

async function validateBranch(id: string) {
  const r = await readOnlyAdmin
    .read<{ id: string; code: string | null; is_active: boolean | null; name: string | null }>("branches")
    .select("id,code,name,is_active")
    .eq("id", id)
    .runSingle();
  return { id, exists: !r.error && !!r.data, code: r.data?.code ?? null, name: r.data?.name ?? null, is_active: r.data?.is_active ?? null };
}

async function discoverBranches() {
  const r = await readOnlyAdmin
    .read<{ id: string; code: string | null; is_active: boolean | null; name: string | null }>("branches")
    .select("id,code,name,is_active")
    .eq("is_active", true)
    .order("code", { ascending: true })
    .limit(5)
    .run();
  return { rows: r.data ?? [] };
}

async function palletStandardsPresent() {
  const r = await readOnlyAdmin.read("pallet_standards").select("id").limit(1).run();
  return !r.error && (r.data?.length ?? 0) > 0;
}

async function discoverPackage(): Promise<{ package_used: string | null; sample_id: string | null }> {
  const r = await readOnlyAdmin
    .read<{ id: string; package_used: string | null }>("pallet_standards")
    .select("id,package_used")
    .order("package_used", { ascending: true })
    .limit(1)
    .run();
  const row = r.data?.[0] ?? null;
  return { package_used: row?.package_used ?? null, sample_id: row?.id ?? null };
}

async function fxRow() {
  const r = await readOnlyAdmin
    .read<{ rate: number | null; date: string | null }>("exchange_rates")
    .select("rate,date")
    .order("date", { ascending: false })
    .limit(1)
    .run();
  const row = r.data?.[0] ?? null;
  return { present: !!row, date: row?.date ?? null };
}

export default defineTool({
  name: "qa_probe_fixtures",
  title: "QA probe fixtures",
  description:
    "Read-only preflight: validates QA_MCP_FIXTURES_JSON when set, or discovers suitable reference/master fixtures and returns suggested_fixtures_json. Uses service_role via a SELECT-only wrapper. Never mutates reference/master data.",
  annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
  handler: async (_args, ctx: ToolContext) => {
    const gate = qaGateStatus();
    const uid = ctx.isAuthenticated() ? ctx.getUserId() ?? null : null;
    const admin = isQaAdminUser(uid);
    if (!gate.enabled || !gate.allowed_project_ref_match || !admin) {
      const payload = {
        ok: false as const,
        reason: "forbidden_or_disabled" as const,
        gate: {
          qa_mcp_enabled: gate.enabled,
          allowed_project_ref_match: gate.allowed_project_ref_match,
          admin_user_ids_configured: gate.admin_user_ids_configured,
          mcp_user_is_qa_admin: admin,
        },
      };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload };
    }

    const cfg = readFixturesConfig();
    const mode: "validated" | "discovered" = cfg.ok ? "validated" : "discovered";
    const config_errors: string[] = cfg.ok ? [] : cfg.reason === "config_invalid" ? [cfg.detail] : [];

    // Resolve targets (either from config or discovery defaults).
    const targetSupplier = cfg.ok ? cfg.fixtures.supplier_id : null;
    const targetCountry = (cfg.ok && cfg.fixtures.country) || DEFAULT_COUNTRY_HINT;
    const targetLoading = (cfg.ok && cfg.fixtures.loading_country) || targetCountry;
    const targetProduct = (cfg.ok && cfg.fixtures.product_name) || DEFAULT_PRODUCT_HINT;
    const targetCaliber = (cfg.ok && cfg.fixtures.caliber) || DEFAULT_CALIBER;
    const targetPackage = (cfg.ok && cfg.fixtures.package_used) || "";
    const targetBranchA = cfg.ok ? cfg.fixtures.branch_a_id : null;
    const targetBranchB = cfg.ok ? cfg.fixtures.branch_b_id : null;

    // Supplier
    const supplier = targetSupplier
      ? await validateSupplier(targetSupplier)
      : await (async () => {
          const d = await discoverSupplier();
          if (!d.primary) return { id: "", exists: false, name: null, country: null, import_manager_id: null, is_active: null };
          return { id: d.primary.id, exists: true, name: d.primary.name, country: d.primary.country, import_manager_id: d.primary.import_manager_id, is_active: d.primary.is_active };
        })();
    const supplierCandidates = mode === "discovered" ? (await discoverSupplier()).candidates : [];

    // Country / loading country
    const country = targetCountry
      ? await validateCountry(targetCountry)
      : await (async () => {
          const d = await discoverCountry();
          return { name: d.primary?.name ?? "", exists: !!d.primary, code: d.primary?.code ?? null };
        })();
    const loading_country = targetLoading
      ? await validateCountry(targetLoading)
      : country;
    const countryDiscovery = mode === "discovered" ? await discoverCountry() : { candidates: [] as { name: string; code: string | null }[] };

    // Product — mirror app source (product_dictionary). Always run discovery
    // for the candidates list, and prefer the hinted name when it resolves.
    const product = await validateProduct(targetProduct);
    const productDiscovery = await discoverProduct();
    let productPrimary: { name: string; product_id: string; source: ProductSource } | null =
      product.exists && product.product_id ? { name: product.name, product_id: product.product_id, source: product.source } : null;
    let productNote = product.note;
    if (!productPrimary && productDiscovery.primary) {
      productPrimary = productDiscovery.primary;
      productNote = `${product.note}; fell back to first ${productDiscovery.primary.source} entry`;
    }
    const productCandidates = productDiscovery.candidates;
    const productCandidatesEmpty = productCandidates.length === 0 && !productPrimary;
    const productCheckedSources = productDiscovery.checked_sources;


    // Branches
    const branchDiscovery = mode === "discovered" ? await discoverBranches() : { rows: [] };
    const branch_a = targetBranchA
      ? await validateBranch(targetBranchA)
      : (branchDiscovery.rows[0]
          ? { id: branchDiscovery.rows[0].id, exists: true, code: branchDiscovery.rows[0].code, name: branchDiscovery.rows[0].name, is_active: branchDiscovery.rows[0].is_active }
          : { id: "", exists: false, code: null, name: null, is_active: null });
    const branch_b = targetBranchB
      ? await validateBranch(targetBranchB)
      : (branchDiscovery.rows[1]
          ? { id: branchDiscovery.rows[1].id, exists: true, code: branchDiscovery.rows[1].code, name: branchDiscovery.rows[1].name, is_active: branchDiscovery.rows[1].is_active }
          : { id: "", exists: false, code: null, name: null, is_active: null });

    const pallet_standards_present = await palletStandardsPresent();
    const packageFallback = targetPackage ? { package_used: targetPackage, sample_id: null } : await discoverPackage();
    const fx = await fxRow();

    const notes: string[] = [];
    if (!fx.present) {
      notes.push(
        "fx_eur_usd absent: not blocking. Future runner should use USD-only pricing/transport OR a separate approved test-data setup should insert a test EUR/USD rate. This probe never writes exchange_rates.",
      );
    }
    if (!targetPackage && packageFallback.package_used) {
      notes.push(`package_used fell back to first pallet_standards.package_used = "${packageFallback.package_used}"`);
    }

    const missing: string[] = [];
    if (!supplier.exists) missing.push("supplier");
    if (!country.exists) missing.push("country");
    if (!loading_country.exists) missing.push("loading_country");
    if (!(productPrimary && productPrimary.product_id)) missing.push("product");
    if (!branch_a.exists) missing.push("branch_a");
    if (!branch_b.exists) missing.push("branch_b");
    if (!pallet_standards_present) missing.push("pallet_standards");
    if (mode === "discovered" && branchDiscovery.rows.length < 2) missing.push("branch_candidates_insufficient");
    // fx_eur_usd deliberately NOT in `missing`: USD-only scenarios are viable.

    const ok = missing.length === 0;

    const effectivePackage = targetPackage || packageFallback.package_used || null;

    const suggested_fixtures_json = mode === "discovered"
      ? {
          supplier_id: supplier.exists ? supplier.id : (supplierCandidates[0]?.id ?? null),
          country: country.exists ? country.name : (countryDiscovery.candidates[0]?.name ?? null),
          loading_country: loading_country.exists ? loading_country.name : (countryDiscovery.candidates[0]?.name ?? null),
          product_name: productPrimary?.name ?? null,
          caliber: targetCaliber,
          package_used: effectivePackage,
          branch_a_id: branch_a.exists ? branch_a.id : (branchDiscovery.rows[0]?.id ?? null),
          branch_b_id: branch_b.exists ? branch_b.id : (branchDiscovery.rows[1]?.id ?? null),
        }
      : undefined;

    const payload = {
      ok,
      mode,
      fixtures: {
        supplier: { id: supplier.id, exists: supplier.exists, name: supplier.name, country: supplier.country, import_manager_id: supplier.import_manager_id, is_active: supplier.is_active },
        country: { name: country.name, exists: country.exists, code: country.code },
        loading_country: { name: loading_country.name, exists: loading_country.exists, code: loading_country.code },
        product: {
          name: productPrimary?.name ?? targetProduct,
          exists: !!(productPrimary && productPrimary.product_id),
          product_id: productPrimary?.product_id ?? null,
          source: productPrimary?.source ?? "none",
          note: productNote,
          checked_sources: productCheckedSources,
          candidates_empty: productCandidatesEmpty,
        },
        caliber: targetCaliber,
        package_used: effectivePackage,
        branch_a,
        branch_b,
        pallet_standards_present,
        fx_eur_usd_present: fx.present,
        fx_eur_usd_date: fx.date,
      },
      ...(mode === "discovered"
        ? {
            candidates: {
              suppliers: supplierCandidates.map((s) => ({ id: s.id, name: s.name, country: s.country })),
              countries: countryDiscovery.candidates,
              products: productCandidates.length > 0 ? productCandidates : (productPrimary ? [{ name: productPrimary.name }] : []),
              branches: branchDiscovery.rows.map((b) => ({ id: b.id, code: b.code, name: b.name })),
            },
            suggested_fixtures_json,
          }
        : {}),
      missing,
      notes,
      config_errors,
    } as const;
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload as unknown as Record<string, unknown> };
  },
});
