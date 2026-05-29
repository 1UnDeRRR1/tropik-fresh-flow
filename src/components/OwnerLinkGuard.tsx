import { useEffect, type ReactNode } from "react";
import { toast } from "sonner";
import { isOwnerAllowedPath } from "@/lib/owner-route-guard";

/**
 * Defence-in-depth: intercept clicks on anchor tags that would navigate the
 * owner outside the allow-listed prefixes (e.g. drill-down links rendered
 * by re-mounted Calendar / Analytics screens that try to push to
 * /distribution/$id, /shipments/$id, etc.).
 *
 * The owner already has:
 *  - DB-level: read-only SELECT policies (Gate 2), no INSERT/UPDATE/DELETE.
 *  - Route-level: layout guard (_authenticated.tsx) redirects forbidden
 *    URLs to /owner/calendar.
 *  - UI-level: [data-mutation] / [data-write-only] elements hidden via
 *    ReadOnlyShell.
 *
 * This guard is the fourth, purely cosmetic layer: it prevents the URL
 * from briefly flashing before the layout guard runs.
 */
export function OwnerLinkGuard({ children }: { children: ReactNode }) {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as Element | null;
      if (!target) return;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      // External link — let it through.
      if (/^https?:\/\//i.test(href) && !href.startsWith(window.location.origin)) return;

      const path = href.startsWith("http")
        ? new URL(href).pathname
        : href.split("?")[0].split("#")[0];

      if (!isOwnerAllowedPath(path)) {
        e.preventDefault();
        e.stopPropagation();
        toast.info("Перегляд тільки для читання", {
          description: "Цей розділ доступний з робочого облікового запису.",
        });
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return <>{children}</>;
}
