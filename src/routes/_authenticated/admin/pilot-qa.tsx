import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, XCircle, AlertTriangle, ExternalLink, RotateCcw, Download, Smartphone } from "lucide-react";
import { SectionCard } from "@/components/cards";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/pilot-qa")({
  component: PilotQAPage,
});

type Status = "todo" | "pass" | "fail" | "review";

type Check = {
  id: string;
  title: string;
  desc: string;
  link?: { to: string; label: string };
};

type Group = {
  group: string;
  role: string;
  account?: string;
  items: Check[];
};

const CHECKS: Group[] = [
  {
    group: "A. Спільне для всіх ролей",
    role: "Усі",
    items: [
      { id: "p1", title: "Логін під своїм акаунтом", desc: "Відкрити published URL → ввести email/пароль → потрапити на дашборд своєї ролі без помилок.", link: { to: "/login", label: "Логін" } },
      { id: "p2", title: "Лог-аут і повторний логін", desc: "Вийти через меню → повернутися на /login → знову зайти. Сесія коректно відновлюється.", link: { to: "/", label: "Головна" } },
      { id: "p3", title: "Refresh не ламає сторінку", desc: "На будь-якій сторінці натиснути Reload (⌘R / pull-to-refresh). Без білого екрану і без redirect на /login.", link: { to: "/", label: "Головна" } },
      { id: "p4", title: "Навігація між розділами", desc: "Перейти головними пунктами меню. Жодних 404 і runtime-помилок.", link: { to: "/", label: "Головна" } },
    ],
  },
  {
    group: "B. iPhone Safari — мобільна стабільність",
    role: "Усі (iPhone)",
    items: [
      { id: "m1", title: "Add to Home Screen", desc: "Safari → Поділитись → На екран «Додому». Іконка відкривається у standalone-режимі.", link: { to: "/", label: "Головна" } },
      { id: "m2", title: "Портретна орієнтація", desc: "Меню, таблиці, форми коректно вміщуються по ширині. Немає горизонтальних скролів.", link: { to: "/shipments", label: "Поставки" } },
      { id: "m3", title: "Ландшафтна орієнтація", desc: "Повернути телефон. Шапка, сайдбар і таблиці адаптуються без обрізки.", link: { to: "/distribution", label: "Розподіл" } },
      { id: "m4", title: "Поворот під час дії", desc: "Відкрити діалог (нова поставка / пропозиція) → повернути телефон. Діалог не злітає, поля зберігають значення.", link: { to: "/shipments", label: "Поставки" } },
      { id: "m5", title: "Клавіатура і поля вводу", desc: "Тапнути в input — клавіатура не перекриває активне поле, скрол піднімає його у видиму зону.", link: { to: "/branch-requests", label: "Заявки філій" } },
    ],
  },
  {
    group: "C. Менеджер 1 і Менеджер 2 — одночасно",
    role: "Import Manager",
    account: "pilot.manager1@tropik.test · pilot.manager2@tropik.test",
    items: [
      { id: "mg1", title: "M1 створює поставку", desc: "Менеджер 1 створює нову поставку з 2-3 позиціями. Зберігається без помилок.", link: { to: "/shipments/new", label: "Нова поставка" } },
      { id: "mg2", title: "M2 одразу бачить поставку", desc: "Менеджер 2 у себе на /shipments бачить нову поставку M1 без ручного refresh (realtime).", link: { to: "/shipments", label: "Поставки" } },
      { id: "mg3", title: "M1 створює пропозицію філіям", desc: "M1 формує offer на свою поставку для обох філій. Філії отримують пропозицію.", link: { to: "/manager-offers", label: "Пропозиції менеджера" } },
      { id: "mg4", title: "Паралельне редагування різних поставок", desc: "M1 редагує свою поставку, M2 — іншу свою. Обидва зберігають без конфліктів і race condition.", link: { to: "/shipments", label: "Поставки" } },
      { id: "mg5", title: "Менеджер бачить тільки свої поставки", desc: "M1 не бачить шипменти M2 у списку власних (RLS). Якщо бачить — зафіксувати як FAIL.", link: { to: "/shipments", label: "Поставки" } },
    ],
  },
  {
    group: "D. Філія 1 (Шувар) і Філія 2 (Київ) — одночасно",
    role: "Branch",
    account: "pilot.branch1@tropik.test · pilot.branch2@tropik.test",
    items: [
      { id: "br1", title: "Обидві філії бачать пропозицію", desc: "Після кроку C3 Шувар і Київ одночасно бачать offer від M1 у /branch-offers.", link: { to: "/branch-offers", label: "Пропозиції філії" } },
      { id: "br2", title: "Одночасний accept без overbooking", desc: "Шувар і Київ ОДНОЧАСНО приймають частини пропозиції. Сума прийнятого ≤ доступної кількості. Жодного від'ємного залишку.", link: { to: "/branch-offers", label: "Пропозиції філії" } },
      { id: "br3", title: "Філія НЕ бачить ціни закупки", desc: "У жодному екрані філії немає unit_price постачальника, EUR/USD ціни, фрахту, маржі (StaffOnly).", link: { to: "/dashboard/branch", label: "Дашборд філії" } },
      { id: "br4", title: "Філія створює заявку (branch_request)", desc: "Шувар створює заявку → Менеджер 1 бачить її у /branch-requests у себе.", link: { to: "/branch-requests", label: "Заявки філій" } },
      { id: "br5", title: "Трансфер між філіями", desc: "Шувар створює transfer-request на Київ. Київ бачить вхідний трансфер у /transfers.", link: { to: "/transfers", label: "Трансфери" } },
      { id: "br6", title: "Внутрішній календар філії працює", desc: "Відкрити /branch-calendar — без помилок, дати і поставки видно.", link: { to: "/branch-calendar", label: "Календар філії" } },
    ],
  },
  {
    group: "E. Розподіл — менеджер vs філія в реальному часі",
    role: "Manager + Branch",
    items: [
      { id: "ds1", title: "Менеджер відкриває розподіл", desc: "M1 заходить у /distribution на свою поставку, бачить прийняті філіями кількості.", link: { to: "/distribution", label: "Розподіл" } },
      { id: "ds2", title: "Зміна qty менеджером — філія бачить", desc: "M1 змінює виділену кількість для Шувар → Шувар на своєму дашборді бачить нове значення без F5 (realtime).", link: { to: "/distribution", label: "Розподіл" } },
      { id: "ds3", title: "Зміна caliber/eta — лог змін", desc: "M1 змінює caliber або eta позиції → у філії з'являється запис у журналі/сповіщеннях.", link: { to: "/notifications", label: "Сповіщення" } },
      { id: "ds4", title: "Скасування позиції", desc: "M1 скасовує позицію (pallet_count=0) → у філії відображається статус «Скасовано».", link: { to: "/dashboard/branch", label: "Дашборд філії" } },
    ],
  },
  {
    group: "F. Адмін 1 і Адмін 2",
    role: "Admin",
    account: "pilot.admin1@tropik.test · pilot.admin2@tropik.test",
    items: [
      { id: "ad1", title: "Адмін бачить усі поставки", desc: "Обидва адміни бачать поставки M1 і M2 у /shipments.", link: { to: "/shipments", label: "Поставки" } },
      { id: "ad2", title: "Адмін бачить усі заявки і трансфери", desc: "/branch-requests і /transfers показують повний список незалежно від філії.", link: { to: "/branch-requests", label: "Заявки філій" } },
      { id: "ad3", title: "Майстер-дані доступні", desc: "Постачальники, продукти, філії, країни, мита, менеджери відкриваються без помилок.", link: { to: "/admin", label: "Адмін-панель" } },
      { id: "ad4", title: "Адмін НЕ ламає чужу сесію", desc: "Поки A1 редагує постачальника, A2 редагує іншого. Збереження обох успішне.", link: { to: "/admin/suppliers", label: "Постачальники" } },
      { id: "ad5", title: "Внутрішній календар працює", desc: "/calendar відкривається без помилок. Зовнішніх календарів (Філіал/Тропік) немає.", link: { to: "/calendar", label: "Календар" } },
    ],
  },
  {
    group: "G. Стабільність і безпека",
    role: "Усі",
    items: [
      { id: "s1", title: "Жодного білого/сірого екрану", desc: "За 1-2 дні пілоту жоден користувач не бачив white/grey screen.", },
      { id: "s2", title: "Жодного reload-loop", desc: "Сторінка не перезавантажується сама по колу.", },
      { id: "s3", title: "Жодного freeze всього проекту", desc: "Не повторилася ситуація із зависанням, як було з зовнішніми календарями.", },
      { id: "s4", title: "Зовнішні календарі залишаються вимкнені", desc: "Спроба перейти на /branch чи /tropik (старі роути) не існує і не ламає застосунок.", },
      { id: "s5", title: "Сповіщення про баги зібрані", desc: "Усі баги від пілот-користувачів задокументовані: скрін + логін + крок відтворення.", link: { to: "/notifications", label: "Сповіщення" } },
    ],
  },
];

