import type { RefCallback } from "react";
import type { MobileGlassLevelContext, MobileGlassRow } from "./types";
import type { MobileGlassActiveLevel } from "./useMobileGlassExpansion";
import { LevelTwoDetailsPanel } from "./LevelTwoDetailsPanel";
import { cx, hasRenderableValue } from "./utils";

export interface MobileGlassCardProps {
  row: MobileGlassRow;
  isOpen: boolean;
  isClosing: boolean;
  isNeighborBlur: boolean;
  activeLevel: MobileGlassActiveLevel;
  levelContext: MobileGlassLevelContext;
  registerCard: RefCallback<HTMLElement>;
  registerPanel: RefCallback<HTMLDivElement>;
  registerInner: RefCallback<HTMLDivElement>;
  onTriggerClick: () => void;
}

export function MobileGlassCard({
  row,
  isOpen,
  isClosing,
  isNeighborBlur,
  activeLevel,
  levelContext,
  registerCard,
  registerPanel,
  registerInner,
  onTriggerClick,
}: MobileGlassCardProps) {
  const hasLevelTwoLines = (row.level2?.lines?.length ?? 0) > 0;
  const hasLevelTwoActions = hasRenderableValue(
    typeof row.level2?.actions === "function" ? "fn" : row.level2?.actions,
  );
  const hasLevelTwo = hasLevelTwoLines || hasLevelTwoActions;
  const hasLevelThree = !!row.level3;
  const isInteractive = (hasLevelTwo || hasLevelThree) && !row.disabled;

  const showL3 = activeLevel === "l3" && hasLevelThree;

  const resolvedActions =
    typeof row.level2?.actions === "function"
      ? row.level2.actions(levelContext)
      : row.level2?.actions;

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
      data-active-level={showL3 ? "l3" : "l2"}
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
        <div className="tmg-detail-inner" ref={registerInner}>
          {showL3 ? (
            <div className="tmg-level-three">
              {row.level3?.render(levelContext)}
            </div>
          ) : (
            <LevelTwoDetailsPanel
              lines={row.level2?.lines}
              actions={resolvedActions}
            />
          )}
        </div>
      </div>
    </article>
  );
}
