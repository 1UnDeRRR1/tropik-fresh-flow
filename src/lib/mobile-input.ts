// Mobile keyboard helpers for shipment / product entry inputs.
// Scope: presentation-only. No business logic, no validation changes.

import type { FocusEvent, KeyboardEvent } from "react";

const SCROLL_DELAY_MS = 280; // wait for iOS keyboard to start appearing

/**
 * Scroll a freshly-focused input above the on-screen keyboard.
 * Safe to call on desktop — scrollIntoView is a no-op when already visible.
 */
export function scrollFocusedIntoView<T extends HTMLElement>(el: T | null) {
  if (!el) return;
  window.setTimeout(() => {
    try {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    } catch {
      /* noop */
    }
  }, SCROLL_DELAY_MS);
}

/** Combine with existing onFocus: keeps caret select() behavior. */
export function mobileOnFocus<T extends HTMLInputElement | HTMLTextAreaElement>(
  e: FocusEvent<T>,
) {
  scrollFocusedIntoView(e.currentTarget);
}

/**
 * Enter / NumpadEnter → blur the field so the OS keyboard closes cleanly
 * and the row commits its value without trapping the user.
 */
export function blurOnEnter<T extends HTMLInputElement | HTMLTextAreaElement>(
  e: KeyboardEvent<T>,
) {
  if (e.key === "Enter" || e.key === "NumpadEnter") {
    e.preventDefault();
    e.currentTarget.blur();
  }
}

/** iOS "Done" / Android check key on the soft keyboard. */
export const MOBILE_ENTER_KEY_HINT = "done" as const;
