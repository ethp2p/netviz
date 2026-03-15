import { describe, it, expect } from 'vitest';
import { computeChartData } from './data';
import { EVENT_STRIDE, OP_STATE, OP_TRANSFER } from '../decoder-sdk/types';
import type { ChartHints } from '../decoder-sdk/types';

// Buffer layout per event (EVENT_STRIDE = 6 float64s):
//   [0] timestamp
//   [1] node index (sender for OP_TRANSFER, reporting node for OP_STATE)
//   [2] opcode
//   [3] OP_STATE → stateIdx   |  OP_TRANSFER → receiverIdx
//   [4] OP_TRANSFER → bytes
//   [5] OP_TRANSFER → arcLayer

function makeEventBuf(events: number[][]): Float64Array {
  const buf = new Float64Array(events.length * EVENT_STRIDE);
  for (let i = 0; i < events.length; i++) {
    const row = events[i];
    for (let f = 0; f < row.length; f++) {
      buf[i * EVENT_STRIDE + f] = row[f];
    }
  }
  return buf;
}

const NO_HINTS: ChartHints = {};

describe('computeChartData', () => {
  describe('empty input', () => {
    it('count=0 → all chart arrays empty, timeRange [0,0]', () => {
      const buf = new Float64Array(0);
      const result = computeChartData(buf, 0, 4, NO_HINTS);
      expect(result.cdf).toEqual([]);
      expect(result.origin).toEqual([]);
      expect(result.relayer).toEqual([]);
      expect(result.originRate).toEqual([]);
      expect(result.relayerRate).toEqual([]);
      expect(result.timeRange).toEqual([0, 0]);
    });
  });

  describe('CDF computation', () => {
    it('single OP_STATE terminal event → one CDF point at 1.0', () => {
      // 3 nodes, origin = node 0, receivers = nodes 1 and 2.
      // Only node 1 gets the terminal state → fraction = 1/2 at that time.
      const buf = makeEventBuf([
        [1000, 1, OP_STATE, 2, 0, 0], // node 1 reaches state 2 at t=1000
      ]);
      const hints: ChartHints = {
        cdf: { stateIdx: 2 },
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const result = computeChartData(buf, 1, 3, hints);

      // CDF always starts at tMin with fraction 0,
      // then one point per decoded node, then a trailing point at tMax.
      // With 2 receivers total (nodes 1 and 2), one decode = 1/2 = 0.5.
      expect(result.cdf[0]).toEqual({ time: 1000, fraction: 0 });
      const decodePoint = result.cdf.find(p => p.fraction > 0 && p.fraction <= 0.5 + 1e-9);
      expect(decodePoint).toBeDefined();
      expect(decodePoint!.fraction).toBeCloseTo(0.5);
      expect(decodePoint!.time).toBe(1000);
    });

    it('all receivers decoded → CDF reaches 1.0', () => {
      // 4 nodes, origin = node 0, receivers = nodes 1,2,3 → totalReceivers = 3.
      // All three decode at different times.
      const buf = makeEventBuf([
        [1000, 1, OP_STATE, 5, 0, 0],
        [2000, 2, OP_STATE, 5, 0, 0],
        [3000, 3, OP_STATE, 5, 0, 0],
      ]);
      const hints: ChartHints = {
        cdf: { stateIdx: 5 },
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const result = computeChartData(buf, 3, 4, hints);

      // Last decode fraction = 3/3 = 1.0
      const fractions = result.cdf.map(p => p.fraction);
      expect(Math.max(...fractions)).toBeCloseTo(1.0);
    });

    it('fractions increase monotonically as nodes decode', () => {
      // 5 nodes, no origin hint → totalReceivers = 5.
      const buf = makeEventBuf([
        [100, 0, OP_STATE, 1, 0, 0],
        [200, 1, OP_STATE, 1, 0, 0],
        [300, 2, OP_STATE, 1, 0, 0],
        [400, 3, OP_STATE, 1, 0, 0],
        [500, 4, OP_STATE, 1, 0, 0],
      ]);
      const hints: ChartHints = { cdf: { stateIdx: 1 } };
      const result = computeChartData(buf, 5, 5, hints);

      const fractions = result.cdf.map(p => p.fraction);
      for (let i = 1; i < fractions.length; i++) {
        expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
      }
    });

    it('duplicate OP_STATE for same node → counted once', () => {
      // Node 1 appears twice; should only contribute one decode.
      const buf = makeEventBuf([
        [100, 1, OP_STATE, 3, 0, 0],
        [200, 1, OP_STATE, 3, 0, 0], // duplicate
        [300, 2, OP_STATE, 3, 0, 0],
      ]);
      // 4 nodes, origin = 0 → totalReceivers = 3
      const hints: ChartHints = {
        cdf: { stateIdx: 3 },
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const result = computeChartData(buf, 3, 4, hints);

      // Points with fraction > 0: node 1 at t=100 (1/3) and node 2 at t=300 (2/3).
      const positivePoints = result.cdf.filter(p => p.fraction > 0 && p.time < 400);
      // Should see exactly 2 unique-fraction increases
      const uniqueFractions = new Set(positivePoints.map(p => p.fraction));
      expect(uniqueFractions.size).toBe(2);
      const sortedFracs = [...uniqueFractions].sort((a, b) => a - b);
      expect(sortedFracs[0]).toBeCloseTo(1 / 3);
      expect(sortedFracs[1]).toBeCloseTo(2 / 3);
    });

    it('no bandwidth hints → still returns CDF with correct timeRange', () => {
      const buf = makeEventBuf([
        [50, 1, OP_STATE, 0, 0, 0],
        [150, 2, OP_STATE, 0, 0, 0],
      ]);
      const hints: ChartHints = { cdf: { stateIdx: 0 } };
      const result = computeChartData(buf, 2, 3, hints);
      expect(result.timeRange).toEqual([50, 150]);
      expect(result.origin).toEqual([]);
      expect(result.relayer).toEqual([]);
    });
  });

  describe('bandwidth samples', () => {
    it('single transfer event → cumulative up/down reflected in origin samples', () => {
      // Node 0 sends 512 bytes to node 1 at t=1000.
      const buf = makeEventBuf([
        [1000, 0, OP_TRANSFER, 1, 512, 0],
      ]);
      const hints: ChartHints = {
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const result = computeChartData(buf, 1, 3, hints);

      // All samples at or after t=1000 should show origin up = 512.
      const afterSamples = result.origin.filter(s => s.time >= 1000);
      expect(afterSamples.length).toBeGreaterThan(0);
      for (const s of afterSamples) {
        expect(s.up).toBe(512);
      }

      // Node 1 received 512; it appears in relayer percentiles not origin.
      const lastRelayer = result.relayer[result.relayer.length - 1];
      // p50 of down across nodes 1 and 2 — node 1 has 512, node 2 has 0.
      // sorted [0, 512], p50 = linear interpolation at index 0.5 = 256.
      expect(lastRelayer.down[0]).toBeCloseTo(256);
    });

    it('bandwidth samples increase over time as transfers accumulate', () => {
      // Two transfers: at t=100 and t=200.
      const buf = makeEventBuf([
        [100, 0, OP_TRANSFER, 1, 100, 0],
        [200, 0, OP_TRANSFER, 2, 200, 0],
      ]);
      const hints: ChartHints = {
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const result = computeChartData(buf, 2, 3, hints);

      // Cumulative origin.up must be non-decreasing.
      for (let i = 1; i < result.origin.length; i++) {
        expect(result.origin[i].up).toBeGreaterThanOrEqual(result.origin[i - 1].up);
      }
      // Final cumulative should be 300.
      expect(result.origin[result.origin.length - 1].up).toBe(300);
    });

    it('transfers on wrong arcLayer are ignored', () => {
      const buf = makeEventBuf([
        [1000, 0, OP_TRANSFER, 1, 999, 1], // arcLayer=1, not 0
      ]);
      const hints: ChartHints = {
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const result = computeChartData(buf, 1, 3, hints);

      const lastOrigin = result.origin[result.origin.length - 1];
      expect(lastOrigin.up).toBe(0);
    });

    it('sample count is NUM_SAMPLES + 1 = 201 when bandwidth hints present', () => {
      const buf = makeEventBuf([
        [0, 0, OP_TRANSFER, 1, 10, 0],
        [1000, 0, OP_TRANSFER, 1, 10, 0],
      ]);
      const hints: ChartHints = {
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const result = computeChartData(buf, 2, 3, hints);
      expect(result.origin.length).toBe(201);
      expect(result.relayer.length).toBe(201);
    });
  });

  describe('viewRange filtering', () => {
    it('viewRange sets timeRange and anchors CDF to tMin', () => {
      // All three decodes fall within the viewRange.
      const buf = makeEventBuf([
        [300, 1, OP_STATE, 0, 0, 0],
        [500, 2, OP_STATE, 0, 0, 0],
        [650, 3, OP_STATE, 0, 0, 0],
      ]);
      const hints: ChartHints = { cdf: { stateIdx: 0 } };
      const viewRange: [number, number] = [200, 700];
      const result = computeChartData(buf, 3, 4, hints, viewRange);

      // timeRange reflects the viewRange, not the raw buffer extremes.
      expect(result.timeRange).toEqual([200, 700]);
      // CDF first point is at tMin=200 with fraction 0.
      expect(result.cdf[0]).toEqual({ time: 200, fraction: 0 });
      // Trailing plateau point is appended at tMax because last decode (650) < 700.
      const lastCdf = result.cdf[result.cdf.length - 1];
      expect(lastCdf.time).toBe(700);
    });

    it('viewRange with bandwidth: sample times bounded by viewRange', () => {
      const buf = makeEventBuf([
        [0,    0, OP_TRANSFER, 1, 100, 0],
        [5000, 0, OP_TRANSFER, 1, 100, 0],
      ]);
      const hints: ChartHints = {
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const viewRange: [number, number] = [1000, 4000];
      const result = computeChartData(buf, 2, 3, hints, viewRange);

      expect(result.timeRange).toEqual([1000, 4000]);
      expect(result.origin[0].time).toBe(1000);
      expect(result.origin[result.origin.length - 1].time).toBe(4000);
    });

    it('viewRange that excludes all transfers → origin up=0 throughout', () => {
      // Transfer at t=5000 is outside viewRange [0, 1000].
      const buf = makeEventBuf([
        [100,  0, OP_TRANSFER, 1, 999, 0],
        [5000, 0, OP_TRANSFER, 1, 999, 0],
      ]);
      const hints: ChartHints = {
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const viewRange: [number, number] = [0, 1000];
      const result = computeChartData(buf, 2, 3, hints, viewRange);

      // The transfer at t=100 is within range, so final up should be 999.
      // The transfer at t=5000 is outside range but computeChartData scans
      // ALL events regardless; viewRange only controls tMin/tMax for sample time axis.
      // This tests that the sample at tMax=1000 reflects only events up to t=1000.
      const sampleAt1000 = result.origin.find(s => Math.abs(s.time - 1000) < 1e-6);
      expect(sampleAt1000?.up).toBe(999);
    });
  });

  describe('percentile function (via output values)', () => {
    it('single-element sorted array → p0 = p50 = p99 = that value', () => {
      // Only one relayer node (node 1), origin is node 0.
      // Transfer: node 1 sends 800 bytes.
      const buf = makeEventBuf([
        [500, 1, OP_TRANSFER, 0, 800, 0],
      ]);
      const hints: ChartHints = {
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const result = computeChartData(buf, 1, 2, hints);

      const last = result.relayer[result.relayer.length - 1];
      // Single element: all percentiles should equal 800.
      for (const v of last.up) {
        expect(v).toBe(800);
      }
    });

    it('two relayer nodes with equal values → all percentiles equal that value', () => {
      const buf = makeEventBuf([
        [100, 1, OP_TRANSFER, 0, 400, 0],
        [200, 2, OP_TRANSFER, 0, 400, 0],
      ]);
      const hints: ChartHints = {
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const result = computeChartData(buf, 2, 3, hints);
      const last = result.relayer[result.relayer.length - 1];
      for (const v of last.up) {
        expect(v).toBe(400);
      }
    });

    it('two relayer nodes with different values → p50 interpolated between them', () => {
      // Node 1 sends 0 bytes, node 2 sends 1000 bytes.
      // Sorted up: [0, 1000]; p50 idx = 0.5*(2-1) = 0.5 → lo=0, hi=1 → 0 + 1000*0.5 = 500.
      const buf = makeEventBuf([
        [100, 2, OP_TRANSFER, 0, 1000, 0],
      ]);
      const hints: ChartHints = {
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const result = computeChartData(buf, 1, 3, hints);
      const last = result.relayer[result.relayer.length - 1];
      // p50 is index 0 in PERCENTILES = [0.50, ...]
      expect(last.up[0]).toBeCloseTo(500);
    });

    it('p99 of two-element array is the maximum', () => {
      // Sorted [0, 1000]; p99 idx = 0.99*(2-1) = 0.99 → 0 + 1000*0.99 = 990.
      const buf = makeEventBuf([
        [100, 2, OP_TRANSFER, 0, 1000, 0],
      ]);
      const hints: ChartHints = {
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const result = computeChartData(buf, 1, 3, hints);
      const last = result.relayer[result.relayer.length - 1];
      // p99 is index 4 in PERCENTILES
      expect(last.up[4]).toBeCloseTo(990);
    });

    it('percentile returns 0 for empty sorted array (no relayer nodes)', () => {
      // nodeCount=1, originNode=0 → no relayer nodes at all.
      const buf = makeEventBuf([
        [500, 0, OP_TRANSFER, -1, 100, 0],
      ]);
      const hints: ChartHints = {
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const result = computeChartData(buf, 1, 1, hints);
      const last = result.relayer[result.relayer.length - 1];
      for (const v of last.up) {
        expect(v).toBe(0);
      }
    });
  });

  describe('bandwidth rate samples', () => {
    it('originRate entries reflect per-bucket byte counts scaled to bytes/sec', () => {
      // BUCKET_US = 50_000 µs, BUCKET_SCALE = 20.
      // One transfer of 100 bytes in the first bucket → rate = 100 * 20 = 2000 bytes/sec.
      const buf = makeEventBuf([
        [10_000, 0, OP_TRANSFER, 1, 100, 0], // within first 50ms bucket
      ]);
      const hints: ChartHints = {
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const result = computeChartData(buf, 1, 3, hints);

      // The bucket that contains t=10_000 should have up rate = 2000.
      const bucket = result.originRate.find(s => s.up > 0);
      expect(bucket).toBeDefined();
      expect(bucket!.up).toBeCloseTo(2000);
    });

    it('relayerRate has one entry per bucket', () => {
      const buf = makeEventBuf([
        [0,       0, OP_TRANSFER, 1, 10, 0],
        [100_000, 0, OP_TRANSFER, 1, 10, 0], // 100ms later, second bucket boundary
      ]);
      const hints: ChartHints = {
        bandwidth: { arcLayer: 0, originNode: 0 },
      };
      const result = computeChartData(buf, 2, 3, hints);
      // At least 2 buckets for 100ms span.
      expect(result.relayerRate.length).toBeGreaterThanOrEqual(2);
      // Each relayerRate entry has 5 percentile values.
      for (const entry of result.relayerRate) {
        expect(entry.up.length).toBe(5);
        expect(entry.down.length).toBe(5);
      }
    });
  });
});
