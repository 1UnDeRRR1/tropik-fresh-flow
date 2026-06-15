import { useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";

/**
 * Malekhiv-only Spotlight-Card overlay (all tabs).
 *
 * Based on the Ruixen Spotlight-Card model (`@/components/ui/spotlight-card`):
 * the pointer drives `--x / --y / --xp / --yp / --hue` and a radial gradient
 * paints a colored highlight under the cursor. Adapted from a per-card
 * decoration into a fixed full-bleed overlay bounded vertically by the
 * profile header bottom and the bottom-nav top.
 *
 * Selective reactivity is achieved with CSS `mix-blend-mode`:
 *  - Light theme — `lighten`, 100% intensity. Formula `max(base, blend)`:
 *    light pixels (page background) stay unchanged, dark pixels (digits,
 *    letters, frames, buttons) are replaced by the spotlight color → only
 *    dark stuff lights up.
 *  - Dark theme — `darken`, 50% intensity. Formula `min(base, blend)`:
 *    dark pixels (page background) stay unchanged, light pixels (digits,
 *    letters, frames, buttons) are pulled down to the spotlight color →
 *    only light stuff reacts.
 */
export function MalekhivProfileSpotlight() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();

  useEffect(() => {
    const overlay = overlayRef.current;
    if (typeof window === "undefined" || !overlay) return;

    let raf = 0;
    let viewportX = window.innerWidth / 2;
    let viewportY = window.innerHeight / 2;
    let localX = window.innerWidth / 2;
    let localY = window.innerHeight / 2;
    let offTimer = 0;

    const root = document.documentElement;
    const setVar = (name: string, value: string) => {
      overlay.style.setProperty(name, value);
      root.style.setProperty(`--mlk-profile-${name.slice(2)}`, value);
    };

    const flush = () => {
      const rect = overlay.getBoundingClientRect();
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const xp = viewportX / w;
      const yp = viewportY / h;
      const insideZone =
        viewportY >= rect.top &&
        viewportY <= rect.bottom &&
        viewportX >= rect.left &&
        viewportX <= rect.right;
      // GlowCard hue formula: base 220 (blue) + xp * 200 → blue → red sweep.
      const hue = 220 + xp * 200;
      // CSS gradients are painted inside the bounded overlay, so mobile/touch
      // viewport coordinates must be converted to overlay-local coordinates.
      setVar("--x", localX.toFixed(2));
      setVar("--y", localY.toFixed(2));
      setVar("--xp", xp.toFixed(3));
      setVar("--yp", yp.toFixed(3));
      setVar("--hue", hue.toFixed(1));
      setOn(insideZone);
      raf = 0;
    };

    const setOn = (on: boolean) => setVar("--spot-on", on ? "1" : "0");
    const keepOnBriefly = () => {
      window.clearTimeout(offTimer);
      offTimer = window.setTimeout(() => setOn(false), 1800);
    };

    const updateFromEvent = (nextX: number, nextY: number) => {
      const rect = overlay.getBoundingClientRect();
      viewportX = Math.max(0, Math.min(window.innerWidth, nextX));
      viewportY = Math.max(0, Math.min(window.innerHeight, nextY));
      localX = Math.max(0, Math.min(rect.width, viewportX - rect.left));
      localY = Math.max(0, Math.min(rect.height, viewportY - rect.top));
      const insideZone =
        viewportY >= rect.top &&
        viewportY <= rect.bottom &&
        viewportX >= rect.left &&
        viewportX <= rect.right;
      // On mobile a tap can end before the next frame is painted. Flip the
      // opacity gate immediately, then let rAF update the gradient position.
      setOn(insideZone);
      if (!raf) raf = window.requestAnimationFrame(flush);
    };

    const onPointerMove = (e: PointerEvent) =>
      updateFromEvent(e.clientX, e.clientY);
    const onPointerDown = (e: PointerEvent) =>
      updateFromEvent(e.clientX, e.clientY);
    const onPointerUp = () => keepOnBriefly();
    const onPointerCancel = () => keepOnBriefly();
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      window.clearTimeout(offTimer);
      updateFromEvent(t.clientX, t.clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      window.clearTimeout(offTimer);
      updateFromEvent(t.clientX, t.clientY);
    };
    const onTouchEnd = () => keepOnBriefly();

    const updateZone = () => {
      const header = document.querySelector<HTMLElement>("header");
      const nav = document.querySelector<HTMLElement>("nav.fixed.bottom-0");
      const top = header
        ? Math.max(0, header.getBoundingClientRect().bottom)
        : 0;
      const bottom = nav
        ? Math.max(0, window.innerHeight - nav.getBoundingClientRect().top)
        : 0;
      overlay.style.top = `${top}px`;
      overlay.style.bottom = `${bottom}px`;
    };

    updateZone();
    flush();

    document.addEventListener("pointermove", onPointerMove, { passive: true, capture: true });
    document.addEventListener("pointerdown", onPointerDown, { passive: true, capture: true });
    document.addEventListener("pointerup", onPointerUp, { passive: true, capture: true });
    document.addEventListener("pointercancel", onPointerCancel, { passive: true, capture: true });
    document.addEventListener("touchstart", onTouchStart, { passive: true, capture: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
    document.addEventListener("touchend", onTouchEnd, { passive: true, capture: true });
    document.addEventListener("touchcancel", onTouchEnd, { passive: true, capture: true });
    window.addEventListener("resize", updateZone);
    window.addEventListener("scroll", updateZone, true);

    const ro = new ResizeObserver(updateZone);
    document
      .querySelectorAll("header, nav.fixed.bottom-0")
      .forEach((el) => ro.observe(el));

    return () => {
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("touchend", onTouchEnd, true);
      document.removeEventListener("touchcancel", onTouchEnd, true);
      window.removeEventListener("resize", updateZone);
      window.removeEventListener("scroll", updateZone, true);
      ro.disconnect();
      window.clearTimeout(offTimer);
      if (raf) window.cancelAnimationFrame(raf);
      ["x", "y", "xp", "yp", "hue", "spot-on"].forEach((name) => {
        root.style.removeProperty(`--mlk-profile-${name}`);
      });
    };
  }, []);

  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      className="malekhiv-profile-spotlight"
      data-mlk-profile-theme={resolved}
    />
  );
}
