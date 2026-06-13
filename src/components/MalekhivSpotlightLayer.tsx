import { useEffect } from "react";

/**
 * Pointer-tracking layer for Malekhiv "spotlight / glow" on contours.
 *
 * Writes the current pointer position (in CSS pixels, viewport coords) into
 * `--mlk-x` / `--mlk-y` on <html>. The actual glow is drawn purely via CSS
 * (see `body[data-branch-test="malekhiv"]` block in `src/styles.css`) using
 * `background-attachment: fixed`, so the gradient is positioned in viewport
 * space without re-querying per-element rects on each move.
 *
 * One listener for the whole app — much cheaper than per-card listeners from
 * the reference `spotlight-card.tsx`. Respects `prefers-reduced-motion`.
 */
export function MalekhivSpotlightLayer() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const root = document.documentElement;
    let raf = 0;
    let nx = 0;
    let ny = 0;

    const flush = () => {
      root.style.setProperty("--mlk-x", nx.toFixed(0));
      root.style.setProperty("--mlk-y", ny.toFixed(0));
      raf = 0;
    };

    const handle = (e: PointerEvent) => {
      nx = e.clientX;
      ny = e.clientY;
      if (raf) return;
      raf = window.requestAnimationFrame(flush);
    };

    document.addEventListener("pointermove", handle, { passive: true });
    document.addEventListener("pointerdown", handle, { passive: true });

    return () => {
      document.removeEventListener("pointermove", handle);
      document.removeEventListener("pointerdown", handle);
      if (raf) window.cancelAnimationFrame(raf);
      root.style.removeProperty("--mlk-x");
      root.style.removeProperty("--mlk-y");
    };
  }, []);

  return null;
}
