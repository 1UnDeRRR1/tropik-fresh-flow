import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "tropik.theme";

interface ThemeCtx {
  theme: ThemeMode;
  resolved: ResolvedTheme;
  setTheme: (t: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeCtx | null>(null);

function readStored(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function applyClass(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  root.style.colorScheme = resolved;

  // Keep the browser/OS status bar color in sync with the resolved theme.
  // Without this, the <meta name="theme-color"> stays at its initial value
  // and the mobile status bar only updates after a full app relaunch.
  const color = resolved === "dark" ? "#0B0B0B" : "#E89A5C";
  const ensureMeta = (selector: string, create: () => HTMLMetaElement) => {
    let el = document.head.querySelector<HTMLMetaElement>(selector);
    if (!el) {
      el = create();
      document.head.appendChild(el);
    }
    return el;
  };
  // Generic theme-color (used by most Android browsers and PWAs).
  const generic = ensureMeta('meta[name="theme-color"]:not([media])', () => {
    const m = document.createElement("meta");
    m.name = "theme-color";
    return m;
  });
  generic.setAttribute("content", color);
  // Per-scheme entries help iOS Safari and Chrome pick the right one quickly.
  const light = ensureMeta('meta[name="theme-color"][media*="light"]', () => {
    const m = document.createElement("meta");
    m.name = "theme-color";
    m.setAttribute("media", "(prefers-color-scheme: light)");
    return m;
  });
  light.setAttribute("content", "#E89A5C");
  const dark = ensureMeta('meta[name="theme-color"][media*="dark"]', () => {
    const m = document.createElement("meta");
    m.name = "theme-color";
    m.setAttribute("media", "(prefers-color-scheme: dark)");
    return m;
  });
  dark.setAttribute("content", "#0B0B0B");
}


export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(() => readStored());
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  // Listen for system preference changes
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener?.("change", handler);
    return () => mql.removeEventListener?.("change", handler);
  }, []);

  const resolved: ResolvedTheme = useMemo(() => {
    if (theme === "system") return systemDark ? "dark" : "light";
    return theme;
  }, [theme, systemDark]);

  useEffect(() => {
    applyClass(resolved);
  }, [resolved]);

  const setTheme = useCallback((t: ThemeMode) => {
    setThemeState(t);
    try {
      if (t === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, t);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(() => ({ theme, resolved, setTheme }), [theme, resolved, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
