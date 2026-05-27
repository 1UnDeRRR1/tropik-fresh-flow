import { cn } from "@/lib/utils";
import { PipelineStatusBadge } from "@/components/PipelineStatusBadge";
import { PIPELINE_LABEL, type PipelineStatus } from "@/lib/pipeline-status";
import { statusIconFor, statusIconSrc } from "@/lib/status-icon-map";

interface Props {
  status: PipelineStatus;
  /** Pixel size of the icon (default 28 ≈ 24–32 range from spec). */
  size?: number;
  /** Show textual label next to the icon (used in detail popup, not table). */
  showLabel?: boolean;
  /** Color for the textual label (used in detail popup). */
  labelColor?: string;
  className?: string;
  title?: string;
}

/**
 * Visual status icon backed by /public/status-icons/svg/status_NN.svg.
 * Falls back to the existing PipelineStatusBadge for statuses without a
 * dedicated icon (rejected/cancelled/etc.) so nothing breaks.
 *
 * Microanimation: soft scale + lift on hover (desktop) and a quick scale
 * pulse on tap (mobile). No infinite animation, no Lottie/GIF.
 */
export function StatusIcon({
  status,
  size = 28,
  showLabel = false,
  labelColor,
  className,
  title,
}: Props) {
  const key = statusIconFor(status);
  const label = PIPELINE_LABEL[status];

  if (!key) {
    return (
      <PipelineStatusBadge status={status} variant="animated" size="sm" className={className} />
    );
  }

  const img = (
    <img
      src={statusIconSrc(key)}
      width={size}
      height={size}
      alt={label}
      title={title ?? label}
      draggable={false}
      className={cn(
        "inline-block select-none transition-transform duration-200 ease-out",
        "hover:scale-110 hover:-translate-y-[1px] hover:drop-shadow-[0_2px_4px_rgba(0,0,0,0.18)]",
        "active:scale-95 motion-safe:animate-status-pop-once",
        className,
      )}
      style={{ width: size, height: size }}
    />
  );

  if (!showLabel) return img;

  return (
    <span className="inline-flex items-center gap-2">
      {img}
      <span
        className="text-sm font-semibold leading-none"
        style={labelColor ? { color: labelColor } : undefined}
      >
        {label}
      </span>
    </span>
  );
}
