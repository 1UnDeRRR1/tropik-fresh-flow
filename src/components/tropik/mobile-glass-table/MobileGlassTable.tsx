import { useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import type { MobileGlassTableProps } from "./types";
import { MobileGlassCard } from "./MobileGlassCard";
import { useMobileGlassExpansion } from "./useMobileGlassExpansion";
import { cx } from "./utils";
import "./mobile-glass-table.css";

export function MobileGlassTable({
  rows,
  theme = "inherit",
  summary,
  emptyState,
  className,
  trackClassName,
  topSnap = true,
  closeCurrentBeforeOpenNext = true,
  animationMs = 480,
  closeLockMs = 540,
  topOffsetPx = 0,
  bottomOffsetPx = 8,
  onOpenChange,
}: MobileGlassTableProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);

  const expansion = useMobileGlassExpansion({
    rowIds,
    trackRef,
    topSnap,
    closeCurrentBeforeOpenNext,
    animationMs,
    closeLockMs,
    topOffsetPx,
    bottomOffsetPx,
    onOpenChange,
  });

  const style = {
    "--tmg-speed": `${animationMs}ms`,
    "--tmg-close-lock": `${closeLockMs}ms`,
  } as CSSProperties;

  const resolvedSummary =
    summary === false ? null : summary ?? `${rows.length} позицій`;

  return (
    <section
      className={cx("tmg-table", className)}
      data-theme={theme === "inherit" ? undefined : theme}
      style={style}
    >
      {resolvedSummary !== null ? (
        <div className="tmg-summary">{resolvedSummary}</div>
      ) : null}

      <div
        className={cx("tmg-track", trackClassName)}
        ref={trackRef}
        onScroll={expansion.handleScroll}
      >
        {rows.length === 0 ? (
          <div className="tmg-empty">{emptyState ?? "Немає даних"}</div>
        ) : (
          rows.map((row) => (
            <MobileGlassCard
              key={row.id}
              row={row}
              isOpen={expansion.openRowId === row.id}
              isClosing={expansion.closingRowId === row.id}
              isNeighborBlur={expansion.neighborRowIds.has(row.id)}
              registerCard={expansion.registerCard(row.id)}
              registerPanel={expansion.registerPanel(row.id)}
              onTriggerClick={() => expansion.handleCardClick(row.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}
