import { useEffect } from "react";

/**
 * Keep bottom action buttons reachable while the mobile soft keyboard is open.
 *
 * Strategy: when visualViewport shrinks (keyboard opens), push the body up by
 * the missing pixels via padding-bottom. When keyboard closes, padding is removed.
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
      } else {
        document.body.style.paddingBottom = "";
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
    };
  }, []);
}
