"use client";

import { useEffect, useRef, useState } from "react";
import { THEMES, useTheme, type Theme } from "./ThemeProvider";

export function ThemePicker(): React.ReactNode {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const handleSelect = (next: Theme): void => {
    setTheme(next);
    setOpen(false);
  };

  const current = THEMES.find((t) => t.value === theme) ?? THEMES[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="切換主題"
        aria-label="切換主題"
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-[var(--color-foreground-muted)] transition-colors hover:cursor-pointer hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-foreground)]"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
          />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-2 w-44 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-lg"
        >
          <ul className="py-1">
            {THEMES.map((t) => {
              const active = t.value === current.value;
              return (
                <li key={t.value}>
                  <button
                    role="menuitemradio"
                    aria-checked={active}
                    onClick={() => handleSelect(t.value)}
                    className={`flex w-full items-center gap-3 px-3 py-2 text-base transition-colors hover:cursor-pointer hover:bg-[var(--color-surface-muted)] ${
                      active
                        ? "font-medium text-[var(--color-primary)]"
                        : "text-[var(--color-foreground)]"
                    }`}
                  >
                    <span
                      className="inline-block h-4 w-4 rounded-full border border-[var(--color-border)]"
                      style={{ background: t.swatch }}
                      aria-hidden
                    />
                    <span className="flex-1 text-left">{t.label}</span>
                    {active && (
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
