import { cn } from "@/lib/utils";
import {
  type PipelineStatus,
  PIPELINE_ICON,
  PIPELINE_LABEL,
  PIPELINE_TONE,
  pipelineProgress,
} from "@/lib/pipeline-status";

export type PipelineBadgeVariant = "minimal" | "soft-glow" | "animated" | "progress";

interface Props {
  status: PipelineStatus;
  variant?: PipelineBadgeVariant;
  size?: "sm" | "md";
  className?: string;
}

export function PipelineStatusBadge({ status, variant = "animated", size = "sm", className }: Props) {
  const Icon = PIPELINE_ICON[status];
  const tone = PIPELINE_TONE[status];
  const label = PIPELINE_LABEL[status];

  const base = cn(
    "inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap",
    size === "sm" ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs",
    tone.bg,
    tone.text,
  );

  // Animation classes per status (animated variant)
  const animClass = (() => {
    if (variant !== "animated") return "";
    switch (status) {
      case "in_transit": return "anim-drive";
      case "loading": return "animate-spin-slow";
      case "awaiting_loading": return "animate-pulse";
      case "at_customs": return "animate-pulse";
      case "left_customs": return "anim-drive";
      case "at_warehouse": return "anim-check-pop";
      case "processing": return "animate-spin-slow";
      case "proposed": return "anim-soft-bounce";
      case "ordered": return "anim-soft-bounce";
      default: return "";
    }
  })();

  if (variant === "minimal") {
    return (
      <span className={cn(base, className)}>
        <Icon className="h-3 w-3" />
        {label}
      </span>
    );
  }

  if (variant === "soft-glow") {
    return (
      <span className={cn(base, "ring-1", tone.ring, tone.glow, className)}>
        <Icon className="h-3 w-3" />
        {label}
      </span>
    );
  }

  if (variant === "animated") {
    return (
      <span className={cn(base, "ring-1", tone.ring, className)}>
        <Icon className={cn("h-3 w-3", animClass)} />
        {label}
      </span>
    );
  }

  // progress
  const pct = Math.round(pipelineProgress(status) * 100);
  return (
    <span className={cn(base, "relative overflow-hidden pr-2.5", className)}>
      <Icon className="h-3 w-3" />
      {label}
      <span
        aria-hidden
        className="absolute left-0 bottom-0 h-0.5 bg-current opacity-60"
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}
