import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefCallback,
  type RefObject,
} from "react";

export type MobileGlassActiveLevel = "l2" | "l3";

export interface UseMobileGlassExpansionOptions {
  rowIds: string[];
  trackRef: RefObject<HTMLDivElement | null>;
  topSnap: boolean;
  closeCurrentBeforeOpenNext: boolean;
  animationMs: number;
  closeLockMs: number;
  topOffsetPx: number;
  bottomOffsetPx: number;
  onOpenChange?: (rowId: string | null) => void;
}

export function useMobileGlassExpansion({
  rowIds,
  trackRef,
  topSnap,
  closeCurrentBeforeOpenNext,
  animationMs,
  closeLockMs,
  topOffsetPx,
  bottomOffsetPx,
  onOpenChange,
}: UseMobileGlassExpansionOptions) {
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [closingRowId, setClosingRowId] = useState<string | null>(null);
  const [activeLevel, setActiveLevelState] = useState<MobileGlassActiveLevel>("l2");

  const openRowIdRef = useRef<string | null>(null);
  const activeLevelRef = useRef<MobileGlassActiveLevel>("l2");
  const lockRef = useRef(false);
  const snapTimerRef = useRef<number | null>(null);

  const cardRefs = useRef(new Map<string, HTMLElement>());
  const panelRefs = useRef(new Map<string, HTMLDivElement>());
  const innerRefs = useRef(new Map<string, HTMLDivElement>());
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    openRowIdRef.current = openRowId;
  }, [openRowId]);

  useEffect(() => {
    activeLevelRef.current = activeLevel;
  }, [activeLevel]);

  useEffect(() => {
    return () => {
      if (snapTimerRef.current !== null) {
        window.clearTimeout(snapTimerRef.current);
      }
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
    };
  }, []);

  const registerCard = useCallback(
    (rowId: string): RefCallback<HTMLElement> =>
      (node) => {
        if (node) cardRefs.current.set(rowId, node);
        else cardRefs.current.delete(rowId);
      },
    [],
  );

  const registerPanel = useCallback(
    (rowId: string): RefCallback<HTMLDivElement> =>
      (node) => {
        if (node) panelRefs.current.set(rowId, node);
        else panelRefs.current.delete(rowId);
      },
    [],
  );

  const registerInner = useCallback(
    (rowId: string): RefCallback<HTMLDivElement> =>
      (node) => {
        if (node) innerRefs.current.set(rowId, node);
        else innerRefs.current.delete(rowId);
      },
    [],
  );

  const alignCardBottomToTrack = useCallback(
    (rowId: string) => {
      const track = trackRef.current;
      const card = cardRefs.current.get(rowId);
      if (!track || !card) return;

      const cardRect = card.getBoundingClientRect();
      const trackRect = track.getBoundingClientRect();

      const overlap = cardRect.bottom - (trackRect.bottom - bottomOffsetPx);
      if (overlap <= 0) return;

      track.scrollBy({
        top: overlap + 2,
        behavior: "smooth",
      });
    },
    [bottomOffsetPx, trackRef],
  );

  // Manual remeasure — sync the panel height to current inner content.
  // Safe to call while lockRef is true; skipped if row isn't open.
  const requestMeasure = useCallback(() => {
    const rowId = openRowIdRef.current;
    if (!rowId) return;
    const panel = panelRefs.current.get(rowId);
    const inner = innerRefs.current.get(rowId);
    if (!panel || !inner) return;
    if (lockRef.current) return;
    panel.style.height = `${inner.scrollHeight}px`;
  }, []);

  // ResizeObserver on the active inner keeps panel height synced to content
  // growth (async data, form state, keyboard). Attached in the open effect.
  const ensureObserver = useCallback(() => {
    if (resizeObserverRef.current) return resizeObserverRef.current;
    if (typeof ResizeObserver === "undefined") return null;
    const ro = new ResizeObserver(() => {
      requestMeasure();
    });
    resizeObserverRef.current = ro;
    return ro;
  }, [requestMeasure]);

  useLayoutEffect(() => {
    if (!openRowId) return;

    const panel = panelRefs.current.get(openRowId);
    const inner = innerRefs.current.get(openRowId);
    if (!panel || !inner) {
      lockRef.current = false;
      return;
    }

    // Start from current height (0 on first open, prev height on level swap)
    // — do NOT reset to 0 here, or level-swap animation flashes.
    // For a fresh open, browser already reports 0. For a level swap, the
    // caller set height to 0 explicitly before triggering the re-render.

    const observer = ensureObserver();
    observer?.observe(inner);

    const unlockFallback = window.setTimeout(() => {
      lockRef.current = false;
    }, animationMs + 80);

    const onTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName !== "height") return;
      if (openRowIdRef.current !== openRowId) return;
      panel.style.height = "auto";
      lockRef.current = false;
      window.clearTimeout(unlockFallback);
    };

    panel.addEventListener("transitionend", onTransitionEnd);

    window.requestAnimationFrame(() => {
      panel.style.height = `${inner.scrollHeight}px`;
    });

    window.setTimeout(() => {
      alignCardBottomToTrack(openRowId);
    }, Math.max(0, animationMs - 10));

    return () => {
      panel.removeEventListener("transitionend", onTransitionEnd);
      window.clearTimeout(unlockFallback);
      observer?.unobserve(inner);
    };
    // activeLevel is intentionally a dep so level swap re-runs this effect
  }, [alignCardBottomToTrack, animationMs, ensureObserver, openRowId, activeLevel]);

  const openCard = useCallback(
    (rowId: string, level: MobileGlassActiveLevel = "l2") => {
      lockRef.current = true;
      setClosingRowId(null);
      setActiveLevelState(level);
      activeLevelRef.current = level;
      setOpenRowId(rowId);
      onOpenChange?.(rowId);
    },
    [onOpenChange],
  );

  const closeCardInternal = useCallback(
    (rowId: string, resetLevel = true) => {
      const panel = panelRefs.current.get(rowId);

      lockRef.current = true;
      setClosingRowId(rowId);
      setOpenRowId(null);
      onOpenChange?.(null);

      if (!panel) {
        window.setTimeout(() => {
          setClosingRowId(null);
          if (resetLevel) {
            setActiveLevelState("l2");
            activeLevelRef.current = "l2";
          }
          lockRef.current = false;
        }, closeLockMs);
        return;
      }

      const inner = innerRefs.current.get(rowId);
      panel.style.height = `${(inner ?? panel).scrollHeight}px`;

      window.requestAnimationFrame(() => {
        panel.style.height = "0px";
      });

      window.setTimeout(() => {
        setClosingRowId(null);
        panel.style.height = "";
        if (resetLevel) {
          setActiveLevelState("l2");
          activeLevelRef.current = "l2";
        }
        lockRef.current = false;
      }, closeLockMs);
    },
    [closeLockMs, onOpenChange],
  );

  const handleCardClick = useCallback(
    (rowId: string) => {
      if (lockRef.current) return;

      const currentOpen = openRowIdRef.current;

      if (currentOpen === rowId) {
        closeCardInternal(rowId);
        return;
      }

      if (currentOpen && currentOpen !== rowId) {
        closeCardInternal(currentOpen);
        if (closeCurrentBeforeOpenNext) return;
      }

      openCard(rowId, "l2");
    },
    [closeCardInternal, closeCurrentBeforeOpenNext, openCard],
  );

  // Two-step level transition: collapse to 0, swap content, expand.
  const switchLevel = useCallback(
    (rowId: string, next: MobileGlassActiveLevel) => {
      if (activeLevelRef.current === next) return;
      const panel = panelRefs.current.get(rowId);
      const inner = innerRefs.current.get(rowId);
      if (!panel || !inner) {
        setActiveLevelState(next);
        activeLevelRef.current = next;
        return;
      }
      lockRef.current = true;

      panel.style.height = `${inner.scrollHeight}px`;
      window.requestAnimationFrame(() => {
        panel.style.height = "0px";
      });

      const swapMs = Math.max(120, Math.floor(animationMs * 0.55));
      window.setTimeout(() => {
        setActiveLevelState(next);
        activeLevelRef.current = next;
        // The open effect re-runs on activeLevel change and animates 0 -> new scrollHeight.
      }, swapMs);
    },
    [animationMs],
  );

  const openLevelThree = useCallback(
    (rowId: string) => {
      if (openRowIdRef.current !== rowId) {
        openCard(rowId, "l3");
        return;
      }
      switchLevel(rowId, "l3");
    },
    [openCard, switchLevel],
  );

  const closeLevelThree = useCallback(
    (rowId: string) => {
      if (openRowIdRef.current !== rowId) return;
      switchLevel(rowId, "l2");
    },
    [switchLevel],
  );

  const closeCardPublic = useCallback(
    (rowId: string) => {
      if (openRowIdRef.current !== rowId) return;
      closeCardInternal(rowId);
    },
    [closeCardInternal],
  );

  const snapNearestTopCard = useCallback(() => {
    if (!topSnap) return;
    if (lockRef.current || openRowIdRef.current) return;

    const track = trackRef.current;
    if (!track) return;

    const trackRect = track.getBoundingClientRect();
    const topCut = trackRect.top + topOffsetPx;
    const bottomCut = trackRect.bottom - bottomOffsetPx;

    let bestDelta = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const rowId of rowIds) {
      const card = cardRefs.current.get(rowId);
      if (!card) continue;

      const rect = card.getBoundingClientRect();
      const visible = rect.bottom > topCut + 1 && rect.top < bottomCut - 1;
      if (!visible) continue;

      const delta = rect.top - topCut;
      const distance = Math.abs(delta);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestDelta = delta;
      }
    }

    if (Number.isFinite(bestDistance) && Math.abs(bestDelta) > 2) {
      track.scrollBy({
        top: bestDelta,
        behavior: "smooth",
      });
    }
  }, [bottomOffsetPx, rowIds, topOffsetPx, topSnap, trackRef]);

  const handleScroll = useCallback(() => {
    if (!topSnap) return;
    if (lockRef.current || openRowIdRef.current) return;

    if (snapTimerRef.current !== null) {
      window.clearTimeout(snapTimerRef.current);
    }

    snapTimerRef.current = window.setTimeout(() => {
      snapNearestTopCard();
    }, 90);
  }, [snapNearestTopCard, topSnap]);

  const openIndex = openRowId ? rowIds.indexOf(openRowId) : -1;
  const neighborRowIds = new Set<string>();

  if (openIndex > -1) {
    const previous = rowIds[openIndex - 1];
    const next = rowIds[openIndex + 1];

    if (previous) neighborRowIds.add(previous);
    if (next) neighborRowIds.add(next);
  }

  return {
    openRowId,
    closingRowId,
    activeLevel,
    neighborRowIds,
    registerCard,
    registerPanel,
    registerInner,
    handleCardClick,
    handleScroll,
    openLevelThree,
    closeLevelThree,
    closeCard: closeCardPublic,
    requestMeasure,
  };
}
