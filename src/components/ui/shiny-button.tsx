import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Pure-CSS port of the ruixen ShinyButton (no framer-motion dependency).
 * Sized to match an outline shadcn Button so it can be a drop-in replacement
 * where needed. The shine sweeps both the label (via mask) and the border
 * (via the ::before pseudo-overlay rendered through `shiny-btn` styles).
 */
export interface ShinyButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

export const ShinyButton = React.forwardRef<HTMLButtonElement, ShinyButtonProps>(
  ({ children, className, type = "button", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type={type}
        {...props}
        className={cn("shiny-btn", className)}
      >
        <span className="shiny-btn-label">{children}</span>
        <span aria-hidden="true" className="shiny-btn-ring" />
      </button>
    );
  },
);
ShinyButton.displayName = "ShinyButton";

export default ShinyButton;
