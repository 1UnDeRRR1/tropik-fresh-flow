/**
 * Owner / Director read-only shell — route allow-list.
 *
 * Owner is allowed to land on:
 *   - /owner/* (Calendar / Analytics / Statistics)
 *   - /settings (profile + sign-out)
 *
 * Any other path is bounced back to OWNER_HOME by the layout guard.
 * No DB / RLS / RPC calls happen here — pure client URL gate.
 */
export const OWNER_HOME = "/owner/calendar";

export const OWNER_ALLOWED_PREFIXES = ["/owner", "/settings"] as const;

export function isOwnerAllowedPath(pathname: string): boolean {
  if (!pathname) return false;
  if (pathname === "/") return false;
  return OWNER_ALLOWED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
