import { useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";

/**
 * Malekhiv-only Spotlight overlay (all tabs).
 *
 * Based on the Ruixen Spotlight-Card model (`@/components/ui/spotlight-card`):
 * the pointer drives `--x / --y / --xp / --yp / --hue` and a radial gradient
 * paints a colored highlight under the cursor. Adapted from a per-card
 * decoration into a fixed full-bleed overlay bounded vertically by the
 * profile header bottom and the bottom-nav top.
 *
 * Theme behaviour (CSS-driven, see `.malekhiv-profile-spotlight` in
 * `src/styles.css`):
 *  - Light theme — `mix-blend-mode: difference`, 100% intensity.
 *    Dark pixels (digits, letters, frames, buttons) light up in color
 *    when the spotlight passes over them.
 *  - Dark theme — `mix-blend-mode: screen`, 50% intensity. Light pixels
 *    (digits, letters, frames, buttons) light up in color.
 */
export function MalekhivProfileSpotlight() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();

  useEffect(() => {
    const overlay = overlayRef.current;
    if (typeof window === "undefined" || !overlay) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let nx = 0;
    let ny = 0;

    const setVar = (name: string, value: string) =>
      overlay.style.setProperty(name, value);

    const flush = () => {
      const xp = window.innerWidth ? nx / window.innerWidth : 0;
      const yp = window.innerHeight ? ny / window.innerHeight : 0;
      // Same hue formula as GlowCard: base + xp * spread.
      const base = 220;
      const spread = 280;
      const hue = base + xp * spread;
      setVar("--x", nx.toFixed(2));
      setVar("--y", ny.toFixed(2));
      setVar("--xp", xp.toFixed(3));
      setVar("--yp", yp.toFixed(3));
      setVar("--hue", hue.toFixed(1));
      raf = 0;
    };

    const setOn = (on: boolean) => setVar("--spot-on", on ? "1" : "0");

    const onPointerMove = (e: PointerEvent) => {
      nx = e.clientX;
      ny = e.clientY;
      setOn(true);
      if (!raf) raf = window.requestAnimationFrame(flush);
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      nx = t.clientX;
      ny = t.clientY;
      setOn(true);
      if (!raf) raf = window.requestAnimationFrame(flush);
    };
    const onLeave = () => setOn(false);

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
    setOn(false);

    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerdown", onPointerMove, { passive: true });
    document.addEventListener("pointerup", onLeave, { passive: true });
    document.addEventListener("pointercancel", onLeave, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchend", onLeave, { passive: true });
    document.addEventListener("touchcancel", onLeave, { passive: true });
    window.addEventListener("resize", updateZone);
    window.addEventListener("scroll", updateZone, true);

    const ro = new ResizeObserver(updateZone);
    document
      .querySelectorAll("header, nav.fixed.bottom-0")
      .forEach((el) => ro.observe(el));

    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerdown", onPointerMove);
      document.removeEventListener("pointerup", onLeave);
      document.removeEventListener("pointercancel", onLeave);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onLeave);
      document.removeEventListener("touchcancel", onLeave);
      window.removeEventListener("resize", updateZone);
      window.removeEventListener("scroll", updateZone, true);
      ro.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
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
