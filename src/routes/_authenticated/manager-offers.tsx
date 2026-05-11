import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, Pencil, ChevronDown, ChevronUp, Link2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/AppShell";
import { EmptyState } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  STATUS_LABEL,
  STATUS_CLASS,
  formatRemaining,
  type ManagerOffer,
  type ManagerOfferResponse,
  type ManagerOfferStatus,
  type ManagerOfferTarget,
} from "@/lib/manager-offers";
import { Checkbox } from "@/components/ui/checkbox";

const COUNTRY_OPTIONS = [
  "Греція", "Італія", "Іспанія", "Нідерланди", "Бельгія", "Польща", "Молдова", "Албанія", "Македонія",
  "Туреччина", "Франція", "Німеччина", "Португалія", "Румунія", "Сербія", "Грузія", "Єгипет", "Марокко",
];
const COUNTRY_ALIASES: Record<string, string> = {
  greece: "Греція", gr: "Греція",
  italy: "Італія", it: "Італія",
  spain: "Іспанія", es: "Іспанія",
  netherlands: "Нідерланди", holland: "Нідерланди", nl: "Нідерланди",
  belgium: "Бельгія", be: "Бельгія",
  poland: "Польща", pl: "Польща",
  moldova: "Молдова", md: "Молдова",
  albania: "Албанія", al: "Албанія",
  macedonia: "Македонія", "north macedonia": "Македонія", mk: "Македонія",
  turkey: "Туреччина", tr: "Туреччина",
  france: "Франція", fr: "Франція",
  germany: "Німеччина", de: "Німеччина",
  portugal: "Португалія", pt: "Португалія",
  romania: "Румунія", ro: "Румунія",
  serbia: "Сербія", rs: "Сербія",
  georgia: "Грузія", ge: "Грузія",
  egypt: "Єгипет", eg: "Єгипет",
  morocco: "Марокко", ma: "Марокко",
};

function resolveOption(
  value: string,
  options: string[],
  aliases?: Record<string, string>,
): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const direct = options.find((o) => o.toLowerCase() === v);
  if (direct) return direct;
  if (aliases && aliases[v]) return aliases[v];
  return null;
}

function ValidatedAutocomplete({
  value,
  onChange,
  options,
  aliases,
  placeholder,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  aliases?: Record<string, string>;
  placeholder?: string;
  required?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  const canonical = resolveOption(trimmed, options, aliases);
  const isInvalid = trimmed.length > 0 && !canonical;
  const showRequired = required && trimmed.length === 0;

  const suggestions =
    trimmed.length >= 2 && (!canonical || canonical.toLowerCase() !== lower)
      ? Array.from(
          new Set([
            ...options.filter((o) => o.toLowerCase().startsWith(lower)),
            ...(aliases
              ? Object.entries(aliases)
                  .filter(([k]) => k.startsWith(lower))
                  .map(([, v]) => v)
              : []),
          ]),
        ).slice(0, 8)
      : [];

  return (
    <div className="relative">
      <Input
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          // auto-normalize alias to canonical
          const c = resolveOption(trimmed, options, aliases);
          if (c && c !== trimmed) onChange(c);
          setTimeout(() => setFocused(false), 150);
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === "Tab") && suggestions[0]) {
            e.preventDefault();
            onChange(suggestions[0]);
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        className={cn(
          (isInvalid || showRequired) &&
            "border-destructive bg-destructive/10 focus-visible:ring-destructive",
        )}
      />
      {focused && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-xl">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(s);
              }}
              className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-accent"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {isInvalid && (
        <div className="mt-1 text-xs text-destructive">Значення відсутнє в базі</div>
      )}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/manager-offers")({
  component: ManagerOffersPage,
});

type OfferWithResponses = ManagerOffer & {
  responses: (ManagerOfferResponse & { branch_name?: string })[];
  targetBranchIds: string[];
};

