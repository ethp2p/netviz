import { describe, it, expect } from 'vitest';
import {
  MARGIN,
  CDF_HEIGHT,
  BW_HEIGHT,
  PCT_LABELS,
  UP_COLOR,
  DOWN_COLOR,
  BAND_OPACITIES,
  HIGHLIGHT_BOOST,
  scale,
  scaleInv,
  areaPath,
  stepPath,
  stepAreaPath,
  linePath,
  nearestIdx,
} from './helpers';

describe('layout constants', () => {
  it('MARGIN has expected sides', () => {
    expect(MARGIN).toEqual({ top: 6, right: 6, bottom: 18, left: 40 });
  });

  it('CDF_HEIGHT and BW_HEIGHT are positive numbers', () => {
    expect(CDF_HEIGHT).toBeGreaterThan(0);
    expect(BW_HEIGHT).toBeGreaterThan(0);
  });

  it('PCT_LABELS has five percentile labels', () => {
    expect(PCT_LABELS).toHaveLength(5);
    expect(PCT_LABELS).toEqual(['p50', 'p80', 'p90', 'p95', 'p99']);
  });
});

describe('color constants', () => {
  it('UP_COLOR and DOWN_COLOR are non-empty strings', () => {
    expect(typeof UP_COLOR).toBe('string');
    expect(UP_COLOR.length).toBeGreaterThan(0);
    expect(typeof DOWN_COLOR).toBe('string');
    expect(DOWN_COLOR.length).toBeGreaterThan(0);
  });

  it('BAND_OPACITIES has five entries in descending order', () => {
    expect(BAND_OPACITIES).toHaveLength(5);
    for (let i = 1; i < BAND_OPACITIES.length; i++) {
      expect(BAND_OPACITIES[i]).toBeLessThan(BAND_OPACITIES[i - 1]);
    }
  });

  it('HIGHLIGHT_BOOST is a positive number', () => {
    expect(HIGHLIGHT_BOOST).toBeGreaterThan(0);
  });
});

describe('scale', () => {
  it('maps domain start to range start', () => {
    const s = scale(0, 10, 100, 200);
    expect(s(0)).toBe(100);
  });

  it('maps domain end to range end', () => {
    const s = scale(0, 10, 100, 200);
    expect(s(10)).toBe(200);
  });

  it('maps midpoint linearly', () => {
    const s = scale(0, 10, 0, 100);
    expect(s(5)).toBe(50);
  });

  it('works with reversed range (top-down SVG coordinates)', () => {
    const s = scale(0, 1, 100, 0);
    expect(s(0)).toBe(100);
    expect(s(1)).toBe(0);
    expect(s(0.5)).toBe(50);
  });

  it('handles zero-span domain without dividing by zero', () => {
    // dSpan defaults to 1 when d0 === d1
    const s = scale(5, 5, 10, 20);
    // (v - d0) / 1 * (r1 - r0) + r0 = (5-5)/1*10 + 10 = 10
    expect(s(5)).toBe(10);
  });

  it('extrapolates outside domain', () => {
    const s = scale(0, 10, 0, 100);
    expect(s(15)).toBe(150);
    expect(s(-5)).toBe(-50);
  });
});

describe('scaleInv', () => {
  it('is the inverse of scale', () => {
    const fwd = scale(0, 10, 50, 150);
    const inv = scaleInv(0, 10, 50, 150);
    expect(inv(fwd(3))).toBeCloseTo(3);
    expect(inv(fwd(7))).toBeCloseTo(7);
  });

  it('maps range start to domain start', () => {
    const inv = scaleInv(0, 100, 0, 400);
    expect(inv(0)).toBe(0);
  });

  it('maps range end to domain end', () => {
    const inv = scaleInv(0, 100, 0, 400);
    expect(inv(400)).toBe(100);
  });

  it('handles zero-span range without dividing by zero', () => {
    const inv = scaleInv(0, 10, 5, 5);
    // rSpan defaults to 1, so result is d0 + (v-r0)/1*(d1-d0)
    expect(inv(5)).toBe(0); // d0 + (5-5)/1*10 = 0
  });
});

