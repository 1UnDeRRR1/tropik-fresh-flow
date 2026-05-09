import { toast } from "sonner";

/**
 * Translate common Supabase / Postgres errors into short Ukrainian messages.
 * Falls back to the original message if no specific translation matches.
 */
export function translateError(err: unknown): string {
  if (!err) return "Невідома помилка";
  const e = err as { code?: string; message?: string; details?: string };
  const msg = e.message ?? "";
  const code = e.code ?? "";

  if (code === "23505" || /duplicate key/i.test(msg)) return "Запис із такими даними вже існує";
  if (code === "23503" || /foreign key/i.test(msg)) return "Неможливо: запис використовується в іншому місці";
  if (code === "23502" || /null value/i.test(msg)) return "Не заповнені обов'язкові поля";
  if (code === "23514" || /check constraint/i.test(msg)) return "Дані не відповідають правилам перевірки";
  if (code === "42501" || /permission denied|row-level security/i.test(msg))
    return "Немає прав для цієї дії";
  if (code === "PGRST116" || /no rows/i.test(msg)) return "Запис не знайдено";
  if (/network|fetch failed|failed to fetch/i.test(msg)) return "Немає зв'язку з сервером";
  if (/jwt|token|expired/i.test(msg)) return "Сесія завершилась — увійдіть знову";

  return msg || "Сталася помилка. Спробуйте ще раз";
}

/**
 * Standard onSuccess/onError handlers for useMutation.
 * Usage:
 *   useMutation({ mutationFn, ...feedback({ success: "Збережено" }) })
 */
export function feedback(opts: { success?: string; error?: string } = {}) {
  return {
    onSuccess: () => {
      if (opts.success !== "") toast.success(opts.success ?? "Збережено");
    },
    onError: (err: unknown) => {
      toast.error(opts.error ?? translateError(err));
    },
  };
}

/**
 * Await a Supabase query/mutation builder and throw a translated error if it fails.
 * Use inside a mutationFn so React-Query catches it and onError fires.
 */
export async function run<T extends { error: unknown; data?: unknown }>(p: PromiseLike<T>): Promise<T> {
  const result = await p;
  if (result.error) {
    const e = result.error as { message?: string; code?: string };
    const wrapped = new Error(translateError(e));
    (wrapped as Error & { code?: string }).code = e.code;
    throw wrapped;
  }
  return result;
}
