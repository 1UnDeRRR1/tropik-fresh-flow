import { createContext, useContext, type ReactNode } from "react";

/**
 * Read-only shell for the Owner / Director role.
 *
 * Design choices:
 *  - NO global <fieldset disabled> — that would break filters, sorts,
 *    period pickers, search inputs, popovers, drill-down dialogs, etc.
 *  - Only elements explicitly marked with `data-mutation` or
 *    `data-write-only` are hidden via CSS scoped to `[data-owner-readonly]`.
 *  - A context flag (`useReadOnly()`) is exposed so callers can gate any
 *    write-only branch in code as well.
 *
 * The stylesheet is inlined here so we do not have to touch global
 * `src/styles.css` (out of Gate 3 scope).
 */

const ReadOnlyContext = createContext<boolean>(false);

export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}

const READONLY_STYLE = `
[data-owner-readonly] [data-mutation],
[data-owner-readonly] [data-write-only] {
  display: none !important;
}
`.trim();

export function ReadOnlyShell({ children }: { children: ReactNode }) {
  return (
    <ReadOnlyContext.Provider value={true}>
      <style dangerouslySetInnerHTML={{ __html: READONLY_STYLE }} />
      <div data-owner-readonly="true">{children}</div>
    </ReadOnlyContext.Provider>
  );
}
