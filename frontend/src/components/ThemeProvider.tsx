"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "light" | "dark" | "cool" | "warm" | "purple";

export const THEMES: ReadonlyArray<{ value: Theme; label: string; swatch: string }> = [
  { value: "light", label: "淺色", swatch: "#f9fafb" },
  { value: "dark", label: "深色", swatch: "#171717" },
  { value: "cool", label: "冷色系", swatch: "#0ea5e9" },
  { value: "warm", label: "暖色系", swatch: "#ea580c" },
  { value: "purple", label: "粉紫色", swatch: "#a855f7" },
];

const STORAGE_KEY = "df-sso-theme";
const DEFAULT_THEME: Theme = "light";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

function applyTheme(theme: Theme): void {
  const html = document.documentElement;
  html.classList.toggle("dark", theme === "dark");
  if (theme === "light" || theme === "dark") {
    html.removeAttribute("data-theme");
  } else {
    html.setAttribute("data-theme", theme);
  }
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps): React.ReactNode {
  const [theme, setThemeState] = useState<Theme>(DEFAULT_THEME);

  // Sync from localStorage on mount (anti-FOUC script may have already applied
  // the theme to <html>; here we just mirror it into React state for the picker UI).
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored && THEMES.some((t) => t.value === stored)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time SSR\u2192client sync from localStorage
      setThemeState(stored);
    }
  }, []);

  const setTheme = useCallback((next: Theme): void => {
    setThemeState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>
  );
}

/**
 * Inline script that runs before React hydration to apply the
 * stored theme to <html>, preventing a flash of incorrect theme.
 * Inject as `<script dangerouslySetInnerHTML={{ __html: themeBootScript }} />`.
 */
export const themeBootScript = `
(function () {
  try {
    var t = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    var valid = ${JSON.stringify(THEMES.map((x) => x.value))};
    if (!t || valid.indexOf(t) === -1) return;
    var h = document.documentElement;
    if (t === 'dark') h.classList.add('dark');
    else h.classList.remove('dark');
    if (t === 'light' || t === 'dark') h.removeAttribute('data-theme');
    else h.setAttribute('data-theme', t);
  } catch (e) {}
})();
`.trim();
