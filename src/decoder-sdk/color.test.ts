import { describe, it, expect } from 'vitest';
import { hex, oklch, css } from './color';

describe('hex', () => {
  it('parses red', () => {
    expect(hex('#ff0000')).toEqual([255, 0, 0, 255]);
  });

  it('parses white', () => {
    expect(hex('#ffffff')).toEqual([255, 255, 255, 255]);
  });

  it('falls back to opaque black for invalid input', () => {
    expect(hex('invalid')).toEqual([0, 0, 0, 255]);
  });

  it('parses black', () => {
    expect(hex('#000000')).toEqual([0, 0, 0, 255]);
  });

  it('parses shorthand hex', () => {
    expect(hex('#fff')).toEqual([255, 255, 255, 255]);
  });
});

describe('oklch', () => {
  it('does not throw for typical inputs', () => {
    expect(() => oklch(0.5, 0.1, 180)).not.toThrow();
  });

  it('returns an RGBA tuple (4-element array)', () => {
    const result = oklch(0.5, 0.1, 180);
    expect(result).toHaveLength(4);
    result.forEach(v => expect(typeof v).toBe('number'));
  });

  it('defaults alpha to 255 (fully opaque)', () => {
    const result = oklch(0.5, 0.1, 180);
    expect(result[3]).toBe(255);
  });

  it('respects explicit alpha', () => {
    const result = oklch(0.5, 0.1, 180, 0.5);
    // 0.5 * 255 = 127.5, rounded to 128
    expect(result[3]).toBe(128);
  });

  it('clamps channel values to [0, 255]', () => {
    const result = oklch(0.5, 0.1, 180);
    result.forEach(v => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    });
  });
});

describe('css', () => {
  it('formats opaque red correctly', () => {
    expect(css([255, 0, 0, 255])).toBe('rgba(255,0,0,1.000)');
  });

  it('formats half-transparent black with alpha ~0.502', () => {
    const result = css([0, 0, 0, 128]);
    // 128 / 255 ≈ 0.502
    expect(result).toBe('rgba(0,0,0,0.502)');
  });

  it('formats fully transparent white', () => {
    expect(css([255, 255, 255, 0])).toBe('rgba(255,255,255,0.000)');
  });

  it('formats an arbitrary color with three decimal places on alpha', () => {
    const result = css([100, 150, 200, 204]);
    // 204 / 255 ≈ 0.800
    expect(result).toBe('rgba(100,150,200,0.800)');
  });
});
