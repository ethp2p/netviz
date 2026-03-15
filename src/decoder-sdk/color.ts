// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — culori 4.x ships no TypeScript declarations
import { parse, converter } from 'culori';
import type { RGBA } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toRgb = (converter as any)('rgb');

interface RgbColor {
  r: number;
  g: number;
  b: number;
  alpha?: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function toRGBA(input: unknown, alpha: number): RGBA {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = toRgb(input) as RgbColor | undefined;
  if (!c) return [0, 0, 0, Math.round(alpha * 255)];
  return [
    Math.round(clamp01(c.r) * 255),
    Math.round(clamp01(c.g) * 255),
    Math.round(clamp01(c.b) * 255),
    Math.round(alpha * 255),
  ];
}

function rgba(r: number, g: number, b: number, a = 255): RGBA {
  return [r, g, b, a];
}

export function hex(h: string): RGBA {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = (parse as any)(h) as (RgbColor & { alpha?: number }) | undefined;
  if (!c) return [0, 0, 0, 255];
  return toRGBA(c, c.alpha ?? 1);
}


export function oklch(l: number, c: number, h: number, a = 1): RGBA {
  return toRGBA({ mode: 'oklch', l, c, h }, a);
}

function withAlpha(color: RGBA, a: number): RGBA {
  return [color[0], color[1], color[2], Math.round(a * 255)];
}

function named(name: string): RGBA {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return toRGBA((parse as any)(name), 1);
}

export function css(color: RGBA): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${(color[3] / 255).toFixed(3)})`;
}
