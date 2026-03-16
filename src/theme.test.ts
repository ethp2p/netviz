import { describe, it, expect } from 'vitest';
import { adaptColorForTheme, getBgLuminance, THEMES, DEFAULT_THEME } from './theme';
import type { RGBA } from './decoder-sdk';

describe('adaptColorForTheme', () => {
  it('passes through colors with sufficient contrast on dark bg', () => {
    const color: RGBA = [170, 200, 130, 255]; // L ~0.75
    const result = adaptColorForTheme(color, 0.05);
    expect(result).toEqual(color);
  });

  it('adjusts lightness on light bg when color is too close', () => {
    const color: RGBA = [220, 220, 220, 255]; // L ~0.90
    const result = adaptColorForTheme(color, 0.95);
    // Should push lightness down so it's visible on light bg
    // Result should be darker (lower RGB values)
    expect(result[0]).toBeLessThan(color[0]);
    expect(result[1]).toBeLessThan(color[1]);
    expect(result[2]).toBeLessThan(color[2]);
  });

  it('adjusts lightness on dark bg when color is too close', () => {
    const color: RGBA = [20, 20, 20, 255]; // L ~0.10
    const result = adaptColorForTheme(color, 0.05);
    // Should push lightness up
    expect(result[0]).toBeGreaterThan(color[0]);
    expect(result[1]).toBeGreaterThan(color[1]);
    expect(result[2]).toBeGreaterThan(color[2]);
  });

  it('preserves alpha channel', () => {
    const color: RGBA = [220, 220, 220, 128];
    const result = adaptColorForTheme(color, 0.95);
    expect(result[3]).toBe(128);
  });

  it('handles pure black', () => {
    const color: RGBA = [0, 0, 0, 255];
    const result = adaptColorForTheme(color, 0.05);
    // Pure black on dark bg should be pushed brighter
    expect(result[0]).toBeGreaterThan(0);
  });

  it('handles pure white', () => {
    const color: RGBA = [255, 255, 255, 255];
    const result = adaptColorForTheme(color, 0.95);
    // Pure white on light bg should be pushed darker
    expect(result[0]).toBeLessThan(255);
  });
});

describe('getBgLuminance', () => {
  it('returns low luminance for dark themes', () => {
    const lum = getBgLuminance(DEFAULT_THEME);
    expect(lum).toBeLessThan(0.15);
  });

  it('returns high luminance for light themes', () => {
    const latte = THEMES.find(t => t.name === 'Catppuccin Latte')!;
    const lum = getBgLuminance(latte);
    expect(lum).toBeGreaterThan(0.85);
  });
});

describe('THEMES', () => {
  it('has at least 6 presets', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(6);
  });

  it('includes both dark and light themes', () => {
    const dark = THEMES.filter(t => t.appearance === 'dark');
    const light = THEMES.filter(t => t.appearance === 'light');
    expect(dark.length).toBeGreaterThan(0);
    expect(light.length).toBeGreaterThan(0);
  });

  it('default theme is Stone', () => {
    expect(DEFAULT_THEME.name).toBe('Stone');
  });
});
