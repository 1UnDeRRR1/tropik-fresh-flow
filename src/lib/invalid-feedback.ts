// Build 2A.8 — visual + haptic feedback for invalid dictionary inputs on
// /shipments/new. Used by AutocompleteCell, InlineAutocomplete wrappers and
// the create-screen card to:
//   - flash a 3-blink red ring on the field;
//   - shake the screen briefly;
//   - vibrate the device when supported.
// All side effects are best-effort; never throws into the UI.

export function triggerInvalidFeedback(el?: HTMLElement | null): void {
  try {
    if (el) {
      el.classList.remove("tropik-field-flash");
      // Force reflow so the same animation can restart immediately.
      void el.offsetWidth;
      el.classList.add("tropik-field-flash");
      window.setTimeout(() => el.classList.remove("tropik-field-flash"), 750);
    }
    if (typeof document !== "undefined") {
      const root = document.body;
      root.classList.remove("tropik-screen-shake");
      void root.offsetWidth;
      root.classList.add("tropik-screen-shake");
      window.setTimeout(() => root.classList.remove("tropik-screen-shake"), 450);
    }
    if (typeof navigator !== "undefined" && typeof (navigator as Navigator).vibrate === "function") {
      (navigator as Navigator).vibrate?.([40, 30, 40]);
    }
  } catch {
    /* no-op */
  }
}
