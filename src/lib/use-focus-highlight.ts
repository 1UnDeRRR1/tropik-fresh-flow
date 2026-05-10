import { useEffect } from "react";

/**
 * Reads `?focus=<id>&level=red|yellow|blue` from the current URL and, when an
 * element with `data-focus-id="<id>"` exists in the DOM, scrolls it into view
 * and applies a temporary highlight ring matching the trigger severity.
 *
 * The hook re-runs whenever `deps` change, so call it after the data-bound
 * rows have rendered (pass the rendered list/array as a dep).
 */
export function useFocusHighlight(deps: ReadonlyArray<unknown> = []) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const focus = params.get("focus");
    const level = (params.get("level") || "red") as "red" | "yellow" | "blue";
    if (!focus) return;

    let attempts = 0;
    const tryFocus = () => {
      attempts++;
      const el = document.querySelector<HTMLElement>(
        `[data-focus-id~="${CSS.escape(focus)}"]`,
      );
      if (!el) {
        if (attempts < 20) setTimeout(tryFocus, 150);
        return;
      }
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const ringCls =
        level === "red"
          ? ["ring-2", "ring-destructive", "ring-offset-2", "ring-offset-background"]
          : level === "yellow"
            ? ["ring-2", "ring-warning", "ring-offset-2", "ring-offset-background"]
            : ["ring-2", "ring-info", "ring-offset-2", "ring-offset-background"];
      el.classList.add(...ringCls, "rounded-xl", "transition-shadow");
      const t = setTimeout(() => {
        el.classList.remove(...ringCls);
      }, 4000);
      return () => clearTimeout(t);
    };
    const id = setTimeout(tryFocus, 100);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
