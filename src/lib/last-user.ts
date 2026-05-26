// Remembers the last user_id that signed in on this device, so the /login
// splash and the pre-auth splash can show that person's personal package
// instead of always falling back to Tereshchenko or a neutral spinner.
//
// Pure presentation hint — never used for auth/authorization decisions.

const KEY = "tropik:last_user_id";

export function rememberLastUserId(userId: string | null | undefined): void {
  try {
    if (userId) localStorage.setItem(KEY, userId);
  } catch {
    /* storage disabled — ignore */
  }
}

export function getLastUserId(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
