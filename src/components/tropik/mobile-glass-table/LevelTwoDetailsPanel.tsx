import type { ReactNode } from "react";
import type { MobileGlassDetailLine } from "./types";
import { compactDetailLines, cx, hasRenderableValue, toneClass } from "./utils";

export interface LevelTwoDetailsPanelProps {
  lines?: MobileGlassDetailLine[];
  actions?: ReactNode;
}

export function LevelTwoDetailsPanel({ lines, actions }: LevelTwoDetailsPanelProps) {
  const compactLines = compactDetailLines(lines);
  const hasActions = hasRenderableValue(actions);

  if (!compactLines.length && !hasActions) return null;

  return (
    <div className="tmg-detail-content">
      {compactLines.map((line, index) => {
        const key = line.id ?? `line-${index}`;

        return (
          <div className={cx("tmg-detail-line", line.className)} key={key}>
            <span
              className={cx(
                toneClass(line.leftTone, "left"),
                line.leftClassName,
              )}
            >
              {line.left}
            </span>

            <strong
              className={cx(
                toneClass(line.rightTone, "right"),
                line.rightClassName,
              )}
            >
              {line.right}
            </strong>
          </div>
        );
      })}

      {hasActions ? <div className="tmg-level-two-actions">{actions}</div> : null}
    </div>
  );
}
