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
    let nx = window.innerWidth / 2;
    let ny = window.innerHeight / 2;

    const setVar = (name: string, value: string) =>
      overlay.style.setProperty(name, value);

    const flush = () => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      const xp = nx / w;
      const yp = ny / h;
      // GlowCard hue formula: base 220 (blue) + xp * 200 → blue → red sweep.
      const hue = 220 + xp * 200;
      setVar("--x", nx.toFixed(2));
      setVar("--y", ny.toFixed(2));
      setVar("--xp", xp.toFixed(3));
      setVar("--yp", yp.toFixed(3));
      setVar("--hue", hue.toFixed(1));
      raf = 0;
    };

    const setOn = (on: boolean) => setVar("--spot-on", on ? "1" : "0");

    const updateFromEvent = (clientX: number, clientY: number) => {
      nx = clientX;
      ny = clientY;
      setOn(true);
      if (!raf) raf = window.requestAnimationFrame(flush);
    };

    const onPointerMove = (e: PointerEvent) =>
      updateFromEvent(e.clientX, e.clientY);
    const onPointerDown = (e: PointerEvent) =>
      updateFromEvent(e.clientX, e.clientY);
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      updateFromEvent(t.clientX, t.clientY);
    };

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
    // Visible from the start so the user immediately sees the effect; the
    // pointer events below keep it tracking afterwards.
    setOn(true);

    document.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("resize", updateZone);
    window.addEventListener("scroll", updateZone, true);

    const ro = new ResizeObserver(updateZone);
    document
      .querySelectorAll("header, nav.fixed.bottom-0")
      .forEach((el) => ro.observe(el));

    return () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("touchmove", onTouchMove);
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
