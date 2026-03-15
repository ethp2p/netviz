import { oklch, hex as sdkHex } from './decoder-sdk';
import type { RGBA } from './decoder-sdk';

interface PaletteColor {
  readonly css: string;
  readonly rgba: RGBA;
}

function c(L: number, C: number, H: number): PaletteColor {
  return { css: `oklch(${L} ${C} ${H})`, rgba: oklch(L, C, H) };
}

function h(hex: string): PaletteColor {
  return { css: hex, rgba: sdkHex(hex) };
}

// Centralized color palette.
// Chrome and text use Tailwind stone hex values for exact match.
// Semantic colors stay in oklch for perceptual uniformity.
export const P = {
  // Chrome (stone palette)
  bg:           h('#0c0a09'), // stone-950
  border:       h('#44403c'), // stone-700
  borderSubtle: h('#292524'), // stone-800

  // Text hierarchy (stone palette)
  text:  h('#e7e5e3'), // stone-200
  text2: h('#a8a29e'), // stone-400
  text3: h('#78716c'), // stone-500

  // Semantic data
  idle:      h('#57534e'), // stone-600
  slate:     c(0.55, 0.03, 250),
  accent:    c(0.70, 0.08, 250),
  receiving: c(0.72, 0.12, 230),
  decoded:   c(0.75, 0.14, 155),
  error:     c(0.65, 0.20, 25),
  origin:    c(0.72, 0.14, 300),
  useless:   c(0.72, 0.14, 60),
  hover:     c(0.72, 0.12, 320),
  routing:   c(0.65, 0.10, 280),

  // Milestones
  chunkSent:  c(0.82, 0.14, 95),
  lastDecode: c(0.80, 0.10, 155),
} as const;

// Arc and particle timing constants (microseconds)
export const PULSE_RING_DURATION_US = 25_000;