function ManagerOffersPage() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole(["admin", "super_admin"]);
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ManagerOffer | null>(null);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<string>("active");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [linkOffer, setLinkOffer] = useState<ManagerOffer | null>(null);
  const [publishOffer, setPublishOffer] = useState<ManagerOffer | null>(null);

  const { data: branches } = useQuery({
    queryKey: ["branches-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("branches").select("id,name").order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: offers, isLoading } = useQuery({
    queryKey: ["manager-offers", user?.id, isAdmin],
    enabled: !!user,
    queryFn: async () => {
      let q = supabase
        .from("manager_offers")
        .select("*")
        .neq("status", "deleted")
        .order("created_at", { ascending: false });
      if (!isAdmin) q = q.eq("created_by", user!.id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ManagerOffer[];
    },
  });

  const offerIds = useMemo(() => (offers ?? []).map((o) => o.id), [offers]);

  const { data: responses } = useQuery({
    queryKey: ["manager-offer-responses", offerIds],
    enabled: offerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_offer_responses")
        .select("*")
        .in("offer_id", offerIds);
      if (error) throw error;
      return (data ?? []) as ManagerOfferResponse[];
    },
  });

  const { data: targets } = useQuery({
    queryKey: ["manager-offer-targets", offerIds],
    enabled: offerIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_offer_targets")
        .select("*")
        .in("offer_id", offerIds);
      if (error) throw error;
      return (data ?? []) as ManagerOfferTarget[];
    },
  });

  const branchById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const b of branches ?? []) m[b.id] = b.name;
    return m;
  }, [branches]);

  const merged: OfferWithResponses[] = useMemo(() => {
    return (offers ?? []).map((o) => ({
      ...o,
      responses: (responses ?? [])
        .filter((r) => r.offer_id === o.id)
        .map((r) => ({ ...r, branch_name: branchById[r.branch_id] })),
      targetBranchIds: (targets ?? [])
        .filter((t) => t.offer_id === o.id)
        .map((t) => t.branch_id),
    }));
  }, [offers, responses, targets, branchById]);

  const filtered = useMemo(() => {
    if (tab === "all") return merged;
    if (tab === "drafts") return merged.filter((o) => o.status === "draft");
    if (tab === "active")
      return merged.filter((o) =>
        ["active", "in_work", "confirmed"].includes(o.status),
      );
    if (tab === "linked") return merged.filter((o) => o.status === "linked");
    if (tab === "archive")
      return merged.filter((o) => ["closed", "expired"].includes(o.status));
    return merged;
  }, [merged, tab]);

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ManagerOfferStatus }) => {
      const { error } = await supabase.from("manager_offers").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["manager-offers"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const updateApproved = useMutation({
    mutationFn: async ({ id, approved }: { id: string; approved: number | null }) => {
      const { error } = await supabase
        .from("manager_offer_responses")
        .update({ approved_pallets: approved })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["manager-offer-responses"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div>
      <PageHeader
        title="Запропонувати"
        subtitle="Пропозиції товарів для філій до створення поставки"
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> Створити
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active">Активні</TabsTrigger>
          <TabsTrigger value="drafts">Чернетки</TabsTrigger>
          <TabsTrigger value="linked">Прив'язані</TabsTrigger>
          <TabsTrigger value="archive">Архів</TabsTrigger>
          <TabsTrigger value="all">Усі</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4 space-y-3">
          {isLoading && <p className="text-sm text-muted-foreground">Завантаження…</p>}
          {!isLoading && filtered.length === 0 && (
            <EmptyState title="Немає пропозицій" hint="Натисніть «Створити», щоб додати першу" />
          )}
          {filtered.map((o) => {
            const inScope = (branchId: string) =>
              o.target_mode === "all" || o.targetBranchIds.includes(branchId);
            const activeResponses = o.responses.filter((r) => inScope(r.branch_id));
            const excludedResponses = o.responses.filter((r) => !inScope(r.branch_id));
            const totalRequested = activeResponses.reduce(
              (s, r) => s + Number(r.requested_pallets || 0),
              0,
            );
            const totalApproved = activeResponses.reduce(
              (s, r) => s + Number(r.approved_pallets ?? r.requested_pallets ?? 0),
              0,
            );
            const over = o.offered_pallets != null && totalApproved > o.offered_pallets;
            const isOpen = expanded[o.id] ?? false;
            const canEditTargeting = !["closed", "expired", "linked"].includes(o.status);
            return (
              <div
                key={o.id}
                className="rounded-2xl border border-border bg-card p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold">{o.product_name}</span>
                      {o.origin_country && (
                        <span className="text-sm text-muted-foreground">{o.origin_country}</span>
                      )}
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                          STATUS_CLASS[o.status],
                        )}
                      >
                        {STATUS_LABEL[o.status]}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {[o.caliber, o.packaging, o.specification, o.variety]
                        .filter(Boolean)
                        .join(" • ")}
                    </div>
                    <div className="mt-1 text-xs">
                      Інд: <b>${Number(o.indicative_cost_usd ?? 0).toFixed(2)}</b> · Інв:{" "}
                      <b>${Number(o.invoice_cost_usd ?? 0).toFixed(2)}</b>
                      {o.expires_at && (
                        <span className="ml-2 text-muted-foreground">
                          Залишок: {formatRemaining(o.expires_at)}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">Цільові філії:</span>
                      {o.target_mode === "all" ? (
                        <b>Всі філії</b>
                      ) : (
                        <b>
                          Вибірково:{" "}
                          {o.targetBranchIds.length === 0
                            ? "—"
                            : o.targetBranchIds
                                .map((id) => branchById[id] ?? id)
                                .join(", ")}
                        </b>
                      )}
                      {canEditTargeting && o.status !== "draft" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => setPublishOffer(o)}
                        >
                          <Pencil className="mr-1 h-3 w-3" /> Змінити
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={cn("text-sm font-semibold", over && "text-destructive")}>
                      {o.offered_pallets != null
                        ? `${o.offered_pallets} / ${totalApproved}`
                        : `${totalApproved} палет`}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      запит: {totalRequested}
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {o.status === "draft" && (
                    <Button size="sm" onClick={() => setPublishOffer(o)}>
                      Запропонувати
                    </Button>
                  )}
                  {o.status === "active" && (
                    <Button size="sm" onClick={() => setStatus.mutate({ id: o.id, status: "in_work" })}>
                      Взяти в роботу
                    </Button>
                  )}
                  {o.status === "in_work" && (
                    <Button size="sm" onClick={() => setStatus.mutate({ id: o.id, status: "confirmed" })}>
                      Підтвердити
                    </Button>
                  )}
                  {(o.status === "confirmed" || o.status === "in_work") && (
                    <Button size="sm" variant="outline" onClick={() => setLinkOffer(o)}>
                      <Link2 className="mr-1 h-3.5 w-3.5" /> Прив'язати до поставки
                    </Button>
                  )}
                  {!["closed", "expired", "linked"].includes(o.status) && (
                    <Button size="sm" variant="outline" onClick={() => setEditing(o)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Редагувати
                    </Button>
                  )}
                  {!["closed", "expired"].includes(o.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setStatus.mutate({ id: o.id, status: "closed" })}
                    >
                      Закрити
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setStatus.mutate({ id: o.id, status: "deleted" })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setExpanded((p) => ({ ...p, [o.id]: !isOpen }))}
                  >
                    {isOpen ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                    Відгуки ({activeResponses.length}
                    {excludedResponses.length > 0 && ` +${excludedResponses.length}`})
                  </Button>
                </div>

                {isOpen && (
                  <div className="mt-3 overflow-x-auto">
                    {o.responses.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Поки немає відгуків</p>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase text-muted-foreground">
                            <th className="py-1">Філія</th>
                            <th className="py-1">Запит</th>
                            <th className="py-1">Підтверджено</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...activeResponses, ...excludedResponses].map((r) => {
                            const excluded = !inScope(r.branch_id);
                            return (
                              <tr
                                key={r.id}
                                className={cn(
                                  "border-t border-border",
                                  excluded && "opacity-60",
                                )}
                              >
                                <td className="py-1">
                                  {r.branch_name ?? r.branch_id}
                                  {excluded && (
                                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                                      виключено з таргетингу
                                    </span>
                                  )}
                                </td>
                                <td className="py-1">{Number(r.requested_pallets)}</td>
                                <td className="py-1">
                                  <Input
                                    className="h-8 w-24"
                                    type="number"
                                    min={0}
                                    disabled={excluded}
                                    defaultValue={r.approved_pallets ?? r.requested_pallets}
                                    onBlur={(e) => {
                                      const v = e.target.value === "" ? null : Number(e.target.value);
                                      if (v !== r.approved_pallets) {
                                        updateApproved.mutate({ id: r.id, approved: v });
                                      }
                                    }}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </TabsContent>
      </Tabs>

      <OfferEditor
        open={creating || !!editing}
        offer={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => qc.invalidateQueries({ queryKey: ["manager-offers"] })}
      />

      <LinkShipmentDialog
        offer={linkOffer}
        onClose={() => setLinkOffer(null)}
        onLinked={() => {
          setLinkOffer(null);
          qc.invalidateQueries({ queryKey: ["manager-offers"] });
        }}
      />

      <PublishOfferDialog
        offer={publishOffer}
        branches={branches ?? []}
        onClose={() => setPublishOffer(null)}
        onPublished={() => {
          setPublishOffer(null);
          qc.invalidateQueries({ queryKey: ["manager-offers"] });
          qc.invalidateQueries({ queryKey: ["manager-offer-targets"] });
          qc.invalidateQueries({ queryKey: ["manager-offer-targets-edit"] });
        }}
      />
    </div>
  );
}

function OfferEditor({
  open,
  offer,
  onClose,
  onSaved,
}: {
  open: boolean;
  offer: ManagerOffer | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    product_name: "",
    origin_country: "",
    caliber: "",
    packaging: "",
    specification: "",
    variety: "",
    indicative_cost_usd: "",
    invoice_cost_usd: "",
    offered_pallets: "",
    expires_in_hours: "" as string,
    notes: "",
  });

  // Sync when opening
  useMemo(() => {
    if (open) {
      if (offer) {
        setForm({
          product_name: offer.product_name ?? "",
          origin_country: offer.origin_country ?? "",
          caliber: offer.caliber ?? "",
          packaging: offer.packaging ?? "",
          specification: offer.specification ?? "",
          variety: offer.variety ?? "",
          indicative_cost_usd: String(offer.indicative_cost_usd ?? ""),
          invoice_cost_usd: String(offer.invoice_cost_usd ?? ""),
          offered_pallets: offer.offered_pallets != null ? String(offer.offered_pallets) : "",
          expires_in_hours: "",
          notes: offer.notes ?? "",
        });
      } else {
        setForm({
          product_name: "",
          origin_country: "",
          caliber: "",
          packaging: "",
          specification: "",
          variety: "",
          indicative_cost_usd: "",
          invoice_cost_usd: "",
          offered_pallets: "",
          expires_in_hours: "",
          notes: "",
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, offer?.id]);

  const { data: productOptions = [] } = useQuery({
    queryKey: ["products-active-names"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []).map((p) => p.name as string);
    },
  });

  const productValid = !!resolveOption(form.product_name, productOptions);
  const countryValid =
    form.origin_country.trim() === "" ||
    !!resolveOption(form.origin_country, COUNTRY_OPTIONS, COUNTRY_ALIASES);

  const save = useMutation({
    mutationFn: async () => {
      const productCanonical = resolveOption(form.product_name, productOptions);
      if (!productCanonical) throw new Error("Товар має відповідати базі");
      const countryCanonical =
        form.origin_country.trim() === ""
          ? null
          : resolveOption(form.origin_country, COUNTRY_OPTIONS, COUNTRY_ALIASES);
      if (form.origin_country.trim() !== "" && !countryCanonical)
        throw new Error("Країна має відповідати базі");
      const payload = {
        product_name: productCanonical,
        origin_country: countryCanonical,
        caliber: form.caliber.trim() || null,
        packaging: form.packaging.trim() || null,
        specification: form.specification.trim() || null,
        variety: form.variety.trim() || null,
        indicative_cost_usd: form.indicative_cost_usd === "" ? 0 : Number(form.indicative_cost_usd),
        invoice_cost_usd: form.invoice_cost_usd === "" ? 0 : Number(form.invoice_cost_usd),
        offered_pallets: form.offered_pallets === "" ? null : Number(form.offered_pallets),
        expires_at:
          form.expires_in_hours === ""
            ? offer?.expires_at ?? null
            : new Date(Date.now() + Number(form.expires_in_hours) * 3600_000).toISOString(),
        notes: form.notes.trim() || null,
      };
      if (offer) {
        const { error } = await supabase
          .from("manager_offers")
          .update(payload)
          .eq("id", offer.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("manager_offers").insert({
          ...payload,
          created_by: user!.id,
          status: "draft",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Збережено");
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{offer ? "Редагувати пропозицію" : "Нова пропозиція"}</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Товар *</span>
            <ValidatedAutocomplete
              value={form.product_name}
              onChange={(v) => setForm((p) => ({ ...p, product_name: v }))}
              options={productOptions}
              placeholder="Почніть вводити назву товару"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Країна походження</span>
            <ValidatedAutocomplete
              value={form.origin_country}
              onChange={(v) => setForm((p) => ({ ...p, origin_country: v }))}
              options={COUNTRY_OPTIONS}
              aliases={COUNTRY_ALIASES}
              placeholder="Почніть вводити країну"
            />
          </label>
          {(
            [
              ["caliber", "Калібр"],
              ["packaging", "Упаковка"],
              ["specification", "Специфікація"],
              ["variety", "Сорт / асортимент"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="block text-sm">
              <span className="mb-1 block text-muted-foreground">{label}</span>
              <Input
                value={form[k]}
                onChange={(e) => setForm((p) => ({ ...p, [k]: e.target.value }))}
              />
            </label>
          ))}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Індикативна, USD</span>
              <Input
                type="number"
                step="0.01"
                value={form.indicative_cost_usd}
                onChange={(e) => setForm((p) => ({ ...p, indicative_cost_usd: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Інвойсна, USD</span>
              <Input
                type="number"
                step="0.01"
                value={form.invoice_cost_usd}
                onChange={(e) => setForm((p) => ({ ...p, invoice_cost_usd: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Палет (опціонально)</span>
              <Input
                type="number"
                value={form.offered_pallets}
                onChange={(e) => setForm((p) => ({ ...p, offered_pallets: e.target.value }))}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted-foreground">Термін дії, год</span>
              <Input
                type="number"
                placeholder={offer?.expires_at ? "не змінювати" : "без обмеження"}
                value={form.expires_in_hours}
                onChange={(e) => setForm((p) => ({ ...p, expires_in_hours: e.target.value }))}
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-muted-foreground">Примітки</span>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
            />
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              Скасувати
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={save.isPending || !productValid || !countryValid}
            >
              Зберегти
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function LinkShipmentDialog({
  offer,
  onClose,
  onLinked,
}: {
  offer: ManagerOffer | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const { data: shipments } = useQuery({
    queryKey: ["shipments-link-options", offer?.id],
    enabled: !!offer,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id,code,country,eta")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
  });

  const link = useMutation({
    mutationFn: async (shipmentId: string) => {
      if (!offer) return;
      const { error } = await supabase
        .from("manager_offers")
        .update({ status: "linked", linked_shipment_id: shipmentId })
        .eq("id", offer.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Прив'язано. Розподіл створено автоматично.");
      onLinked();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Sheet open={!!offer} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Прив'язати до поставки</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">
            Виберіть поставку. Підтверджені палети філій буде автоматично розподілено за
            відповідним товаром поставки.
          </p>
          {(shipments ?? []).map((s) => (
            <button
              key={s.id}
              onClick={() => link.mutate(s.id)}
              className="flex w-full items-center justify-between rounded-lg border border-border p-3 text-left hover:bg-secondary"
            >
              <div>
                <div className="font-semibold">{s.code}</div>
                <div className="text-xs text-muted-foreground">
                  {s.country ?? "—"} · ETA {s.eta ?? "—"}
                </div>
              </div>
            </button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PublishOfferDialog({
  offer,
  branches,
  onClose,
  onPublished,
}: {
  offer: ManagerOffer | null;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onPublished: () => void;
}) {
  const isDraft = offer?.status === "draft";
  const [mode, setMode] = useState<"all" | "selected">("all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  // Load existing targets when opening for an offer that's already published
  const { data: existingTargets } = useQuery({
    queryKey: ["manager-offer-targets-edit", offer?.id],
    enabled: !!offer,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("manager_offer_targets")
        .select("branch_id")
        .eq("offer_id", offer!.id);
      if (error) throw error;
      return (data ?? []).map((r) => r.branch_id as string);
    },
  });

  // reset state when opening, then merge in existing targets once loaded
  useMemo(() => {
    if (offer) {
      setMode(offer.target_mode ?? "all");
      setSelected({});
    }
  }, [offer?.id]);

  useMemo(() => {
    if (offer && existingTargets) {
      const m: Record<string, boolean> = {};
      for (const id of existingTargets) m[id] = true;
      setSelected(m);
    }
  }, [offer?.id, existingTargets]);

  const publish = useMutation({
    mutationFn: async () => {
      if (!offer) return;
      const branchIds =
        mode === "selected"
          ? Object.entries(selected)
              .filter(([, v]) => v)
              .map(([k]) => k)
          : [];
      if (mode === "selected" && branchIds.length === 0) {
        throw new Error("Виберіть хоча б одну філію");
      }

      // Reset existing targets for this offer
      const { error: delErr } = await supabase
        .from("manager_offer_targets")
        .delete()
        .eq("offer_id", offer.id);
      if (delErr) throw delErr;

      if (mode === "selected" && branchIds.length > 0) {
        const { error: insErr } = await supabase
          .from("manager_offer_targets")
          .insert(branchIds.map((branch_id) => ({ offer_id: offer.id, branch_id })));
        if (insErr) throw insErr;
      }

      const update: { target_mode: "all" | "selected"; status?: ManagerOfferStatus } = {
        target_mode: mode,
      };
      if (isDraft) update.status = "active";
      const { error } = await supabase
        .from("manager_offers")
        .update(update)
        .eq("id", offer.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(isDraft ? "Пропозицію опубліковано" : "Цільові філії оновлено");
      onPublished();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const selectedCount = Object.values(selected).filter(Boolean).length;
  const allBranchIds = branches.map((b) => b.id);
  const allSelected = allBranchIds.length > 0 && allBranchIds.every((id) => selected[id]);

  return (
    <Sheet open={!!offer} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {isDraft
              ? "Запропонувати всім філіям чи вибірково?"
              : "Змінити цільові філії"}
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          {!isDraft && (
            <p className="text-xs text-muted-foreground">
              Зміни застосовуються миттєво. Філії, які буде вилучено, втратять доступ до
              цієї пропозиції; їх відгуки збережуться як історія, але не враховуються в
              підсумках.
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant={mode === "all" ? "default" : "outline"}
              onClick={() => setMode("all")}
              className="flex-1"
            >
              Всім
            </Button>
            <Button
              variant={mode === "selected" ? "default" : "outline"}
              onClick={() => setMode("selected")}
              className="flex-1"
            >
              Вибірково
            </Button>
          </div>

          {mode === "selected" && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Виберіть філії ({selectedCount} обрано)
                </span>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => {
                    if (allSelected) setSelected({});
                    else {
                      const m: Record<string, boolean> = {};
                      for (const id of allBranchIds) m[id] = true;
                      setSelected(m);
                    }
                  }}
                >
                  {allSelected ? "Зняти всі" : "Вибрати всі"}
                </button>
              </div>
              {branches.map((b) => (
                <label
                  key={b.id}
                  className="flex cursor-pointer items-center gap-2 py-1 text-sm"
                >
                  <Checkbox
                    checked={!!selected[b.id]}
                    onCheckedChange={(v) =>
                      setSelected((p) => ({ ...p, [b.id]: !!v }))
                    }
                  />
                  <span>{b.name}</span>
                </label>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>
              Скасувати
            </Button>
            <Button
              onClick={() => publish.mutate()}
              disabled={publish.isPending}
            >
              {isDraft ? "Запропонувати" : "Зберегти"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
