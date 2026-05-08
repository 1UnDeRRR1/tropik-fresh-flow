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
const UA_HOLIDAYS_MMDD = new Set<string>([
  "01-01", "01-07", "03-08", "05-01", "05-09",
  "06-28", "07-15", "08-24", "10-01", "12-25",
]);

const isHolidayOrSunday = (d: Date) => {
  if (d.getDay() === 0) return true;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return UA_HOLIDAYS_MMDD.has(`${mm}-${dd}`);
};

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
