import type { RefCallback } from "react";
import type { MobileGlassRow } from "./types";
import { LevelTwoDetailsPanel } from "./LevelTwoDetailsPanel";
import { compactDetailLines, cx, hasRenderableValue } from "./utils";

export interface MobileGlassCardProps {
  row: MobileGlassRow;
  isOpen: boolean;
  isClosing: boolean;
  isNeighborBlur: boolean;
  registerCard: RefCallback<HTMLElement>;
  registerPanel: RefCallback<HTMLDivElement>;
  onTriggerClick: () => void;
}

export function MobileGlassCard({
  row,
  isOpen,
  isClosing,
  isNeighborBlur,
  registerCard,
  registerPanel,
  onTriggerClick,
}: MobileGlassCardProps) {
  const levelTwoLines = compactDetailLines(row.level2?.lines);
  const hasActions = hasRenderableValue(row.level2?.actions);
  const hasLevelTwo = levelTwoLines.length > 0 || hasActions;
  const isInteractive = hasLevelTwo && !row.disabled;

  return (
    <article
      className={cx(
        "tmg-card",
        isOpen && "is-open",
        isClosing && "is-closing",
        isNeighborBlur && "is-neighbor-blur",
        row.disabled && "is-disabled",
        row.className,
      )}
      data-glass-card=""
      data-row-id={row.id}
      ref={registerCard}
    >
      <button
        type="button"
        className="tmg-row-trigger"
        aria-expanded={isOpen}
        aria-disabled={!isInteractive}
        disabled={!isInteractive}
        onClick={onTriggerClick}
      >
        <span className="tmg-row-main">
          <span className="tmg-main-left">{row.level1.mainLeft}</span>
          <span className="tmg-main-right">{row.level1.mainRight}</span>
        </span>

        {(hasRenderableValue(row.level1.metaLeft) ||
          hasRenderableValue(row.level1.metaRight)) ? (
          <span className="tmg-row-meta">
            <span className="tmg-meta-left">{row.level1.metaLeft}</span>
            <span className="tmg-meta-right">{row.level1.metaRight}</span>
          </span>
        ) : null}
      </button>

      <div className="tmg-detail-panel" ref={registerPanel}>
        <div className="tmg-detail-inner">
          <LevelTwoDetailsPanel
            lines={levelTwoLines}
            actions={row.level2?.actions}
          />
        </div>
      </div>
    </article>
  );
}
