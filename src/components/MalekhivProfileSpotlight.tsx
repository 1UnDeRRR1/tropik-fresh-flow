import { useEffect, useRef } from "react";
import { useTheme } from "@/lib/theme";

/**
 * Malekhiv-only spotlight for the Profile (/settings) page.
 *
 * Behaviour:
 *  - Fixed overlay bounded vertically between the bottom of the profile
 *    header and the top of the bottom nav (the visible content zone).
 *  - Follows pointer / finger; white radial gradient with
 *    `mix-blend-mode: lighten` so dark pixels (digits, letters, borders)
 *    light up when the spotlight passes over them, while already-light
 *    surfaces stay unchanged.
 *  - Light theme: 100% effect intensity.
 *  - Dark theme: 50% effect intensity (still highlights dark contours
 *    on dark background, but softer).
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

    const setVar = (name: string, value: string) => overlay.style.setProperty(name, value);

    const flush = () => {
      setVar("--sx", `${nx.toFixed(0)}px`);
      setVar("--sy", `${ny.toFixed(0)}px`);
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
      const top = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
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
    document.querySelectorAll("header, nav.fixed.bottom-0").forEach((el) => ro.observe(el));

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
