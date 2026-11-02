import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_THEME_ID, findTheme, type ThemeDefinition } from './themes';

const THEME_KEY = 'mss-theme';
const PALETTE_KEY = 'mss-theme-palette';
const GLASS_KEY = 'mss-glass';
const CSS_VARIABLES = ['--app-bg', '--app-bg-2', '--app-surface', '--app-surface-2', '--app-text', '--app-signal', '--app-signal-ink'] as const;

type ThemeContextValue = {
  theme: ThemeDefinition;
  setTheme: (id: string) => void;
  glass: boolean;
  setGlass: (enabled: boolean) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readThemeId() {
  try {
    return localStorage.getItem(THEME_KEY) ?? DEFAULT_THEME_ID;
  } catch {
    return DEFAULT_THEME_ID;
  }
}

function readGlass() {
  try {
    return localStorage.getItem(GLASS_KEY) === '1';
  } catch {
    return false;
  }
}

function applyTheme(theme: ThemeDefinition) {
  const root = document.documentElement;
  theme.colors.forEach((color, index) => root.style.setProperty(CSS_VARIABLES[index]!, color));
  root.dataset.theme = theme.id;
  root.dataset.themeMode = theme.mode;
  root.style.colorScheme = theme.mode;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState(readThemeId);
  const [glass, setGlassState] = useState(readGlass);
  const theme = findTheme(themeId);

  useLayoutEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme.id);
      localStorage.setItem(PALETTE_KEY, JSON.stringify({ id: theme.id, mode: theme.mode, colors: theme.colors }));
    } catch {
      // Storage may be disabled; the selected palette still works for this page.
    }
  }, [theme]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (glass) root.dataset.glass = '';
    else delete root.dataset.glass;
    try {
      localStorage.setItem(GLASS_KEY, glass ? '1' : '0');
    } catch {
      // Storage may be disabled; the glass setting still works for this page.
    }
  }, [glass]);

  const value = useMemo<ThemeContextValue>(() => ({
    theme,
    setTheme: (id) => setThemeId(findTheme(id).id),
    glass,
    setGlass: setGlassState,
  }), [glass, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside ThemeProvider');
  return value;
}
