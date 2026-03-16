// @ts-ignore — culori 4.x ships no TypeScript declarations
import { parse, converter } from 'culori';
import type { RGBA } from './decoder-sdk';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toOklch = (converter as any)('oklch');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toRgb = (converter as any)('rgb');

export interface Theme {
  name: string;
  appearance: 'dark' | 'light';
  bg: string;
  panel: string;
  borderSubtle: string;
  border: string;
  text3: string;
  text2: string;
  text: string;
  accent: string;
  green: string;
  red: string;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const stone: Theme = {
  name: 'Stone',
  appearance: 'dark',
  bg: '#0c0a09',
  panel: '#1c1917',
  borderSubtle: '#292524',
  border: '#44403c',
  text3: '#78716c',
  text2: '#a8a29e',
  text: '#e7e5e3',
  accent: '#7b93a8',
  green: '#7ec77e',
  red: '#d46a5a',
};

const catppuccinMocha: Theme = {
  name: 'Catppuccin Mocha',
  appearance: 'dark',
  bg: '#1e1e2e',
  panel: '#181825',
  borderSubtle: '#313244',
  border: '#45475a',
  text3: '#6c7086',
  text2: '#a6adc8',
  text: '#cdd6f4',
  accent: '#89b4fa',
  green: '#a6e3a1',
  red: '#f38ba8',
};

const catppuccinLatte: Theme = {
  name: 'Catppuccin Latte',
  appearance: 'light',
  bg: '#eff1f5',
  panel: '#e6e9ef',
  borderSubtle: '#ccd0da',
  border: '#bcc0cc',
  text3: '#9ca0b0',
  text2: '#6c6f85',
  text: '#4c4f69',
  accent: '#1e66f5',
  green: '#40a02b',
  red: '#d20f39',
};

const everforestDark: Theme = {
  name: 'Everforest Dark',
  appearance: 'dark',
  bg: '#2d353b',
  panel: '#272e33',
  borderSubtle: '#374145',
  border: '#4f585e',
  text3: '#7a8478',
  text2: '#9da9a0',
  text: '#d3c6aa',
  accent: '#7fbbb3',
  green: '#a7c080',
  red: '#e67e80',
};

const gruvboxDark: Theme = {
  name: 'Gruvbox Dark',
  appearance: 'dark',
  bg: '#282828',
  panel: '#1d2021',
  borderSubtle: '#3c3836',
  border: '#504945',
  text3: '#7c6f64',
  text2: '#a89984',
  text: '#ebdbb2',
  accent: '#83a598',
  green: '#b8bb26',
  red: '#fb4934',
};

const solarizedDark: Theme = {
  name: 'Solarized Dark',
  appearance: 'dark',
  bg: '#002b36',
  panel: '#073642',
  borderSubtle: '#094352',
  border: '#586e75',
  text3: '#657b83',
  text2: '#839496',
  text: '#fdf6e3',
  accent: '#268bd2',
  green: '#859900',
  red: '#dc322f',
};

const solarizedLight: Theme = {
  name: 'Solarized Light',
  appearance: 'light',
  bg: '#fdf6e3',
  panel: '#eee8d5',
  borderSubtle: '#d6cdb5',
  border: '#93a1a1',
  text3: '#93a1a1',
  text2: '#657b83',
  text: '#073642',
  accent: '#268bd2',
  green: '#859900',
  red: '#dc322f',
};

const nord: Theme = {
  name: 'Nord',
  appearance: 'dark',
  bg: '#2e3440',
  panel: '#3b4252',
  borderSubtle: '#434c5e',
  border: '#4c566a',
  text3: '#616e88',
  text2: '#d8dee9',
  text: '#eceff4',
  accent: '#88c0d0',
  green: '#a3be8c',
  red: '#bf616a',
};

export const THEMES: readonly Theme[] = [
  stone,
  catppuccinMocha,
  catppuccinLatte,
  everforestDark,
  gruvboxDark,
  solarizedDark,
  solarizedLight,
  nord,
];

export const DEFAULT_THEME = stone;

// ---------------------------------------------------------------------------
// CSS custom property application
// ---------------------------------------------------------------------------

const CSS_VAR_MAP: ReadonlyArray<[keyof Theme, string]> = [
  ['bg', '--bg'],
  ['panel', '--panel'],
  ['borderSubtle', '--border-subtle'],
  ['border', '--border'],
  ['text3', '--text3'],
  ['text2', '--text2'],
  ['text', '--text'],
  ['accent', '--accent'],
  ['green', '--green'],
  ['red', '--red'],
];

export function applyThemeCssVars(theme: Theme): void {
  const style = document.documentElement.style;
  for (const [key, cssVar] of CSS_VAR_MAP) {
    style.setProperty(cssVar, theme[key]);
  }
}

// ---------------------------------------------------------------------------
// Decoder color adaptation
// ---------------------------------------------------------------------------

interface OklchColor {
  l: number;
  c: number;
  h: number;
}

const MIN_LIGHTNESS_DISTANCE = 0.35;

function rgbaToOklch(rgba: RGBA): OklchColor {
  const r = rgba[0] / 255;
  const g = rgba[1] / 255;
  const b = rgba[2] / 255;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oklch = toOklch({ mode: 'rgb', r, g, b }) as { l: number; c: number; h: number } | undefined;
  if (!oklch) return { l: 0.5, c: 0, h: 0 };
  return { l: oklch.l, c: oklch.c ?? 0, h: oklch.h ?? 0 };
}

function oklchToRgba(color: OklchColor, alpha = 255): RGBA {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rgb = toRgb({ mode: 'oklch', l: color.l, c: color.c, h: color.h }) as { r: number; g: number; b: number } | undefined;
  if (!rgb) return [0, 0, 0, alpha];
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return [
    Math.round(clamp(rgb.r) * 255),
    Math.round(clamp(rgb.g) * 255),
    Math.round(clamp(rgb.b) * 255),
    alpha,
  ];
}

export function getBgLuminance(theme: Theme): number {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = (parse as any)(theme.bg);
  if (!parsed) return theme.appearance === 'dark' ? 0.05 : 0.95;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oklch = toOklch(parsed) as { l: number } | undefined;
  return oklch?.l ?? (theme.appearance === 'dark' ? 0.05 : 0.95);
}

export function adaptColorForTheme(rgba: RGBA, bgLuminance: number): RGBA {
  const color = rgbaToOklch(rgba);
  const distance = Math.abs(color.l - bgLuminance);
  if (distance >= MIN_LIGHTNESS_DISTANCE) return rgba;

  if (bgLuminance < 0.5) {
    color.l = Math.min(1, bgLuminance + MIN_LIGHTNESS_DISTANCE);
  } else {
    color.l = Math.max(0, bgLuminance - MIN_LIGHTNESS_DISTANCE);
  }

  return oklchToRgba(color, rgba[3]);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY_THEME = 'netviz-theme';
const STORAGE_KEY_EXACT = 'netviz-exact-colors';

export function loadSavedThemeName(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_THEME);
  } catch {
    return null;
  }
}

export function saveThemeName(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY_THEME, name);
  } catch { /* storage unavailable */ }
}

export function loadExactColors(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY_EXACT) === 'true';
  } catch {
    return false;
  }
}

export function saveExactColors(exact: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY_EXACT, String(exact));
  } catch { /* storage unavailable */ }
}

export function findThemeByName(name: string): Theme | undefined {
  return THEMES.find(t => t.name === name);
}
