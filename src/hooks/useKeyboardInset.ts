import { useEffect } from "react";

/**
 * Keep bottom action buttons reachable while the mobile soft keyboard is
 * open AND let global chrome (AppShell bottom nav) collapse so the keyboard
 * does not visually push the nav upward on iPhone.
 *
 * Build /shipments/new mobile chrome stability:
 *   - The previous implementation toggled `body[data-kb-open]` purely from
 *     visualViewport size deltas. iOS Safari emits noisy resize/scroll
 *     events while the user scrolls a long form with the keyboard up, which
 *     made the flag flap on/off and produced bottom-nav flicker.
 *   - This version is hysteretic and primarily driven by DOM focus on
 *     editable elements:
 *       * focusin on an editable element → mark keyboard-open immediately;
 *       * focusout from the last editable element → schedule a close after
 *         a short grace period so brief focus jumps (input → autocomplete
 *         option → input) do not clear the flag;
 *       * visualViewport size only confirms the close; it never *opens*
 *         the flag on its own and never reverts it back to closed while a
 *         field still owns focus.
 *   - We also expose:
 *       --keyboard-inset  : px occluded by the keyboard (for safe padding);
 *       --vv-offset-top   : visualViewport.offsetTop (lets fixed top chrome
 *                           translate so it stays visible while iOS shifts
 *                           the visual viewport during keyboard-open scroll).
 *
 * No-op on desktop / browsers without visualViewport.
 */
export function useKeyboardInset() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;

    const isEditable = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      if (tag === "TEXTAREA") return true;
      if (tag === "SELECT") return true;
      if (tag === "INPUT") {
        const t = (el as HTMLInputElement).type;
        // Buttons/checkboxes/radios don't summon the keyboard.
        return !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file"].includes(t);
      }
      return false;
    };

    let editableFocused = false;
    let pendingClose = 0;

    const setKbOpen = (open: boolean) => {
      const body = document.body;
      if (open) {
        if (body.dataset.kbOpen !== "true") body.dataset.kbOpen = "true";
      } else if (body.dataset.kbOpen) {
        delete body.dataset.kbOpen;
      }
    };

    const applyInset = () => {
      if (!vv) {
        // No visualViewport — focus alone drives kb-open; assume small inset.
        document.body.style.setProperty("--keyboard-inset", "0px");
        document.body.style.setProperty("--vv-offset-top", "0px");
        return;
      }
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.body.style.setProperty("--keyboard-inset", `${inset}px`);
      document.body.style.setProperty("--vv-offset-top", `${Math.max(0, Math.round(vv.offsetTop))}px`);
      if (inset > 0) {
        document.body.style.paddingBottom = `${inset}px`;
      } else {
        document.body.style.paddingBottom = "";
      }
      // Confirm-close path: viewport returned to full AND no editable focus.
      if (!editableFocused && inset === 0) {
        if (pendingClose) {
          window.clearTimeout(pendingClose);
          pendingClose = 0;
        }
        setKbOpen(false);
      }
    };

    const onFocusIn = (e: FocusEvent) => {
      if (!isEditable(e.target)) return;
      editableFocused = true;
      if (pendingClose) {
        window.clearTimeout(pendingClose);
        pendingClose = 0;
      }
      setKbOpen(true);
      applyInset();
    };

    const onFocusOut = () => {
      // Defer: wait one microtask + grace period for refocus.
      window.setTimeout(() => {
        const active = document.activeElement;
        editableFocused = isEditable(active);
        if (editableFocused) return;
        if (pendingClose) window.clearTimeout(pendingClose);
        pendingClose = window.setTimeout(() => {
          pendingClose = 0;
          // Only close if focus is still not on an editable AND keyboard
          // really retreated (or no visualViewport to confirm).
          const stillNoFocus = !isEditable(document.activeElement);
          const noInset = !vv || Math.max(0, window.innerHeight - vv.height - vv.offsetTop) <= 1;
          if (stillNoFocus && noInset) setKbOpen(false);
        }, 220);
      }, 0);
    };

    applyInset();
    vv?.addEventListener("resize", applyInset);
    vv?.addEventListener("scroll", applyInset);
    window.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("focusout", onFocusOut, true);

    return () => {
      vv?.removeEventListener("resize", applyInset);
      vv?.removeEventListener("scroll", applyInset);
      window.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("focusout", onFocusOut, true);
      if (pendingClose) window.clearTimeout(pendingClose);
      document.body.style.paddingBottom = "";
      document.body.style.removeProperty("--keyboard-inset");
      document.body.style.removeProperty("--vv-offset-top");
      delete document.body.dataset.kbOpen;
    };
  }, []);
}
