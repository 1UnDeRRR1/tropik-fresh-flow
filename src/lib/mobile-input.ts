// Mobile keyboard helpers for shipment / product entry inputs.
// Scope: presentation-only. No business logic, no validation changes.

import type { FocusEvent, KeyboardEvent } from "react";

const SCROLL_DELAY_MS = 280; // wait for iOS keyboard to start appearing

function readPxVar(el: HTMLElement, name: string, fallback: number) {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw.replace("px", ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function scrollWithinContainer(container: HTMLElement, el: HTMLElement) {
  const containerRect = container.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const vv = window.visualViewport;

  const topPad = readPxVar(container, "--mobile-focus-top-offset", 52) + 8;
  const bottomPad = readPxVar(container, "--mobile-focus-bottom-offset", 24) + 8;
  const viewportBottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
  const visibleTop = containerRect.top + topPad;
  const visibleBottom = Math.min(containerRect.bottom, viewportBottom) - bottomPad;

  let nextTop = container.scrollTop;
  if (rect.top < visibleTop) {
    nextTop += rect.top - visibleTop;
  } else if (rect.bottom > visibleBottom) {
    nextTop += rect.bottom - visibleBottom;
  }

  const leftPad = 8;
  const rightPad = 12;
  let nextLeft = container.scrollLeft;
  if (rect.left < containerRect.left + leftPad) {
    nextLeft += rect.left - (containerRect.left + leftPad);
  } else if (rect.right > containerRect.right - rightPad) {
    nextLeft += rect.right - (containerRect.right - rightPad);
  }

  container.scrollTo({
    top: Math.max(0, nextTop),
    left: Math.max(0, nextLeft),
    behavior: "smooth",
  });
}

/**
 * Scroll a freshly-focused input only when it is actually obscured by the
 * keyboard, the AppShell top header, or page chrome. When the field is
 * already comfortably visible, do NOT scroll — gratuitous scrollIntoView
 * was causing the whole page to jump on every focus/blur on iPhone.
 *
 * Safe to call on desktop — becomes a no-op when nothing is hidden.
 */
export function scrollFocusedIntoView<T extends HTMLElement>(el: T | null) {
  if (!el) return;
  window.setTimeout(() => {
    try {
      const container = el.closest("[data-mobile-scroll-container]") as HTMLElement | null;
      if (container) {
        scrollWithinContainer(container, el);
        return;
      }
      const rect = el.getBoundingClientRect();
      const vv = typeof window !== "undefined" ? window.visualViewport : null;
      const viewportTop = vv ? vv.offsetTop : 0;
      const viewportBottom = vv ? vv.height + vv.offsetTop : window.innerHeight;
      // Treat AppShell mobile header as ~96px tall (banner) for the safe zone.
      const topSafe = viewportTop + 96;
      const bottomSafe = viewportBottom - 24;
      const obscuredTop = rect.top < topSafe;
      const obscuredBottom = rect.bottom > bottomSafe;
      if (!obscuredTop && !obscuredBottom) return;
      // Use "nearest" so we shift the page by the minimum amount needed.
      el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
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