const STORAGE_KEY = "tropik-pilot-qa-state-v1";

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

function PilotQAPage() {
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

  const total = flat.length;
  const progress = total ? Math.round(((counts.pass + counts.fail + counts.review) / total) * 100) : 0;

  const setStatus = (id: string, status: Status) =>
    setState((s) => ({ ...s, [id]: { status, notes: s[id]?.notes ?? "" } }));
  const setNotes = (id: string, notes: string) =>
    setState((s) => ({ ...s, [id]: { status: s[id]?.status ?? "todo", notes } }));

  const reset = () => {
    if (confirm("Скинути всі статуси і нотатки пілоту?")) setState({});
  };

  const exportReport = () => {
    const lines: string[] = [
      `# TROPIK — Pilot QA звіт`,
      `Дата: ${new Date().toLocaleString("uk-UA")}`,
      `Прогрес: ${progress}% · OK ${counts.pass} · FAIL ${counts.fail} · REVIEW ${counts.review} · TODO ${counts.todo}`,
      "",
    ];
    CHECKS.forEach((g) => {
      lines.push(`## ${g.group}`);
      if (g.account) lines.push(`_Акаунти: ${g.account}_`);
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
    a.download = `tropik-pilot-qa-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Звіт пілоту збережено");
  };

  return (
    <div className="space-y-4">
      <SectionCard title="Пілотний QA — smoke-test по ролях">
        <p className="text-sm text-muted-foreground">
          Чек-лист для контрольованого пілоту на 5–6 користувачів. Тестуй на <b>published URL</b>, не на preview.
          Кожен крок познач як OK / Помилка / Перегляд. Для багу — додай нотатку: <i>логін + що натиснув + що сталося</i>.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
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
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1 text-xs text-muted-foreground">Прогрес перевірки: {progress}% ({counts.pass + counts.fail + counts.review} / {total})</div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={exportReport}>
            <Download className="mr-1.5 size-4" /> Експорт звіту .md
          </Button>
          <Button variant="ghost" size="sm" onClick={reset}>
            <RotateCcw className="mr-1.5 size-4" /> Скинути все
          </Button>
        </div>
      </SectionCard>

      {CHECKS.map((g) => (
        <SectionCard
          key={g.group}
          title={
            <div className="flex flex-wrap items-center gap-2">
              <span>{g.group}</span>
              <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {g.role}
              </span>
              {g.role.includes("iPhone") && <Smartphone className="size-3.5 text-muted-foreground" />}
            </div>
          }
        >
          {g.account && (
            <div className="mb-2 rounded-lg border border-dashed border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
              Акаунти: <code className="font-mono">{g.account}</code>
            </div>
          )}
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
                    placeholder="Логін + що натиснув + що сталося…"
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
