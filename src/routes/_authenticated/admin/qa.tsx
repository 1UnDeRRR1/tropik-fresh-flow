import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, ExternalLink, RotateCcw, Download } from "lucide-react";
import { SectionCard } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/qa")({
  component: QAPage,
});

type Status = "todo" | "pass" | "fail" | "review";

type Check = {
  id: string;
  title: string;
  desc: string;
  link?: { to: string; label: string };
};

const CHECKS: { group: string; items: Check[] }[] = [
  {
    group: "1. Створення поставки",
    items: [
      { id: "c1", title: "Менеджер створює поставку", desc: "Відкрити форму нової поставки, заповнити код, постачальника, ETA. Збереження без помилок.", link: { to: "/shipments/new", label: "Нова поставка" } },
      { id: "c2", title: "Постачальник і країна обираються", desc: "У формі видно список постачальників, після вибору країна підставляється автоматично.", link: { to: "/shipments/new", label: "Нова поставка" } },
      { id: "c3", title: "ETA рахується коректно", desc: "loading_date + logistics_days країни = ETA. Перевірити на існуючій поставці.", link: { to: "/shipments", label: "Поставки" } },
    ],
  },
  {
    group: "2. Валюта і конвертація",
    items: [
      { id: "c4", title: "Ціна постачальника EUR/USD", desc: "Перевірити рядок з price_currency=EUR — unit_price_usd має дорівнювати unit_price × eur_usd_rate. Для USD рядка unit_price_usd = unit_price.", link: { to: "/shipments", label: "Поставки" } },
      { id: "c5", title: "Фрахт EUR/USD", desc: "У картці поставки logistics_cost_usd має правильно конвертуватись від logistics_cost і logistics_cost_currency.", link: { to: "/shipments", label: "Поставки" } },
      { id: "c6", title: "Транспорт на кг по вазі палет", desc: "transport_per_kg = logistics_cost_usd / SUM(pallet_count × pallet_weight). Перевірити в картці собівартості.", link: { to: "/costs", label: "Собівартість" } },
    ],
  },
  {
    group: "3. Митниця і собівартість",
    items: [
      { id: "c7", title: "Митний довідник матчиться", desc: "shipment_item з product_name + country знаходить запис у customs_reference. customs_match_id заповнений.", link: { to: "/admin/customs", label: "Митниця" } },
      { id: "c8", title: "Індикативна собівартість", desc: "final_cost_indicative = unit_price_usd + transport_per_kg + euro1_markup_usd.", link: { to: "/costs", label: "Собівартість" } },
      { id: "c9", title: "Інвойсна собівартість", desc: "Якщо unit_price_usd ≤ threshold → інвойсна = euro1_markup_usd. Інакше = ПДВ + митний збір% + 0.015.", link: { to: "/costs", label: "Собівартість" } },
    ],
  },
  {
    group: "4. Розподіл",
    items: [
      { id: "c10", title: "Матриця розподілу — лише вручну", desc: "Тільки +/− кнопки і числовий ввід. Жодного автоматичного розподілу.", link: { to: "/distribution", label: "Розподіл" } },
      { id: "c11", title: "FACT / Розподілено / Залишок", desc: "Лічильники в кожній картці товару оновлюються миттєво при зміні значень.", link: { to: "/distribution", label: "Розподіл" } },
      { id: "c12", title: "Блокування при перевищенні FACT", desc: "Якщо розподілено > FACT → червона підсвітка та AlertDialog при збереженні.", link: { to: "/distribution", label: "Розподіл" } },
    ],
  },
  {
    group: "5. Видимість для філії",
    items: [
      { id: "c13", title: "Філія бачить тільки свої товари", desc: "Увійти філіальним користувачем → бачить лише позиції зі своїм branch_id у distributions.", link: { to: "/dashboard/branch", label: "Дашборд філії" } },
      { id: "c14", title: "Дата прибуття, кількість, собівартість", desc: "На картці філії видно ETA, виділену кількість, інвойсну та індикативну собівартість в USD.", link: { to: "/dashboard/branch", label: "Дашборд філії" } },
      { id: "c15", title: "Зміни видно філії", desc: "Зміни qty / unit_price / caliber / eta з'являються у журналі shipment_item_changes.", link: { to: "/notifications", label: "Сповіщення" } },
      { id: "c16", title: "Скасована позиція позначена", desc: "Якщо pallet_count=0 або item видалено — у філії статус «Скасовано».", link: { to: "/dashboard/branch", label: "Дашборд філії" } },
    ],
  },
  {
    group: "6. Заявки і трансфери",
    items: [
      { id: "c17", title: "Заявки філій", desc: "Філія створює branch_request → менеджер бачить, може погодити/відхилити з підтвердженням.", link: { to: "/branch-requests", label: "Заявки філій" } },
      { id: "c18", title: "Трансфери між філіями", desc: "Філія може створити transfer_request з/на свою філію. Інша філія бачить заявку.", link: { to: "/transfers", label: "Трансфери" } },
    ],
  },
  {
    group: "7. Скоуп системи",
    items: [
      { id: "c19", title: "Жодного авторозподілу", desc: "У коді і UI відсутні кнопки авторозподілу, рівномірного розподілу, AI-пропозицій.", link: { to: "/distribution", label: "Розподіл" } },
      { id: "c20", title: "Жодної маржі/прибутку/продажів", desc: "Немає сторінок прибутку, маржі, аналітики продажів. Лише операційні дані та собівартість.", link: { to: "/analytics", label: "Аналітика" } },
    ],
  },
];

