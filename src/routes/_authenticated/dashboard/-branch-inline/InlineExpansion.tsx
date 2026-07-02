import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./inline-expansion.css";

/**
 * Block 1 — Malekhiv Головна inline expansion panel.
 *
 * Owns the height animation for L2/L3 under a compact L1 row.
 *
 * Phases (driven by host):
 *   - "open"    → mount runs 0 → scrollHeight → "auto"; then live in auto.
 *   - "closing" → animate current height → 0, then onClosed().
 *
 * Level swap (L2 ↔ L3) is a two-step within "open":
 *   current px → 0 → swap content → new scrollHeight → auto.
 *
 * No fixed height, no max-height, no internal scroll container.
 * Strict-scope styles live in ./inline-expansion.css.
 */
export function InlineExpansion({
  phase,
  level,
  l2Content,
  l3Content,
  onOpened,
  onClosed,
}: {
  phase: "open" | "closing";
  level: "l2" | "l3";
  l2Content: React.ReactNode;
  l3Content: React.ReactNode;
  onOpened?: () => void;
  onClosed?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [renderedLevel, setRenderedLevel] = useState(level);
  const [isSwapping, setIsSwapping] = useState(false);
  const swapTimerRef = useRef<number | null>(null);
  const safetyRef = useRef<number | null>(null);
  const openedOnce = useRef(false);

  // Mount / open: animate 0 → auto exactly once per mount.
  useLayoutEffect(() => {
    if (openedOnce.current) return;
    openedOnce.current = true;
    const panel = panelRef.current;
    const inner = innerRef.current;
    if (!panel || !inner) return;

    panel.style.height = "0px";
    const raf = requestAnimationFrame(() => {
      panel.style.height = `${inner.scrollHeight}px`;
    });
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== "height") return;
      panel.style.height = "auto";
      panel.removeEventListener("transitionend", onEnd);
      onOpened?.();
    };
    panel.addEventListener("transitionend", onEnd);
    return () => {
      cancelAnimationFrame(raf);
      panel.removeEventListener("transitionend", onEnd);
    };
  }, [onOpened]);

  // Closing: current height → 0.
  useLayoutEffect(() => {
    if (phase !== "closing") return;
    const panel = panelRef.current;
    if (!panel) return;

    const current = panel.getBoundingClientRect().height;
    panel.style.height = `${current}px`;
    void panel.offsetHeight;
    requestAnimationFrame(() => {
      panel.style.height = "0px";
    });

    const finish = () => {
      if (safetyRef.current) {
        window.clearTimeout(safetyRef.current);
        safetyRef.current = null;
      }
      panel.removeEventListener("transitionend", onEnd);
      onClosed?.();
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== "height") return;
      finish();
    };
    panel.addEventListener("transitionend", onEnd);
    safetyRef.current = window.setTimeout(finish, 380);
    return () => {
      panel.removeEventListener("transitionend", onEnd);
      if (safetyRef.current) {
        window.clearTimeout(safetyRef.current);
        safetyRef.current = null;
      }
    };
  }, [phase, onClosed]);

  // Level swap: two-step animation while "open".
  useEffect(() => {
    if (phase !== "open") return;
    if (level === renderedLevel) return;
    const panel = panelRef.current;
    if (!panel) return;

    const current = panel.getBoundingClientRect().height;
    panel.style.height = `${current}px`;
    void panel.offsetHeight;
    setIsSwapping(true);
    requestAnimationFrame(() => {
      panel.style.height = "0px";
    });

    swapTimerRef.current = window.setTimeout(() => {
      setRenderedLevel(level);
      requestAnimationFrame(() => {
        const inner = innerRef.current;
        if (!inner || !panel) return;
        panel.style.height = `${inner.scrollHeight}px`;
        const onEnd = (e: TransitionEvent) => {
          if (e.propertyName !== "height") return;
          panel.style.height = "auto";
          setIsSwapping(false);
          panel.removeEventListener("transitionend", onEnd);
        };
        panel.addEventListener("transitionend", onEnd);
      });
    }, 180);

    return () => {
      if (swapTimerRef.current) {
        window.clearTimeout(swapTimerRef.current);
        swapTimerRef.current = null;
      }
    };
  }, [level, renderedLevel, phase]);

  return (
    <div
      ref={panelRef}
      data-branch-inline-expansion=""
      data-swap={isSwapping ? "fading" : undefined}
      aria-hidden={phase === "closing" ? "true" : undefined}
    >
      <div ref={innerRef} className="bie-inner">
        <div className="bie-swap">
          {renderedLevel === "l2" ? l2Content : l3Content}
        </div>
      </div>
    </div>
  );
}
