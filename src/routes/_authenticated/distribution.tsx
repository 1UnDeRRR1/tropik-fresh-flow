import { createFileRoute, Link, Outlet, useMatches } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Package, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { SectionCard, EmptyState } from "@/components/cards";
import { toUaCountry, toShortUaCountry } from "@/lib/countries";

// Abbreviate manager name when row is tight: "Назар Лукач" → "Назар Л.".
// Mirrors the helper used in branch "Головна" so visual shape matches.
const shortenManagerName = (name: string): string => {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0]} ${parts[1].charAt(0)}.`;
};
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CostPair } from "@/components/CostPair";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CompactFilterSelect } from "@/components/CompactFilterSelect";
import { ShinyFilterSelect } from "@/components/ShinyFilterSelect";

const MALEKHIV_BRANCH_ID = "3bb65cb3-27a1-5f18-839a-340271d711fd";

import { useProductAliases } from "@/hooks/useProductAliases";
import { useCountryAliases } from "@/hooks/useCountryAliases";
import { countPositionsFromGroups, formatPositions } from "@/lib/positions";

import { toast } from "sonner";
import { useStableQueryData } from "@/lib/query-stability";
import { useRealtimeInvalidate } from "@/hooks/useRealtimeInvalidate";

export const Route = createFileRoute("/_authenticated/distribution")({
  component: Distribution,
});

function Distribution() {
  const matches = useMatches();
  const isChild = matches.some((m) => m.routeId === "/_authenticated/distribution/$shipmentId");
  if (isChild) return <Outlet />;
  const { primaryRole } = useAuth();
  if (primaryRole === "branch") return <BranchFreeList />;
  return <DistributionList />;
}

// ============ Branch "Вільно" view ============

const ALL = "__all";
const NO_COUNTRY = "__no_country__";
const NO_COUNTRY_LABEL = "— Без країни";

const fmtEta = (eta: string | null) =>
  eta
    ? new Date(eta).toLocaleDateString("uk-UA", { day: "2-digit", month: "long" })
    : "Без дати";

// Short ETA formatter mirrored from branch "Головна" so the visual shape
// matches exactly. Narrow no-break space (U+202F) tightens day/month inline
// without touching font-size, font-family, letter-spacing or line-height.
const fmtEtaShort = (eta: string | null) => {
  if (!eta) return "—";
  const d = new Date(eta);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const mo = d.toLocaleDateString("uk-UA", { month: "short" }).replace(/\.$/, "");
  return `${day}\u202F${mo}.`;
};

type FreeRow = {
  itemId: string;
  shipmentId: string;
  code: string;
  eta: string | null;
  product: string;
  country: string | null;
  variety: string | null;
  caliber: string | null;
  brand: string | null;
  klass: string | null;
  palletWeight: number;
  free: number;
  weight: number;
  indicative: number | null;
  invoice: number | null;
  managerName: string | null;
};

function BranchFreeList() {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const productAliases = useProductAliases();
  const countryAliases = useCountryAliases();
  const [productFilter, setProductFilter] = useState<string>(ALL);
  const [countryFilter, setCountryFilter] = useState<string>(ALL);
  const [pick, setPick] = useState<FreeRow | null>(null);
  const [pallets, setPallets] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState("UAH");
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);
  const [invalid, setInvalid] = useState<{ pallets: boolean; price: boolean }>({ pallets: false, price: false });
  const triggerShake = (inv: { pallets: boolean; price: boolean }) => {
    setInvalid(inv);
    setShake(false);
    requestAnimationFrame(() => setShake(true));
    window.setTimeout(() => setShake(false), 600);
  };

  // Read via branch-safe views — purchase prices are not exposed at all.
  const { data: items } = useQuery({
    queryKey: ["branch-free-items"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipment_items_branch")
        .select("id,shipment_id,product_name,variety,caliber,brand,class,origin_country,pallet_weight,final_cost_indicative,final_cost_invoice,free_pallets")
        .gt("free_pallets", 0)
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; shipment_id: string; product_name: string;
        variety: string | null; caliber: string | null;
        brand: string | null; class: string | null;
        origin_country: string | null;
        pallet_weight: number | null;
        final_cost_indicative: number | null; final_cost_invoice: number | null;
        free_pallets: number;
      }>;
    },
  });

  const shipmentIds = useMemo(
    () => Array.from(new Set((items ?? []).map((i) => i.shipment_id))),
    [items],
  );

  const { data: ships } = useQuery({
    queryKey: ["branch-free-ships", shipmentIds.join(",")],
    enabled: shipmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("shipments_branch")
        .select("id,code,eta,country,status,import_manager_name,cancelled_at,archived_at,unloaded_at,arrived_at,pipeline_status")
        .in("id", shipmentIds);
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string; code: string; eta: string | null;
        country: string | null; status: string;
        import_manager_name: string | null;
        cancelled_at: string | null;
        archived_at: string | null;
        unloaded_at: string | null;
        arrived_at: string | null;
        pipeline_status: string | null;
      }>;
    },
  });

  const { data: pendingReqs } = useQuery({
    queryKey: ["branch-free-pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branch_requests")
        .select("shipment_item_id,pallets,status")
        .eq("status", "pending");
      if (error) throw error;
      return data ?? [];
    },
  });

  const allRows: FreeRow[] = useMemo(() => {
    if (!items) return [];
    const sMap = new Map((ships ?? []).map((s) => [s.id, s]));
    const pendMap = new Map<string, number>();
    (pendingReqs ?? []).forEach((r: any) => {
      if (!r.shipment_item_id) return;
      pendMap.set(r.shipment_item_id, (pendMap.get(r.shipment_item_id) ?? 0) + Number(r.pallets ?? 0));
    });
    const TERMINAL_STATUSES = new Set(["cancelled", "completed", "archived"]);
    const out: FreeRow[] = [];
    items.forEach((it) => {
      const s = sMap.get(it.shipment_id);
      if (!s) return;
      if (TERMINAL_STATUSES.has(String(s.status))) return;
      if (s.cancelled_at) return;
      if (s.archived_at) return;
      if (s.unloaded_at) return;
      const pending = pendMap.get(it.id) ?? 0;
      const free = Number(it.free_pallets ?? 0) - pending;
      if (free <= 0) return;
      const palletWeight = Number(it.pallet_weight ?? 0);
      out.push({
        itemId: it.id,
        shipmentId: it.shipment_id,
        code: s.code,
        eta: s.eta,
        product: it.product_name,
        country: it.origin_country ?? s.country ?? null,
        variety: it.variety,
        caliber: it.caliber,
        brand: it.brand,
        klass: it.class,
        palletWeight,
        free,
        weight: free * palletWeight,
        indicative: it.final_cost_indicative,
        invoice: it.final_cost_invoice,
        managerName: s.import_manager_name ?? null,
      });
    });
    // Default grouping: ETA ascending (tomorrow first → later future dates).
    // Within same ETA: product name alphabetically (uk). Nulls go to the end.
    out.sort((a, b) => {
      const ae = a.eta ?? "9999-12-31";
      const be = b.eta ?? "9999-12-31";
      if (ae !== be) return ae.localeCompare(be);
      return (a.product ?? "").localeCompare(b.product ?? "", "uk");
    });
    return out;
  }, [items, ships, pendingReqs]);


  const passes = (r: FreeRow, excl: "product" | "country" | null) => {
    if (excl !== "product" && productFilter !== ALL && r.product.trim() !== productFilter) return false;
    if (excl !== "country" && countryFilter !== ALL) {
      const c = (r.country ?? "").trim();
      if (countryFilter === NO_COUNTRY ? c !== "" : c !== countryFilter) return false;
    }
    return true;
  };

  const productOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) {
      if (!passes(r, "product")) continue;
      const name = r.product.trim();
      if (name) set.add(name);
    }
    if (productFilter !== ALL) set.add(productFilter);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk")).map((n) => ({ value: n, label: n }));
  }, [allRows, countryFilter, productFilter]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    let hasMissing = false;
    for (const r of allRows) {
      if (!passes(r, "country")) continue;
      const c = (r.country ?? "").trim();
      if (c) set.add(c);
      else hasMissing = true;
    }
    const arr = Array.from(set).sort((a, b) => a.localeCompare(b, "uk")).map((c) => ({ value: c, label: c }));
    if (hasMissing || countryFilter === NO_COUNTRY) arr.push({ value: NO_COUNTRY, label: NO_COUNTRY_LABEL });
    return arr;
  }, [allRows, productFilter, countryFilter]);

  const rows = useMemo(() => allRows.filter((r) => passes(r, null)), [allRows, productFilter, countryFilter]);

  const totalPallets = useMemo(() => rows.reduce((s, r) => s + r.free, 0), [rows]);
  const positionsCount = useMemo(() => {
    const keys = new Map<string, string>();
    for (const r of rows) {
      const key = `${r.product.trim()}__${(r.country ?? "").trim()}`;
      if (!keys.has(key)) keys.set(key, r.product.trim());
    }
    const groups = Array.from(keys.entries()).map(([, product]) => ({ product }));
    return countPositionsFromGroups(groups, (g) => g.product);
  }, [rows]);

  const openOffer = (r: FreeRow) => {
    setPick(r);
    setPallets(String(r.free));
    setPrice("");
    setCurrency("UAH");
  };

  const submit = async () => {
    if (!pick || !user || !profile?.branch_id) return;
    const p = Number(pallets);
    const pr = Number(price);
    const badPallets = !p || p <= 0 || p > pick.free;
    const badPrice = !pr || pr <= 0;
    if (badPallets || badPrice) {
      triggerShake({ pallets: badPallets, price: badPrice });
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("branch_requests").insert({
      branch_id: profile.branch_id,
      shipment_id: pick.shipmentId,
      shipment_item_id: pick.itemId,
      pallets: p,
      qty: p * pick.palletWeight,
      sale_price: pr,
      sale_currency: currency,
      request_type: "free_offer",
      status: "pending",
      requested_by: user.id,
      notes: `Пропозиція по ${pick.product} (${pick.code}): ${p}п × ${pr} ${currency}/кг`,
    });
    setSubmitting(false);
    if (error) {
      if (typeof error.message === "string" && error.message.includes("BSR_INSERT_NO_POSITION_FOR_ITEM")) {
        toast.error("Позиція недоступна для заявки. Оновіть список або зверніться до менеджера.");
        setPick(null);
        qc.invalidateQueries({ queryKey: ["branch-free-items"] });
        qc.invalidateQueries({ queryKey: ["branch-free-ships"] });
        qc.invalidateQueries({ queryKey: ["branch-free-pending"] });
        return;
      }
      toast.error(error.message);
      return;
    }
    toast.success("Пропозицію відправлено імпорт-менеджеру");
    setPick(null);
    qc.invalidateQueries({ queryKey: ["branch-free-items"] });
    qc.invalidateQueries({ queryKey: ["branch-free-ships"] });
    qc.invalidateQueries({ queryKey: ["branch-free-pending"] });
  };


  return (
    <div className="space-y-4">
      <PageHeader title="Вільно" />

      <div className="rounded-xl border border-border bg-card p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Товар</label>
            {profile?.branch_id === MALEKHIV_BRANCH_ID ? (
              <ShinyFilterSelect value={productFilter} onChange={setProductFilter} options={productOptions} allLabel="Всі товари" allValue={ALL} />
            ) : (
              <CompactFilterSelect value={productFilter} onChange={setProductFilter} options={productOptions} allLabel="Всі товари" allValue={ALL} aliases={productAliases} />
            )}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">Країна походження</label>
            {profile?.branch_id === MALEKHIV_BRANCH_ID ? (
              <ShinyFilterSelect value={countryFilter} onChange={setCountryFilter} options={countryOptions} allLabel="Всі країни" allValue={ALL} />
            ) : (
              <CompactFilterSelect value={countryFilter} onChange={setCountryFilter} options={countryOptions} allLabel="Всі країни" allValue={ALL} aliases={countryAliases} />
            )}
          </div>
        </div>
        <div className="flex justify-end">
          <div className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-muted-foreground">
            <span className="font-bold tabular-nums text-foreground">{formatPositions(positionsCount)}</span> поз. ·{" "}
            <span className="font-bold tabular-nums text-brand">{totalPallets}п</span>
          </div>
        </div>
      </div>

      {!rows.length ? (
        <EmptyState title="Немає вільного товару" hint="Усі позиції розподілені або в очікуванні" />
      ) : (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <ul className="divide-y divide-border" data-malekhiv-card={profile?.branch_id === MALEKHIV_BRANCH_ID ? "" : undefined}>
            {rows.map((r) => {
              const countryFull = r.country ? toUaCountry(r.country) : "";
              const countryShortRaw = r.country ? toShortUaCountry(r.country) : "";
              const variety = r.variety ?? "";
              const fullLeftLen = r.product.length + countryFull.length + variety.length;
              const useShortCountry =
                fullLeftLen > 28 && !!countryShortRaw && countryShortRaw !== countryFull;
              const country = useShortCountry ? `${countryShortRaw}.` : countryFull;
              const tailParts: string[] = [];
              if (country) tailParts.push(country);
              if (variety) tailParts.push(variety);
              const tail = tailParts.length ? ` · ${tailParts.join(" · ")}` : "";
              const rawMgr = r.managerName ?? "";
              // ETA factored into width budget so manager shortens like in "Головна".
              const metaApproxLen =
                4 + fmtEtaShort(r.eta).length +
                (r.code ? 3 + r.code.length : 0) +
                (rawMgr ? 3 + rawMgr.length : 0);
              const mgr = rawMgr && metaApproxLen > 34 ? shortenManagerName(rawMgr) : rawMgr;
              // Tight middle-dot separator mirroring "Головна".
              const SEP_TIGHT = "\u2009·\u2009";
              return (
                <li key={r.itemId}>
                  <button
                    type="button"
                    onClick={() => openOffer(r)}
                    className="m-row w-full py-2 text-left text-sm active:opacity-70"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="m-main min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm text-foreground">
                        <span className="font-bold">{r.product}</span>
                        {tail ? <span>{tail}</span> : null}
                      </div>
                      <span className="m-pal shrink-0 text-sm font-bold tabular-nums text-foreground">{r.free}п</span>
                    </div>
                    <div className="m-meta mt-0.5 flex items-baseline justify-between gap-2 text-[11px] font-normal text-muted-foreground">
                      <div className="min-w-0 flex-1 overflow-hidden whitespace-nowrap">
                        <span className="font-mono font-semibold text-sky-600 dark:text-sky-300">
                          {"ETA\u202F"}{fmtEtaShort(r.eta)}
                        </span>
                        {r.code ? (
                          <span className="text-foreground/80">
                            {SEP_TIGHT}<span className="font-mono">{r.code}</span>
                          </span>
                        ) : null}
                        {mgr ? (
                          <span className="text-foreground/80"> · {mgr}</span>
                        ) : null}
                      </div>
                      <span className="shrink-0">
                        <CostPair indicative={r.indicative} invoice={r.invoice} suffix=" кг" size="xs" />
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}


      <Dialog open={!!pick} onOpenChange={(o) => !o && setPick(null)}>
        <DialogContent
          className={cn(
            "top-0 translate-y-0 h-auto max-h-[78svh] overflow-y-auto overscroll-contain data-[state=open]:animate-none data-[state=closed]:animate-none",
            shake && "animate-shake",
          )}
          style={{
            top: "max(32px, calc(env(safe-area-inset-top, 0px) + env(safe-area-inset-top, 0px)))",
            paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))",
          }}
        >
          {pick ? (() => {
            const country = pick.country ?? "";
            const extras: Array<{ label: string; value: string }> = [];
            if (pick.variety) extras.push({ label: "Сорт", value: pick.variety });
            if (pick.caliber) extras.push({ label: "Калібр", value: pick.caliber });
            if (pick.brand) extras.push({ label: "Бренд", value: pick.brand });
            if (pick.klass) extras.push({ label: "Клас", value: pick.klass });
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-base pr-8">
                    <span className="font-bold">{pick.product}</span>
                    {country ? <span className="font-normal text-muted-foreground"> · {toUaCountry(country)}</span> : null}
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-secondary px-2 py-1.5">
                      <div className="text-[10px] text-info">ETA</div>
                      <div className="text-sm font-bold tabular-nums text-info">{fmtEta(pick.eta)}</div>
                      <div className="mt-1 text-[11px] font-mono text-muted-foreground">{pick.code}</div>
                    </div>
                    <div className="rounded-lg bg-secondary px-2 py-1.5 text-right">
                      <div className="text-[10px] text-muted-foreground">Палети</div>
                      <div className="text-sm font-bold tabular-nums text-brand">{pick.free}п</div>
                      {pick.weight > 0 ? (
                        <div className="mt-1 text-[11px] tabular-nums text-muted-foreground">{pick.weight.toLocaleString("uk-UA")} кг</div>
                      ) : null}
                    </div>
                  </div>

                  {extras.length ? (
                    <ul className="space-y-1 rounded-xl border border-border px-3 py-2 text-xs">
                      {extras.map((x) => (
                        <li key={x.label} className="flex justify-between gap-2">
                          <span className="text-muted-foreground">{x.label}:</span>
                          <span className="font-medium text-foreground">{x.value}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {(pick.indicative != null || pick.invoice != null) ? (
                    <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-xs">
                      <span className="text-muted-foreground">Собівартість</span>
                      <CostPair indicative={pick.indicative} invoice={pick.invoice} suffix=" кг" size="sm" />
                    </div>
                  ) : null}

                  {pick.managerName ? (
                    <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-xs">
                      <span className="text-muted-foreground">Менеджер</span>
                      <span className="font-medium text-foreground">{pick.managerName}</span>
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-border px-3 py-2 text-xs">
                    <div className="mb-1.5 text-[11px] font-semibold text-muted-foreground">Відправити пропозицію</div>
                    <div className="grid grid-cols-[1fr_1.4fr_auto] gap-1.5 items-center">
                      <Input
                        type="number"
                        min={1}
                        max={pick.free}
                        value={pallets}
                        onChange={(e) => { setPallets(e.target.value); setInvalid((s) => ({ ...s, pallets: false })); }}
                        inputMode="numeric"
                        placeholder="Палети"
                        aria-label="Палети"
                        className={cn("h-9 text-sm", invalid.pallets && "field-invalid")}
                      />
                      <div className="flex gap-1">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={price}
                          onChange={(e) => { setPrice(e.target.value); setInvalid((s) => ({ ...s, price: false })); }}
                          placeholder="Ціна"
                          aria-label="Ціна"
                          inputMode="decimal"
                          className={cn("h-9 flex-1 text-sm", invalid.price && "field-invalid")}
                        />
                        <select
                          value={currency}
                          onChange={(e) => setCurrency(e.target.value)}
                          className="h-9 rounded-md border border-input bg-transparent px-1.5 text-xs"
                          aria-label="Валюта"
                        >
                          <option value="UAH">UAH</option>
                          <option value="USD">USD</option>
                          <option value="EUR">EUR</option>
                        </select>
                      </div>
                      <Button onClick={submit} disabled={submitting} size="sm" className="h-9 px-3">
                        {submitting ? "…" : "Відправити"}
                      </Button>
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      ≈ {(Number(pallets || 0) * pick.palletWeight).toLocaleString("uk-UA")} кг
                    </div>
                  </div>
                </div>
              </>
            );
          })() : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============ Staff distribution list (unchanged) ============

type ShipRow = {
  id: string;
  code: string;
  eta: string | null;
  status: string;
  country: string | null;
  created_by: string | null;
  import_manager_id: string | null;
  shipment_items: { pallet_count: number | null }[] | null;
  distributions: { distribution_items: { pallets: number | null }[] | null }[] | null;
};

type Bucket = { id: string; code: string; eta: string | null; country: string | null; planned: number; distributed: number; remaining: number };

function DistributionList() {
  const { user, loading, hasRole } = useAuth();
  const isAdmin = hasRole(["admin", "super_admin"]);
  const { data: currentManagerId } = useQuery({
    queryKey: ["current-import-manager-id", user?.id],
    enabled: !loading && !!user && !isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("current_import_manager_id");
      if (error) throw error;
      return data ?? null;
    },
  });

  const distributionQuery = useQuery({
    queryKey: ["distribution-list", user?.id],
    enabled: !loading && !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id,code,eta,status,country,created_by,import_manager_id,shipment_items(pallet_count),distributions(distribution_items(pallets))")
        .neq("status", "cancelled")
        .order("eta", { ascending: true, nullsFirst: false })
        .limit(200);
      if (error) throw error;
      const all = (data ?? []) as ShipRow[];
      if (isAdmin) return all;
      return all.filter((s) => s.created_by === user!.id || (!!currentManagerId && s.import_manager_id === currentManagerId));
    },
  });
  const { data } = useStableQueryData({
    data: distributionQuery.data,
    isSuccess: distributionQuery.isSuccess,
    isFetching: distributionQuery.isFetching,
    isError: distributionQuery.isError,
    module: "distribution-list",
    countRows: (rows) => rows.length,
  });

  const isoToday = new Date().toISOString().slice(0, 10);
  const iso24h = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const rows: Bucket[] = (data ?? []).map((s) => {
    const planned = (s.shipment_items ?? []).reduce((a, i) => a + Number(i.pallet_count ?? 0), 0);
    const distributed = (s.distributions ?? []).reduce(
      (a, d) => a + (d.distribution_items ?? []).reduce((aa, di) => aa + Number(di.pallets ?? 0), 0),
      0,
    );
    return { id: s.id, code: s.code, eta: s.eta, country: s.country, planned, distributed, remaining: Math.max(0, planned - distributed) };
  });

  const urgent = rows.filter((r) => r.eta && r.eta >= isoToday && r.eta <= iso24h && r.remaining > 0);
  const notDist = rows.filter((r) => r.remaining > 0 && (!r.eta || r.eta > iso24h));
  const done = rows.filter((r) => r.distributed > 0);

  useEffect(() => {
    const h = window.location.hash?.slice(1);
    if (!h || !data) return;
    const el = document.getElementById(h);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [data]);

  return (
    <div className="space-y-4">
      <PageHeader title="Розподіл" subtitle="Виберіть поставку для розподілу по філіях" />

      <section id="urgent">
        <SectionCard title="24 години — терміново">
          {!urgent.length ? (distributionQuery.isFetching || !distributionQuery.isSuccess ? <p className="text-sm text-muted-foreground">Оновлення даних…</p> : <EmptyState title="Немає термінових поставок" />) : <List rows={urgent} tone="danger" icon={<AlertTriangle className="h-4 w-4" />} />}
        </SectionCard>
      </section>

      <section id="not">
        <SectionCard title="Нерозподілено">
          {!notDist.length ? (distributionQuery.isFetching || !distributionQuery.isSuccess ? <p className="text-sm text-muted-foreground">Оновлення даних…</p> : <EmptyState title="Немає нерозподілених поставок" hint="Створіть поставку та додайте товари" />) : <List rows={notDist} icon={<Package className="h-4 w-4" />} />}
        </SectionCard>
      </section>

      <section id="done">
        <SectionCard title="Розподілено">
          {!done.length ? (distributionQuery.isFetching || !distributionQuery.isSuccess ? <p className="text-sm text-muted-foreground">Оновлення даних…</p> : <EmptyState title="Розподілів ще немає" />) : <List rows={done} variant="done" icon={<CheckCircle2 className="h-4 w-4" />} />}
        </SectionCard>
      </section>
    </div>
  );
}

function List({ rows, tone, icon, variant }: { rows: Bucket[]; tone?: "danger" | "brand"; icon?: React.ReactNode; variant?: "done" }) {
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => {
        const isDone = variant === "done";
        const fullyDistributed = isDone && r.remaining === 0;
        const iconClass = isDone
          ? fullyDistributed
            ? "bg-emerald-500/15 text-emerald-600"
            : "bg-warning/15 text-warning"
          : tone === "danger"
            ? "bg-destructive/15 text-destructive"
            : tone === "brand"
              ? "bg-brand/15 text-brand"
              : "bg-muted text-muted-foreground";
        const badgeText = isDone
          ? fullyDistributed
            ? "✓"
            : `${r.distributed}п`
          : r.remaining > 0
            ? `${r.remaining}п`
            : "✓";
        const badgeClass = isDone
          ? "bg-emerald-500/15 text-emerald-600"
          : r.remaining > 0
            ? "bg-brand/15 text-brand"
            : "bg-emerald-500/15 text-emerald-600";
        return (
          <li key={r.id}>
            <Link
              to="/distribution/$shipmentId"
              params={{ shipmentId: r.id }}
              className="flex items-center justify-between gap-3 py-3 transition active:scale-[0.99]"
            >
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", iconClass)}>
                {icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.code}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {toUaCountry(r.country) || "—"} · ETA {r.eta ?? "—"} · {r.distributed}/{r.planned}п
                </div>
              </div>
              <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold", badgeClass)}>
                {badgeText}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