describe('areaPath', () => {
  it('returns empty string for empty input', () => {
    expect(areaPath([], [], [])).toBe('');
  });

  it('produces a closed SVG path string for a single point', () => {
    const d = areaPath([10], [5], [20]);
    expect(d).toContain('M10,5');
    expect(d).toContain('L10,20');
    expect(d).toContain('Z');
  });

  it('traces top edge forward then bottom edge backward', () => {
    const d = areaPath([0, 10, 20], [1, 2, 3], [10, 11, 12]);
    // Path starts at top-left, goes right along top, then goes back left along bottom
    expect(d).toMatch(/^M0,1/);
    expect(d).toContain('L10,2');
    expect(d).toContain('L20,3');
    // Reverse leg visits x=20, x=10, x=0
    expect(d).toContain('L20,12');
    expect(d).toContain('L10,11');
    expect(d).toContain('L0,10');
    expect(d.endsWith('Z')).toBe(true);
  });
});

describe('stepPath', () => {
  it('returns empty string for empty input', () => {
    expect(stepPath([], [])).toBe('');
  });

  it('starts at first point with M', () => {
    const d = stepPath([0, 10], [5, 8]);
    expect(d).toMatch(/^M0,5/);
  });

  it('uses horizontal then vertical steps (H...V...)', () => {
    const d = stepPath([0, 10, 20], [5, 8, 3]);
    expect(d).toContain('H10V8');
    expect(d).toContain('H20V3');
  });

  it('single point produces only M command', () => {
    const d = stepPath([5], [7]);
    expect(d).toBe('M5,7');
  });
});

describe('stepAreaPath', () => {
  it('returns empty string for empty input', () => {
    expect(stepAreaPath([], [], 0)).toBe('');
  });

  it('starts at baseline, steps up, ends back at baseline with Z', () => {
    const d = stepAreaPath([0, 10], [5, 8], 0);
    // Should start at (x[0], baseline) then go vertical to y[0]
    expect(d).toMatch(/^M0,0V5/);
    expect(d).toContain('H10V8');
    expect(d).toMatch(/V0Z$/);
  });

  it('closes the area back to baseline', () => {
    const d = stepAreaPath([0, 5, 10], [3, 6, 2], 100);
    expect(d).toMatch(/V100Z$/);
  });
});

describe('linePath', () => {
  it('returns empty string for empty input', () => {
    expect(linePath([], [])).toBe('');
  });

  it('starts with M for first point', () => {
    const d = linePath([0, 10, 20], [1, 4, 2]);
    expect(d).toMatch(/^M0,1/);
  });

  it('uses L commands for subsequent points', () => {
    const d = linePath([0, 10, 20], [1, 4, 2]);
    expect(d).toContain('L10,4');
    expect(d).toContain('L20,2');
  });

  it('single point produces only M command', () => {
    const d = linePath([3], [7]);
    expect(d).toBe('M3,7');
  });
});

describe('nearestIdx', () => {
  it('returns 0 for a single-element array', () => {
    expect(nearestIdx([42], 42)).toBe(0);
    expect(nearestIdx([42], 0)).toBe(0);
    expect(nearestIdx([42], 100)).toBe(0);
  });

  it('finds exact match', () => {
    expect(nearestIdx([0, 10, 20, 30], 20)).toBe(2);
  });

  it('returns index of nearest value when between two values', () => {
    // target 6 is closer to 10 than to 0
    expect(nearestIdx([0, 10, 20], 6)).toBe(1);
    // target 4 is closer to 0 than to 10
    expect(nearestIdx([0, 10, 20], 4)).toBe(0);
  });

  it('returns 0 for target below the minimum', () => {
    expect(nearestIdx([5, 10, 15], -100)).toBe(0);
  });

  it('returns last index for target above the maximum', () => {
    expect(nearestIdx([5, 10, 15], 1000)).toBe(2);
  });

  it('handles a two-element array', () => {
    expect(nearestIdx([0, 100], 40)).toBe(0);
    expect(nearestIdx([0, 100], 60)).toBe(1);
  });

  it('exact midpoint prefers the right element (upper bound)', () => {
    // At exactly 5 (midpoint of 0 and 10), lo ends up at 1; |times[0]-5|==|times[1]-5|
    // so neither condition triggers, returns lo=1
    expect(nearestIdx([0, 10], 5)).toBe(1);
  });
});
