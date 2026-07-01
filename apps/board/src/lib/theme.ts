import { useCallback, useEffect, useState } from "react";

/**
 * Theme management. Persists the choice in localStorage and reflects it via the
 * `data-theme` attribute on <html>. Defaults to the OS preference (dark fallback).
 * The initial value is applied by an inline script in index.html to avoid a flash.
 */
export type Theme = "dark" | "light";

const STORAGE_KEY = "miniboss-theme";

export function systemTheme(): Theme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function getTheme(): Theme {
  const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  if (stored === "dark" || stored === "light") return stored;
  return systemTheme();
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore storage failures (private mode, etc.)
  }
}

/** React hook exposing the current theme and a toggle. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  useEffect(() => {
    setTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setThemeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggle };
}
