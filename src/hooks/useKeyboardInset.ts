import { useEffect } from "react";

/**
 * Keep bottom action buttons reachable while the mobile soft keyboard is open
 * AND let global chrome (AppShell bottom nav) collapse so the keyboard does
 * not visually push the nav upward on iPhone.
 *
 * Strategy:
 *   - When visualViewport shrinks (keyboard opens), expose the missing height
 *     as `--keyboard-inset` on body, add body padding-bottom so content can
 *     scroll above the keyboard, and tag the body with `data-kb-open="true"`
 *     so CSS can hide fixed bottom chrome while the keyboard is up.
 *   - When the keyboard closes, all three side effects are reversed.
 *
 * No-op on desktop / browsers without visualViewport.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const apply = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.body.style.setProperty("--keyboard-inset", `${inset}px`);
      if (inset > 0) {
        document.body.style.paddingBottom = `${inset}px`;
        document.body.dataset.kbOpen = "true";
      } else {
        document.body.style.paddingBottom = "";
        delete document.body.dataset.kbOpen;
      }
    };

    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => {
      vv.removeEventListener("resize", apply);
      vv.removeEventListener("scroll", apply);
      document.body.style.paddingBottom = "";
      document.body.style.removeProperty("--keyboard-inset");
      delete document.body.dataset.kbOpen;
    };
  }, []);
}
