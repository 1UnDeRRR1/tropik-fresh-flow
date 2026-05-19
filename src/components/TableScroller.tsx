import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Unified mobile-first table scroll wrapper.
 *
 * Behavior:
 *  - Horizontal scroll lives INSIDE this wrapper (overflow-x: auto).
 *  - Vertical scroll is the PAGE's scroll — the wrapper does not scroll vertically
 *    (overflow-y: clip avoids creating a nested scroll container, so a
 *    `position: sticky` <thead> inside sticks to the page viewport instead of
 *    this wrapper).
 *  - `overscroll-x-contain` prevents diagonal/back-swipe gestures from bubbling.
 *  - Negative side margins bleed the table to the viewport edges so the first
 *    and last columns can touch the screen edges (no empty gap at the ends).
 *
 * Pair with: `<thead className="sticky top-16 z-30 ...">` (app header is h-16).
 */
export function TableScroller({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "-mx-4 md:-mx-6 lg:-mx-10",
        "overflow-x-auto overflow-y-clip overscroll-x-contain",
        "[scrollbar-width:thin]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
