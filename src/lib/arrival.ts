// Country → logistics days map (default arrival offset)
export const COUNTRY_DAYS: Record<string, number> = {
  Польща: 1,
  Молдова: 1,
  Італія: 4,
  Греція: 4,
  Іспанія: 6,
  Нідерланди: 4,
  Бельгія: 4,
  Албанія: 3,
  Македонія: 3,
};

export const COUNTRIES = Object.keys(COUNTRY_DAYS);

// Ukrainian public holidays (fixed dates, recurring annually)
// Format: MM-DD
const UA_HOLIDAYS_MMDD = new Set<string>([
  "01-01", // Новий рік
  "01-07", // Різдво (юліан.)
  "03-08", // Міжнародний жіночий день
  "05-01", // День праці
  "05-09", // День Перемоги
  "06-28", // День Конституції
  "07-15", // День Української Державності
  "08-24", // День Незалежності
  "10-01", // День захисників і захисниць
  "12-25", // Різдво (григор.)
]);

const isHolidayOrSunday = (d: Date) => {
  if (d.getDay() === 0) return true; // Sunday
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return UA_HOLIDAYS_MMDD.has(`${mm}-${dd}`);
};

/**
 * Calculate arrival date by adding logistics days to loading date,
 * then shifting forward to skip Sundays and Ukrainian public holidays.
 */
export function calcArrivalDate(loadingDate: string | Date, days: number): Date {
  const base = typeof loadingDate === "string" ? new Date(loadingDate) : new Date(loadingDate);
  base.setHours(12, 0, 0, 0);
  base.setDate(base.getDate() + days);
  while (isHolidayOrSunday(base)) {
    base.setDate(base.getDate() + 1);
  }
  return base;
}

export function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
