import { useEffect } from "react";

/**
 * Pointer-tracking layer for Malekhiv spotlight effect.
 *
 * Mirrors the reference 21st.dev GlowCard: writes pointer position AND its
 * normalised viewport ratio into CSS vars on <html>. The ratio (--xp / --yp)
 * is what drives the hue shift across the colour spectrum, so the spotlight
 * walks through blue → purple → red → orange as the cursor moves horizontally.
 *
 *   --mlk-x  : pointer X in CSS pixels (viewport coords)
 *   --mlk-y  : pointer Y in CSS pixels
 *   --mlk-xp : pointer X as 0..1 ratio of viewport width
 *   --mlk-yp : pointer Y as 0..1 ratio of viewport height
 *
 * One global listener (cheap), rAF-throttled. The glow itself is drawn
 * purely in CSS — see body[data-branch-test="malekhiv"] block in styles.css.
 * Respects prefers-reduced-motion.
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
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      root.style.setProperty("--mlk-x", nx.toFixed(0));
      root.style.setProperty("--mlk-y", ny.toFixed(0));
      root.style.setProperty("--mlk-xp", (nx / w).toFixed(3));
      root.style.setProperty("--mlk-yp", (ny / h).toFixed(3));
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
      root.style.removeProperty("--mlk-xp");
      root.style.removeProperty("--mlk-yp");
    };
  }, []);

  return null;
}
