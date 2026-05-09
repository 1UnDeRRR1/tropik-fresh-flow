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

// Country (Ukrainian) → 2-letter code for shipment numbering
export const COUNTRY_CODE: Record<string, string> = {
  Греція: "GR",
  Італія: "IT",
  Іспанія: "ES",
  Нідерланди: "NL",
  Бельгія: "BE",
  Польща: "PL",
  Молдова: "MD",
  Албанія: "AL",
  Македонія: "MK",
};

export const COUNTRIES = Object.keys(COUNTRY_DAYS);

// Ukrainian public holidays (fixed dates, recurring annually)
// Includes: New Year (01-01), Orthodox Christmas (01-07), Catholic Christmas (12-25)
const UA_HOLIDAYS_MMDD = new Set<string>([
  "01-01", "01-07", "03-08", "05-01", "05-09",
  "06-28", "07-15", "08-24", "10-01", "12-25",
]);

// Orthodox Easter (Julian computus, converted to Gregorian)
function orthodoxEaster(year: number): Date {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31); // 3=March, 4=April (Julian)
  const day = ((d + e + 114) % 31) + 1;
  // Convert Julian → Gregorian (add 13 days for 1900-2099)
  const julian = new Date(year, month - 1, day);
  julian.setDate(julian.getDate() + 13);
  return julian;
}

const isNonWorkingDay = (d: Date) => {
  // Sunday is always non-working
  if (d.getDay() === 0) return true;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  if (UA_HOLIDAYS_MMDD.has(`${mm}-${dd}`)) return true;
  // Orthodox Easter (always Sunday but kept for safety / future calendar tweaks)
  const easter = orthodoxEaster(d.getFullYear());
  if (d.getMonth() === easter.getMonth() && d.getDate() === easter.getDate()) return true;
  return false;
};

export function calcArrivalDate(loadingDate: string | Date, days: number): Date {
  const base = typeof loadingDate === "string" ? new Date(loadingDate) : new Date(loadingDate);
  base.setHours(12, 0, 0, 0);
  base.setDate(base.getDate() + days);
  while (isNonWorkingDay(base)) {
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
