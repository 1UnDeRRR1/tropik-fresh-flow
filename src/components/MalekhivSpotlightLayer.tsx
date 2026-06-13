import { useEffect, useState } from "react";

/**
 * Pointer-tracking spotlight for Malekhiv.
 *
 * Behaviour (mirrors the reference GlowCard / user video):
 *  - Spotlight follows the pointer/finger continuously while it is moving
 *    OR while a touch is held — not only on initial tap.
 *  - Visible on every tab, even pages without `.bg-card` / `.branch-table-wrap`,
 *    because we render a global fixed overlay that draws the glow at the
 *    pointer position.
 *  - Card borders additionally light up via the CSS ring (see styles.css),
 *    so the same light source illuminates both the area around the finger
 *    and any contour it passes over.
 *
 * CSS vars written on <html>:
 *   --mlk-x / --mlk-y     pointer position in CSS px (viewport coords)
 *   --mlk-xp / --mlk-yp   same as 0..1 ratio of viewport
 *   --mlk-on              1 while active (pointer down on touch, or hovering on mouse), else 0
 */
export function MalekhivSpotlightLayer() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setMounted(true);

    const root = document.documentElement;
    let raf = 0;
    let nx = window.innerWidth / 2;
    let ny = window.innerHeight / 2;
    let touchActive = false;
    let hasMouse = false;

    const flush = () => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      root.style.setProperty("--mlk-x", nx.toFixed(0));
      root.style.setProperty("--mlk-y", ny.toFixed(0));
      root.style.setProperty("--mlk-xp", (nx / w).toFixed(3));
      root.style.setProperty("--mlk-yp", (ny / h).toFixed(3));
      raf = 0;
    };

    const setOn = (on: boolean) => {
      root.style.setProperty("--mlk-on", on ? "1" : "0");
    };

    const updateFromEvent = (clientX: number, clientY: number) => {
      nx = clientX;
      ny = clientY;
      if (!raf) raf = window.requestAnimationFrame(flush);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse") {
        hasMouse = true;
        setOn(true);
      }
      updateFromEvent(e.clientX, e.clientY);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") {
        touchActive = true;
        setOn(true);
      }
      updateFromEvent(e.clientX, e.clientY);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") {
        touchActive = false;
        setOn(false);
      }
    };

    // Touch fallback for iOS where pointermove can be throttled during scroll.
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      touchActive = true;
      setOn(true);
      updateFromEvent(t.clientX, t.clientY);
    };
    const onTouchEnd = () => {
      touchActive = false;
      setOn(false);
    };

    const onPointerLeave = () => {
      if (hasMouse && !touchActive) setOn(false);
    };

    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("pointerup", onPointerUp, { passive: true });
    document.addEventListener("pointercancel", onPointerUp, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true });
    window.addEventListener("blur", onPointerLeave);
    document.addEventListener("mouseleave", onPointerLeave);

    flush();
    setOn(false);

    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
      document.removeEventListener("touchcancel", onTouchEnd);
      window.removeEventListener("blur", onPointerLeave);
      document.removeEventListener("mouseleave", onPointerLeave);
      if (raf) window.cancelAnimationFrame(raf);
      root.style.removeProperty("--mlk-x");
      root.style.removeProperty("--mlk-y");
      root.style.removeProperty("--mlk-xp");
      root.style.removeProperty("--mlk-yp");
      root.style.removeProperty("--mlk-on");
    };
  }, []);

  if (!mounted) return null;

  // Global overlay — draws the spotlight at the pointer on every page.
  return <div aria-hidden="true" className="malekhiv-spotlight-overlay" />;
}
