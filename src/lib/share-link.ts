// Helpers for the pilot "Створити посилання" feature on manager offers.
// Keep this tiny on purpose — token mint + URL build only. No DB writes,
// no Telegram, no photo/storage logic.

/**
 * Pilot allowlist for the "Створити посилання" UI button.
 *
 * MVP scope: only Назар Лукач (import manager) plus admin / super_admin
 * for testing. Any wider rollout must be a separate approved change.
 *
 * Allowlist key = profiles.id (matches auth.users.id).
 */
export const SHARE_LINK_PILOT_PROFILE_IDS: ReadonlySet<string> = new Set([
  "f475e275-458e-4af8-96ea-7e06991cbeb2", // Назар Лукач
]);

export function canUseShareLinkPilot(args: {
  profileId: string | null | undefined;
  isAdmin: boolean;
}): boolean {
  if (args.isAdmin) return true;
  if (!args.profileId) return false;
  return SHARE_LINK_PILOT_PROFILE_IDS.has(args.profileId);
}

// URL-safe token (~22 chars, ~130 bits entropy). No external dep.
export function generateShareToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function buildShareUrl(token: string): string {
  if (typeof window === "undefined") return `/o/${token}`;
  return `${window.location.origin}/o/${token}`;
}

// Plain-text message template intended for pasting into Telegram / WhatsApp.
// Telegram mobile does not preserve rich-clipboard hyperlinks reliably, so we
// keep it as readable two-line text: caption then raw URL (Telegram
// auto-linkifies http(s) URLs into a tappable link).
export function buildTelegramShareText(args: {
  url: string;
  productName?: string | null;
  originCountry?: string | null;
}): string {
  const head = [args.productName, args.originCountry].filter(Boolean).join(" · ");
  const lines: string[] = [];
  if (head) lines.push(head);
  lines.push("ЗАМОВИТИ:");
  lines.push(args.url);
  return lines.join("\n");
}

// sessionStorage key used to bounce an unauthenticated /o/<token> visitor
// through /login and back to the offer link after they sign in.
export const PENDING_SHARE_REDIRECT_KEY = "tropik.pendingShareRedirect";
