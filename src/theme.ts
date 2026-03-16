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
// Active chrome palette (updated on theme change for rendering code)
// ---------------------------------------------------------------------------

interface ChromeColor {
  css: string;
  rgba: RGBA;
}

function hexToColor(hex: string): ChromeColor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = (parse as any)(hex);
  if (!parsed) return { css: hex, rgba: [0, 0, 0, 255] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rgb = toRgb(parsed) as { r: number; g: number; b: number } | undefined;
  if (!rgb) return { css: hex, rgba: [0, 0, 0, 255] };
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return {
    css: hex,
    rgba: [
      Math.round(clamp(rgb.r) * 255),
      Math.round(clamp(rgb.g) * 255),
      Math.round(clamp(rgb.b) * 255),
      255,
    ],
  };
}

export const chrome = {
  bg: hexToColor(stone.bg),
  panel: hexToColor(stone.panel),
  border: hexToColor(stone.border),
  borderSubtle: hexToColor(stone.borderSubtle),
  text: hexToColor(stone.text),
  text2: hexToColor(stone.text2),
  text3: hexToColor(stone.text3),
  accent: hexToColor(stone.accent),
  green: hexToColor(stone.green),
  red: hexToColor(stone.red),
};

export function updateChromePalette(theme: Theme): void {
  chrome.bg = hexToColor(theme.bg);
  chrome.panel = hexToColor(theme.panel);
  chrome.border = hexToColor(theme.border);
  chrome.borderSubtle = hexToColor(theme.borderSubtle);
  chrome.text = hexToColor(theme.text);
  chrome.text2 = hexToColor(theme.text2);
  chrome.text3 = hexToColor(theme.text3);
  chrome.accent = hexToColor(theme.accent);
  chrome.green = hexToColor(theme.green);
  chrome.red = hexToColor(theme.red);
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

function hexToOklchProps(hex: string): { c: number; h: number } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = (parse as any)(hex);
  if (!parsed) return { c: 0, h: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oklch = toOklch(parsed) as { c: number; h: number } | undefined;
  return { c: oklch?.c ?? 0, h: oklch?.h ?? 0 };
}

function themeAccentStats(theme: Theme): { avgChroma: number; avgHue: number } {
  const accents = [theme.accent, theme.green, theme.red].map(hexToOklchProps);
  const avgChroma = accents.reduce((sum, a) => sum + a.c, 0) / accents.length;
  // Circular mean for hue (degrees wrap at 360)
  const sinSum = accents.reduce((sum, a) => sum + Math.sin(a.h * Math.PI / 180), 0);
  const cosSum = accents.reduce((sum, a) => sum + Math.cos(a.h * Math.PI / 180), 0);
  const avgHue = ((Math.atan2(sinSum, cosSum) * 180 / Math.PI) + 360) % 360;
  return { avgChroma, avgHue };
}

const REFERENCE_STATS = themeAccentStats(stone);

// How strongly to shift hues toward the theme's temperature (0 = none, 1 = full)
const HUE_BIAS_STRENGTH = 0.15;

export interface ThemeAdaptation {
  bgLuminance: number;
  chromaScale: number;
  hueBias: number; // degrees to shift (circular offset from reference)
}

export function getThemeAdaptation(theme: Theme): ThemeAdaptation {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = (parse as any)(theme.bg);
  let bgLuminance: number;
  if (parsed) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oklch = toOklch(parsed) as { l: number } | undefined;
    bgLuminance = oklch?.l ?? (theme.appearance === 'dark' ? 0.05 : 0.95);
  } else {
    bgLuminance = theme.appearance === 'dark' ? 0.05 : 0.95;
  }

  const stats = themeAccentStats(theme);
  const chromaScale = REFERENCE_STATS.avgChroma > 0 ? stats.avgChroma / REFERENCE_STATS.avgChroma : 1;

  // Shortest angular distance from reference hue to theme hue
  let hueDelta = stats.avgHue - REFERENCE_STATS.avgHue;
  if (hueDelta > 180) hueDelta -= 360;
  if (hueDelta < -180) hueDelta += 360;
  const hueBias = hueDelta * HUE_BIAS_STRENGTH;

  return { bgLuminance, chromaScale, hueBias };
}

export function adaptColorForTheme(rgba: RGBA, adaptation: ThemeAdaptation): RGBA {
  const color = rgbaToOklch(rgba);

  // Scale chroma to match theme vibrancy
  color.c = color.c * adaptation.chromaScale;

  // Shift hue toward theme temperature
  if (adaptation.hueBias !== 0 && color.c > 0.01) {
    color.h = ((color.h + adaptation.hueBias) % 360 + 360) % 360;
  }

  // Adjust lightness for contrast
  const distance = Math.abs(color.l - adaptation.bgLuminance);
  if (distance < MIN_LIGHTNESS_DISTANCE) {
    if (adaptation.bgLuminance < 0.5) {
      color.l = Math.min(1, adaptation.bgLuminance + MIN_LIGHTNESS_DISTANCE);
    } else {
      color.l = Math.max(0, adaptation.bgLuminance - MIN_LIGHTNESS_DISTANCE);
    }
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