const STORAGE_KEY = "tropik-qa-state-v1";

type State = Record<string, { status: Status; notes: string }>;

function loadState(): State {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

const STATUS_META: Record<Status, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  todo: { label: "Не перевірено", cls: "bg-muted text-muted-foreground border-border", icon: AlertTriangle },
  pass: { label: "OK", cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300", icon: CheckCircle2 },
  fail: { label: "Помилка", cls: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle },
  review: { label: "Потребує перегляду", cls: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300", icon: AlertTriangle },
};

function QAPage() {
  const [state, setState] = useState<State>({});

  useEffect(() => setState(loadState()), []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const flat = useMemo(() => CHECKS.flatMap((g) => g.items), []);
  const counts = useMemo(() => {
    const c = { pass: 0, fail: 0, review: 0, todo: 0 };
    flat.forEach((it) => {
      const s = state[it.id]?.status ?? "todo";
      c[s]++;
    });
    return c;
  }, [state, flat]);

  const setStatus = (id: string, status: Status) =>
    setState((s) => ({ ...s, [id]: { status, notes: s[id]?.notes ?? "" } }));
  const setNotes = (id: string, notes: string) =>
    setState((s) => ({ ...s, [id]: { status: s[id]?.status ?? "todo", notes } }));

  const reset = () => {
    if (confirm("Скинути всі статуси і нотатки?")) setState({});
  };

  const exportReport = () => {
    const lines: string[] = [`# TROPIK QA звіт — ${new Date().toLocaleString("uk-UA")}`, ""];
    lines.push(`OK: ${counts.pass} · Помилки: ${counts.fail} · Перегляд: ${counts.review} · Не перевірено: ${counts.todo}`, "");
    CHECKS.forEach((g) => {
      lines.push(`## ${g.group}`);
      g.items.forEach((it) => {
        const s = state[it.id]?.status ?? "todo";
        const n = state[it.id]?.notes ?? "";
        lines.push(`- [${STATUS_META[s].label}] ${it.title}${n ? ` — ${n}` : ""}`);
      });
      lines.push("");
    });
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tropik-qa-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Звіт збережено");
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(["pass", "fail", "review", "todo"] as Status[]).map((s) => {
          const M = STATUS_META[s];
          return (
            <div key={s} className={cn("rounded-2xl border p-3", M.cls)}>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{M.label}</div>
              <div className="mt-1 text-2xl font-black">{counts[s]}</div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={exportReport}>
          <Download className="mr-1.5 size-4" /> Експорт .md
        </Button>
        <Button variant="ghost" size="sm" onClick={reset}>
          <RotateCcw className="mr-1.5 size-4" /> Скинути
        </Button>
      </div>

      {CHECKS.map((g) => (
        <SectionCard key={g.group} title={g.group}>
          <ul className="space-y-3">
            {g.items.map((it) => {
              const cur = state[it.id]?.status ?? "todo";
              const notes = state[it.id]?.notes ?? "";
              const M = STATUS_META[cur];
              const Icon = M.icon;
              return (
                <li key={it.id} className="rounded-xl border border-border bg-background p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                        <Icon className={cn("size-4 shrink-0", cur === "pass" && "text-emerald-600", cur === "fail" && "text-destructive", cur === "review" && "text-amber-600", cur === "todo" && "text-muted-foreground")} />
                        <span className="truncate">{it.title}</span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{it.desc}</p>
                      {it.link && (
                        <Link
                          to={it.link.to}
                          className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          {it.link.label} <ExternalLink className="size-3" />
                        </Link>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(["pass", "fail", "review", "todo"] as Status[]).map((s) => (
                      <button
                        key={s}
                        onClick={() => setStatus(it.id, s)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-semibold transition",
                          cur === s ? STATUS_META[s].cls : "border-border bg-card text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {STATUS_META[s].label}
                      </button>
                    ))}
                  </div>

                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(it.id, e.target.value)}
                    placeholder="Нотатки тестувальника…"
                    className="mt-2 min-h-[60px] text-sm"
                  />
                </li>
              );
            })}
          </ul>
        </SectionCard>
      ))}
    </div>
  );
}
