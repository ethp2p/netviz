import { describe, it, expect } from 'vitest';
import { adaptColorForTheme, getThemeAdaptation, THEMES, DEFAULT_THEME } from './theme';
import type { RGBA } from './decoder-sdk';

const darkAdapt = getThemeAdaptation(DEFAULT_THEME);
const lightAdapt = getThemeAdaptation(THEMES.find(t => t.name === 'Catppuccin Latte')!);
const nordAdapt = getThemeAdaptation(THEMES.find(t => t.name === 'Nord')!);

describe('adaptColorForTheme', () => {
  it('passes through colors with sufficient contrast on dark bg', () => {
    const color: RGBA = [170, 200, 130, 255]; // L ~0.75
    const result = adaptColorForTheme(color, darkAdapt);
    // Stone is the reference, so chroma scale ~1.0; lightness is fine
    expect(result[0]).toBeGreaterThan(100);
  });

  it('adjusts lightness on light bg when color is too close', () => {
    const color: RGBA = [220, 220, 220, 255]; // L ~0.90
    const result = adaptColorForTheme(color, lightAdapt);
    expect(result[0]).toBeLessThan(color[0]);
    expect(result[1]).toBeLessThan(color[1]);
    expect(result[2]).toBeLessThan(color[2]);
  });

  it('adjusts lightness on dark bg when color is too close', () => {
    const color: RGBA = [20, 20, 20, 255]; // L ~0.10
    const result = adaptColorForTheme(color, darkAdapt);
    expect(result[0]).toBeGreaterThan(color[0]);
    expect(result[1]).toBeGreaterThan(color[1]);
    expect(result[2]).toBeGreaterThan(color[2]);
  });

  it('preserves alpha channel', () => {
    const color: RGBA = [220, 220, 220, 128];
    const result = adaptColorForTheme(color, lightAdapt);
    expect(result[3]).toBe(128);
  });

  it('handles pure black', () => {
    const color: RGBA = [0, 0, 0, 255];
    const result = adaptColorForTheme(color, darkAdapt);
    expect(result[0]).toBeGreaterThan(0);
  });

  it('handles pure white', () => {
    const color: RGBA = [255, 255, 255, 255];
    const result = adaptColorForTheme(color, lightAdapt);
    expect(result[0]).toBeLessThan(255);
  });

  it('scales chroma down for desaturated themes', () => {
    // Nord is more desaturated than Stone
    const vivid: RGBA = [50, 200, 80, 255]; // saturated green
    const stoneResult = adaptColorForTheme(vivid, darkAdapt);
    const nordResult = adaptColorForTheme(vivid, nordAdapt);
    // Nord result should be less saturated (closer to gray)
    const stoneSpread = Math.max(stoneResult[0], stoneResult[1], stoneResult[2]) - Math.min(stoneResult[0], stoneResult[1], stoneResult[2]);
    const nordSpread = Math.max(nordResult[0], nordResult[1], nordResult[2]) - Math.min(nordResult[0], nordResult[1], nordResult[2]);
    expect(nordSpread).toBeLessThan(stoneSpread);
  });
});

describe('getThemeAdaptation', () => {
  it('returns low luminance for dark themes', () => {
    expect(darkAdapt.bgLuminance).toBeLessThan(0.15);
  });

  it('returns high luminance for light themes', () => {
    expect(lightAdapt.bgLuminance).toBeGreaterThan(0.85);
  });

  it('returns chroma scale ~1.0 for Stone (reference)', () => {
    expect(darkAdapt.chromaScale).toBeCloseTo(1.0, 1);
  });

  it('returns chroma scale for other themes', () => {
    expect(nordAdapt.chromaScale).toBeGreaterThan(0);
    expect(nordAdapt.chromaScale).toBeLessThan(2);
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
