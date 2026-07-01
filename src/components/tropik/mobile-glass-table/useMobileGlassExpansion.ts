import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefCallback,
  type RefObject,
} from "react";

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

  const openRowIdRef = useRef<string | null>(null);
  const lockRef = useRef(false);
  const snapTimerRef = useRef<number | null>(null);

  const cardRefs = useRef(new Map<string, HTMLElement>());
  const panelRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    openRowIdRef.current = openRowId;
  }, [openRowId]);

  useEffect(() => {
    return () => {
      if (snapTimerRef.current !== null) {
        window.clearTimeout(snapTimerRef.current);
      }
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

  useLayoutEffect(() => {
    if (!openRowId) return;

    const panel = panelRefs.current.get(openRowId);
    if (!panel) {
      lockRef.current = false;
      return;
    }

    panel.style.height = "0px";

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
      panel.style.height = `${panel.scrollHeight}px`;
    });

    window.setTimeout(() => {
      alignCardBottomToTrack(openRowId);
    }, Math.max(0, animationMs - 10));

    return () => {
      panel.removeEventListener("transitionend", onTransitionEnd);
      window.clearTimeout(unlockFallback);
    };
  }, [alignCardBottomToTrack, animationMs, openRowId]);

  const openCard = useCallback(
    (rowId: string) => {
      lockRef.current = true;
      setClosingRowId(null);
      setOpenRowId(rowId);
      onOpenChange?.(rowId);
    },
    [onOpenChange],
  );

  const closeCard = useCallback(
    (rowId: string) => {
      const panel = panelRefs.current.get(rowId);

      lockRef.current = true;
      setClosingRowId(rowId);
      setOpenRowId(null);
      onOpenChange?.(null);

      if (!panel) {
        window.setTimeout(() => {
          setClosingRowId(null);
          lockRef.current = false;
        }, closeLockMs);
        return;
      }

      panel.style.height = `${panel.scrollHeight}px`;

      window.requestAnimationFrame(() => {
        panel.style.height = "0px";
      });

      window.setTimeout(() => {
        setClosingRowId(null);
        panel.style.height = "";
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
        closeCard(rowId);
        return;
      }

      if (currentOpen && currentOpen !== rowId) {
        closeCard(currentOpen);

        if (closeCurrentBeforeOpenNext) return;
      }

      openCard(rowId);
    },
    [closeCard, closeCurrentBeforeOpenNext, openCard],
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
    neighborRowIds,
    registerCard,
    registerPanel,
    handleCardClick,
    handleScroll,
  };
}
