import { useEffect, useRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * Unified mobile-first table scroll wrapper with dynamic sticky header.
 *
 * Layout:
 *  - The wrapper scrolls only horizontally (overflow-x: auto). Vertical scroll
 *    stays on the page.
 *  - CSS `position: sticky` on the <thead> cannot work here because the
 *    horizontal scroll container also becomes a vertical scroll container per
 *    spec (overflow-y: clip + overflow-x: auto computes as overflow-y: hidden,
 *    which is still a scrolling-ancestor for sticky).
 *
 * Dynamic sticky:
 *  - The component clones the table's <thead> into a `position: fixed` overlay
 *    pinned just below the app header (top: 64px = h-16).
 *  - The overlay only appears once the original thead reaches the app header
 *    and disappears again when the table scrolls back down past it (so the
 *    header "unsticks" exactly when the first data row reaches it).
 *  - The overlay's horizontal scroll is kept in sync with the wrapper, so the
 *    cloned columns track the data columns 1:1.
 */

const APP_HEADER_PX = 64;

export function TableScroller({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const overlay = overlayRef.current;
    const inner = innerRef.current;
    if (!wrap || !overlay || !inner) return;

    let rafId = 0;
    let cloneTable: HTMLTableElement | null = null;

    const ensureClone = () => {
      const table = wrap.querySelector("table") as HTMLTableElement | null;
      const thead = table?.querySelector("thead") as HTMLTableSectionElement | null;
      if (!table || !thead) {
        inner.innerHTML = "";
        cloneTable = null;
        return null;
      }
      if (!cloneTable || !inner.contains(cloneTable)) {
        inner.innerHTML = "";
        cloneTable = document.createElement("table");
        cloneTable.className = table.className;
        cloneTable.style.tableLayout = getComputedStyle(table).tableLayout;
        inner.appendChild(cloneTable);
      }
      // Refresh cloned thead (in case columns changed).
      const existing = cloneTable.querySelector("thead");
      const fresh = thead.cloneNode(true) as HTMLTableSectionElement;
      // Strip sticky positioning from the clone so it just sits at the top of
      // the overlay table.
      fresh.querySelectorAll("[class*='sticky']").forEach((el) => {
        (el as HTMLElement).classList.forEach((c) => {
          if (c.startsWith("sticky") || c.startsWith("top-") || c.startsWith("z-")) {
            (el as HTMLElement).classList.remove(c);
          }
        });
      });
      fresh.classList.forEach((c) => {
        if (c.startsWith("sticky") || c.startsWith("top-") || c.startsWith("z-")) {
          fresh.classList.remove(c);
        }
      });
      if (existing) cloneTable.replaceChild(fresh, existing);
      else cloneTable.appendChild(fresh);
      return { table, thead };
    };

    const syncWidths = (table: HTMLTableElement, thead: HTMLTableSectionElement) => {
      if (!cloneTable) return;
      cloneTable.style.width = `${table.getBoundingClientRect().width}px`;
      const srcCells = thead.querySelectorAll("th,td");
      const dstCells = cloneTable.querySelectorAll("thead th, thead td");
      srcCells.forEach((src, i) => {
        const dst = dstCells[i] as HTMLElement | undefined;
        if (!dst) return;
        const w = (src as HTMLElement).getBoundingClientRect().width;
        dst.style.width = `${w}px`;
        dst.style.minWidth = `${w}px`;
        dst.style.maxWidth = `${w}px`;
      });
    };

    const update = () => {
      const res = ensureClone();
      if (!res) {
        overlay.style.display = "none";
        return;
      }
      const { table, thead } = res;
      const rect = wrap.getBoundingClientRect();
      const theadH = thead.getBoundingClientRect().height;
      const shouldStick =
        rect.top < APP_HEADER_PX && rect.bottom > APP_HEADER_PX + theadH;
      if (shouldStick) {
        syncWidths(table, thead);
        overlay.style.display = "block";
        overlay.style.left = `${rect.left}px`;
        overlay.style.width = `${rect.width}px`;
        overlay.style.height = `${theadH}px`;
        inner.scrollLeft = wrap.scrollLeft;
      } else {
        overlay.style.display = "none";
      }
    };

    const schedule = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        update();
      });
    };

    update();
    const onScroll = () => schedule();
    const onWrapScroll = () => {
      if (inner) inner.scrollLeft = wrap.scrollLeft;
      schedule();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    wrap.addEventListener("scroll", onWrapScroll, { passive: true });

    const mo = new MutationObserver(() => schedule());
    mo.observe(wrap, { subtree: true, childList: true, characterData: true });

    const ro = new ResizeObserver(() => schedule());
    ro.observe(wrap);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      wrap.removeEventListener("scroll", onWrapScroll);
      mo.disconnect();
      ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      inner.innerHTML = "";
      cloneTable = null;
    };
  }, []);

  return (
    <>
      <div
        ref={wrapRef}
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
      <div
        ref={overlayRef}
        aria-hidden
        className="bg-background/95 backdrop-blur"
        style={{
          display: "none",
          position: "fixed",
          top: APP_HEADER_PX,
          left: 0,
          width: 0,
          overflow: "hidden",
          zIndex: 40,
          pointerEvents: "none",
        }}
      >
        <div
          ref={innerRef}
          style={{ overflow: "hidden", width: "100%", height: "100%" }}
        />
      </div>
    </>
  );
}
