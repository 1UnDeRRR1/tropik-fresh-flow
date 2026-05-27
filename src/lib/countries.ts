// Phase 0 — country canonicalization is DB-backed via alias-cache.
// No hardcoded EN→UA map. Signature kept sync; cache miss → title-case identity.

import { getCountryAliases } from "@/lib/alias-cache";

function titleCaseUk(value: string): string {
  return value
    .toLocaleLowerCase("uk")
    .split(/(\s+|-)/)
    .map((part) => {
      if (!part || /^(\s+|-)$/.test(part)) return part;
      const first = part.charAt(0).toLocaleUpperCase("uk");
      return first + part.slice(1);
    })
    .join("");
}

/**
 * Canonicalize any country string to a single display form.
 * - Trims whitespace
 * - Maps EN names / ISO codes to Ukrainian via DB-backed alias cache
 * - Falls back to Title Case for unknown inputs (same behavior as legacy map miss)
 */
export function toUaCountry(value?: string | null): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  const key = trimmed.toLocaleLowerCase("uk");
  const mapped = getCountryAliases()[key];
  return mapped ?? titleCaseUk(trimmed);
}

/** Alias for clarity at call sites that store/normalize values. */
export const normalizeCountry = toUaCountry;

/**
 * Compact UA country form for narrow mobile cells.
 * Falls back to the full UA name when no short form is known.
 * Display-only — never used as a key.
 */
const SHORT_UA: Record<string, string> = {
  "південна африка": "ПАР",
  "південно-африканська республіка": "ПАР",
  "італія": "Іт",
  "туреччина": "Тур",
  "греція": "Гр",
  "польща": "Пол",
  "іспанія": "Ісп",
  "португалія": "Порт",
  "нідерланди": "Нід",
  "німеччина": "Нім",
  "франція": "Фр",
  "єгипет": "Єг",
  "марокко": "Мар",
  "ізраїль": "Ізр",
  "молдова": "Молд",
  "грузія": "Груз",
  "вірменія": "Вір",
  "азербайджан": "Аз",
  "сербія": "Сер",
  "хорватія": "Хорв",
  "румунія": "Рум",
  "болгарія": "Болг",
  "угорщина": "Уг",
  "чехія": "Чех",
  "словаччина": "Слов",
  "україна": "Укр",
  "еквадор": "Екв",
  "колумбія": "Кол",
  "перу": "Пер",
  "коста-ріка": "К-Р",
  "домініканська республіка": "Дом",
  "бразилія": "Браз",
  "аргентина": "Арг",
  "чилі": "Чилі",
  "беліз": "Бел",
  "гондурас": "Гонд",
  "панама": "Пан",
  "уругвай": "Уру",
  "парагвай": "Пар",
  "індія": "Інд",
  "китай": "Кит",
  "в'єтнам": "В'єт",
  "таїланд": "Тай",
  "філіппіни": "Філ",
};
export function toShortUaCountry(value?: string | null): string {
  const full = toUaCountry(value);
  if (!full) return "";
  const key = full.toLocaleLowerCase("uk");
  return SHORT_UA[key] ?? full;
}

