import { describe, it, expect } from 'vitest';
import { EVENT_STRIDE } from '../decoder-sdk';
import {
  buildTimeIndex,
  buildEventIndex,
  upperBound,
  countBefore,
} from './index';
import { escapeHtml } from '../format';

// Helpers to build a minimal packed-event buffer.
// Each event occupies EVENT_STRIDE (6) float64 slots:
//   slot 0 = timestamp, slot 1 = nodeIndex, slots 2-5 = other fields.
function makeEventBuf(events: { ts: number; node: number }[]): Float64Array {
  const buf = new Float64Array(events.length * EVENT_STRIDE);
  for (let i = 0; i < events.length; i++) {
    buf[i * EVENT_STRIDE + 0] = events[i].ts;
    buf[i * EVENT_STRIDE + 1] = events[i].node;
  }
  return buf;
}

describe('buildTimeIndex', () => {
  it('returns an empty array when count is 0', () => {
    const buf = new Float64Array(0);
    expect(buildTimeIndex(buf, 0)).toEqual([]);
  });

  it('extracts timestamps from the correct slot of each stride', () => {
    const events = [
      { ts: 100, node: 0 },
      { ts: 200, node: 1 },
      { ts: 300, node: 2 },
    ];
    const buf = makeEventBuf(events);
    expect(buildTimeIndex(buf, 3)).toEqual([100, 200, 300]);
  });

  it('respects the count parameter and does not read beyond it', () => {
    const events = [
      { ts: 10, node: 0 },
      { ts: 20, node: 0 },
      { ts: 30, node: 0 },
    ];
    const buf = makeEventBuf(events);
    expect(buildTimeIndex(buf, 2)).toEqual([10, 20]);
  });

  it('returns an array with one element for a single event', () => {
    const buf = makeEventBuf([{ ts: 999, node: 0 }]);
    expect(buildTimeIndex(buf, 1)).toEqual([999]);
  });

  it('preserves fractional (sub-microsecond) timestamps', () => {
    const buf = makeEventBuf([{ ts: 1.5, node: 0 }, { ts: 2.75, node: 1 }]);
    expect(buildTimeIndex(buf, 2)).toEqual([1.5, 2.75]);
  });
});

describe('buildEventIndex', () => {
  it('returns empty per-node arrays when count is 0', () => {
    const buf = new Float64Array(0);
    const { byNode } = buildEventIndex(buf, 0, 3);
    expect(byNode).toHaveLength(3);
    for (const arr of byNode) expect(arr.length).toBe(0);
  });

  it('groups event indices into the correct node bucket', () => {
    const events = [
      { ts: 1, node: 0 },
      { ts: 2, node: 1 },
      { ts: 3, node: 0 },
    ];
    const buf = makeEventBuf(events);
    const { byNode } = buildEventIndex(buf, 3, 2);
    // node 0 should own event indices 0 and 2
    expect(Array.from(byNode[0])).toEqual([0, 2]);
    // node 1 should own event index 1
    expect(Array.from(byNode[1])).toEqual([1]);
  });

  it('preserves insertion order within each node bucket', () => {
    const events = [
      { ts: 1, node: 2 },
      { ts: 2, node: 2 },
      { ts: 3, node: 2 },
    ];
    const buf = makeEventBuf(events);
    const { byNode } = buildEventIndex(buf, 3, 3);
    expect(Array.from(byNode[2])).toEqual([0, 1, 2]);
  });

  it('silently discards events whose node index is out of range', () => {
    // nodeIndex -1 and nodeCount (5) are both out of bounds
    const events = [
      { ts: 1, node: -1 },
      { ts: 2, node: 5 },
      { ts: 3, node: 0 },
    ];
    const buf = makeEventBuf(events);
    const { byNode } = buildEventIndex(buf, 3, 5);
    expect(Array.from(byNode[0])).toEqual([2]);
    for (let n = 1; n < 5; n++) expect(byNode[n].length).toBe(0);
  });

  it('allocates exactly the right bucket sizes', () => {
    const events = [
      { ts: 1, node: 0 },
      { ts: 2, node: 0 },
      { ts: 3, node: 1 },
    ];
    const buf = makeEventBuf(events);
    const { byNode } = buildEventIndex(buf, 3, 3);
    expect(byNode[0].length).toBe(2);
    expect(byNode[1].length).toBe(1);
    expect(byNode[2].length).toBe(0);
  });
});

describe('upperBound', () => {
  it('returns 0 for an empty array', () => {
    expect(upperBound([], 5)).toBe(0);
  });

  it('returns the length when all elements are <= target', () => {
    expect(upperBound([1, 2, 3], 3)).toBe(3);
  });

  it('returns 0 when all elements are > target', () => {
    expect(upperBound([2, 4, 6], 1)).toBe(0);
  });

  it('returns the index immediately after the last equal element', () => {
    // [1, 2, 2, 3]: target=2 → first index where arr[i] > 2 is 3
    expect(upperBound([1, 2, 2, 3], 2)).toBe(3);
  });

  it('works when target falls between two elements', () => {
    // [10, 20, 30]: target=15 → first index > 15 is 1
    expect(upperBound([10, 20, 30], 15)).toBe(1);
  });

  it('works for a single-element array where target equals the element', () => {
    expect(upperBound([7], 7)).toBe(1);
  });

  it('works for a single-element array where target is less', () => {
    expect(upperBound([7], 6)).toBe(0);
  });

  it('works for a single-element array where target is greater', () => {
    expect(upperBound([7], 8)).toBe(1);
  });

  it('handles duplicate target values spanning the full array', () => {
    expect(upperBound([5, 5, 5, 5], 5)).toBe(4);
  });
});

describe('countBefore', () => {
  it('returns 0 for an empty array', () => {
    expect(countBefore(new Int32Array(0), 5)).toBe(0);
  });

  it('returns 0 when all elements are >= limit', () => {
    expect(countBefore(new Int32Array([5, 6, 7]), 5)).toBe(0);
  });

  it('returns the full length when all elements are < limit', () => {
    expect(countBefore(new Int32Array([1, 2, 3]), 4)).toBe(3);
  });

  it('excludes elements equal to limit (strictly less than)', () => {
    expect(countBefore(new Int32Array([1, 2, 3, 3, 4]), 3)).toBe(2);
  });

  it('handles a sorted array with the limit between two values', () => {
    expect(countBefore(new Int32Array([10, 20, 30, 40]), 25)).toBe(2);
  });

  it('returns correct count for a single-element array', () => {
    expect(countBefore(new Int32Array([5]), 5)).toBe(0);
    expect(countBefore(new Int32Array([4]), 5)).toBe(1);
  });

  it('handles negative values', () => {
    expect(countBefore(new Int32Array([-3, -2, -1, 0, 1]), 0)).toBe(3);
  });
});

describe('escapeHtml', () => {
  it('returns the original string when there is nothing to escape', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('escapes ampersands', () => {
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than signs', () => {
    expect(escapeHtml('<tag>')).toBe('&lt;tag&gt;');
  });

  it('escapes greater-than signs', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quotes', () => {
    expect(escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
  });

  it('escapes all special characters at once', () => {
    expect(escapeHtml('<a href="x&y">z</a>')).toBe(
      '&lt;a href=&quot;x&amp;y&quot;&gt;z&lt;/a&gt;'
    );
  });

  it('handles multiple consecutive special characters', () => {
    expect(escapeHtml('<<<')).toBe('&lt;&lt;&lt;');
  });

  it('returns an empty string unchanged', () => {
    expect(escapeHtml('')).toBe('');
  });
});
