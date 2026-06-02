// Server-only guard for /api/public/hooks/* endpoints.
// Verifies the X-Cron-Secret header against process.env.CRON_SECRET
// using a constant-time comparison. Fail-closed: if CRON_SECRET is
// not configured at runtime, the hook returns 503 and does NOT run.
//
// No secret value is ever logged or returned in the response body.

import { timingSafeEqual } from "node:crypto";

const HEADER_NAME = "x-cron-secret";

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  try {
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

/**
 * Returns a Response when the request should be rejected, or null when the
 * caller is authorized to proceed with the hook's business logic.
 */
export function requireCronSecret(request: Request): Response | null {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 16) {
    // Fail-closed: do not run the hook if no secret is configured.
    return new Response("disabled", { status: 503 });
  }
  const got = request.headers.get(HEADER_NAME);
  if (!got || !safeEqual(got, expected)) {
    return new Response("forbidden", { status: 403 });
  }
  return null;
}
