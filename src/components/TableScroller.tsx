import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Unified mobile-first table scroll wrapper with dynamic sticky header.
 *
 * The cloned <thead> overlay is rendered through a React portal into
 * document.body so that ancestors with `transform`, `filter`, or
 * `backdrop-filter` (which create a containing block) cannot pin our
 * `position: fixed` overlay inside the page card — that was causing the
 * sticky header to render in the middle of the table.
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
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
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
        cloneTable.style.borderCollapse = getComputedStyle(table).borderCollapse;
        cloneTable.style.borderSpacing = getComputedStyle(table).borderSpacing;
        inner.appendChild(cloneTable);
      }
      const existing = cloneTable.querySelector("thead");
      const fresh = thead.cloneNode(true) as HTMLTableSectionElement;
      const strip = (el: HTMLElement) => {
        Array.from(el.classList).forEach((c) => {
          if (c.startsWith("sticky") || c.startsWith("top-") || c.startsWith("z-")) {
            el.classList.remove(c);
          }
        });
      };
      strip(fresh);
      fresh.querySelectorAll<HTMLElement>("*").forEach(strip);
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
      const tableRect = table.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const theadRect = thead.getBoundingClientRect();
      const theadH = theadRect.height;
      // Only show the fixed overlay AFTER the original thead has fully scrolled
      // under the app header. This avoids the overlay covering the first data
      // rows while the original thead is still partially visible.
      const shouldStick =
        theadRect.bottom <= APP_HEADER_PX &&
        tableRect.bottom > APP_HEADER_PX + theadH;
      if (shouldStick) {
        syncWidths(table, thead);
        overlay.style.display = "block";
        overlay.style.left = `${wrapRect.left}px`;
        overlay.style.width = `${wrapRect.width}px`;
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
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onScroll);
    wrap.addEventListener("scroll", onWrapScroll, { passive: true });

    const mo = new MutationObserver(() => schedule());
    mo.observe(wrap, { subtree: true, childList: true, characterData: true });

    const ro = new ResizeObserver(() => schedule());
    ro.observe(wrap);

    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true } as any);
      window.removeEventListener("resize", onScroll);
      wrap.removeEventListener("scroll", onWrapScroll);
      mo.disconnect();
      ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      inner.innerHTML = "";
      cloneTable = null;
    };
  }, [mounted]);

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
      {mounted &&
        createPortal(
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
              zIndex: 30,
              pointerEvents: "none",
            }}
          >
            <div
              ref={innerRef}
              style={{ overflow: "hidden", width: "100%", height: "100%" }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
