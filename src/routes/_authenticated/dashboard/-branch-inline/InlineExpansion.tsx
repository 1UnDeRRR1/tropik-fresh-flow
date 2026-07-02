import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./inline-expansion.css";

/**
 * Block 1 — Malekhiv Головна inline expansion panel.
 *
 * Owns the height animation for L2/L3 under a compact L1 row.
 *
 * Phase machine (driven by host):
 *   - "opening" → mount, height 0 → scrollHeight → "auto"
 *   - "open"    → height "auto", ResizeObserver keeps it synced
 *   - "closing" → height current → 0, then onClosed()
 *
 * Level swap (L2 → L3) is a two-step within an "open" phase:
 *   fade content out → height → 0 → swap → grow to new scrollHeight → fade in.
 *
 * No fixed height, no max-height, no internal scroll container. All strict
 * scope styles live in ./inline-expansion.css.
 */
export function InlineExpansion({
  phase,
  level,
  children,
  onOpened,
  onClosed,
  onSwapped,
}: {
  phase: "opening" | "open" | "closing";
  /** Current level shown; used only to trigger the two-step swap when it changes. */
  level: "l2" | "l3";
  children: React.ReactNode;
  onOpened?: () => void;
  onClosed?: () => void;
  /** Fired after the two-step L2↔L3 swap re-expands. */
  onSwapped?: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [renderedLevel, setRenderedLevel] = useState(level);
  const [isSwapping, setIsSwapping] = useState(false);
  const swapTimerRef = useRef<number | null>(null);
  const closingSafetyRef = useRef<number | null>(null);

  // --- Opening: mount at 0, expand to inner scrollHeight, then unlock to auto.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const inner = innerRef.current;
    if (!panel || !inner) return;
    if (phase !== "opening") return;

    panel.style.height = "0px";
    // rAF so the browser registers the 0 → target transition.
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
  }, [phase, onOpened]);

  // --- Closing: from current computed height → 0.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (phase !== "closing") return;

    const current = panel.getBoundingClientRect().height;
    panel.style.height = `${current}px`;
    // Force a reflow so the transition picks up the change from auto → px.
    void panel.offsetHeight;
    requestAnimationFrame(() => {
      panel.style.height = "0px";
    });

    const finish = () => {
      if (closingSafetyRef.current) {
        window.clearTimeout(closingSafetyRef.current);
        closingSafetyRef.current = null;
      }
      panel.removeEventListener("transitionend", onEnd);
      onClosed?.();
    };
    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== "height") return;
      finish();
    };
    panel.addEventListener("transitionend", onEnd);
    // Safety-net for missed transitionend (hidden tab / reduced motion).
    closingSafetyRef.current = window.setTimeout(finish, 380);
    return () => {
      panel.removeEventListener("transitionend", onEnd);
      if (closingSafetyRef.current) {
        window.clearTimeout(closingSafetyRef.current);
        closingSafetyRef.current = null;
      }
    };
  }, [phase, onClosed]);

  // --- Level swap: two-step animation. Only runs while "open".
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

    const swapDelay = 180;
    swapTimerRef.current = window.setTimeout(() => {
      setRenderedLevel(level);
      // After content swap, wait a tick for inner to measure the new content.
      requestAnimationFrame(() => {
        const inner = innerRef.current;
        if (!inner || !panel) return;
        panel.style.height = `${inner.scrollHeight}px`;
        const onEnd = (e: TransitionEvent) => {
          if (e.propertyName !== "height") return;
          panel.style.height = "auto";
          setIsSwapping(false);
          panel.removeEventListener("transitionend", onEnd);
          onSwapped?.();
        };
        panel.addEventListener("transitionend", onEnd);
      });
    }, swapDelay);

    return () => {
      if (swapTimerRef.current) {
        window.clearTimeout(swapTimerRef.current);
        swapTimerRef.current = null;
      }
    };
  }, [level, renderedLevel, phase, onSwapped]);

  // --- ResizeObserver: keep panel synced with inner content growth while open.
  useEffect(() => {
    if (phase !== "open") return;
    if (isSwapping) return;
    const panel = panelRef.current;
    const inner = innerRef.current;
    if (!panel || !inner || typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver(() => {
      if (!panel || !inner) return;
      // Only nudge when auto — during transitions we leave height alone.
      if (panel.style.height === "auto") return;
      panel.style.height = `${inner.scrollHeight}px`;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [phase, isSwapping]);

  return (
    <div
      ref={panelRef}
      data-branch-inline-expansion=""
      data-swap={isSwapping ? "fading" : undefined}
      aria-hidden={phase === "closing" ? "true" : undefined}
    >
      <div ref={innerRef} className="bie-inner">
        <div className="bie-swap">
          {renderedLevel === level ? children : null}
        </div>
      </div>
    </div>
  );
}
