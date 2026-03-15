import type { ChartHints } from '../decoder-sdk';
import { EVENT_STRIDE, OP_STATE, OP_TRANSFER } from '../decoder-sdk';

export interface CdfPoint {
  time: number;
  fraction: number;
}

export interface BandwidthSample {
  time: number;
  up: number;
  down: number;
}

export interface PercentileSample {
  time: number;
  up: number[];   // [p50, p80, p90, p95, p99]
  down: number[];
}

export interface RateSample {
  time: number;
  up: number;   // bytes/sec (extrapolated from 50ms buckets)
  down: number;
}

export interface PercentileRateSample {
  time: number;
  up: number[];   // [p50, p80, p90, p95, p99] bytes/sec
  down: number[];
}

export interface ChartData {
  cdf: CdfPoint[];
  origin: BandwidthSample[];
  relayer: PercentileSample[];
  originRate: RateSample[];
  relayerRate: PercentileRateSample[];
  timeRange: [number, number];
}

const PERCENTILES = [0.50, 0.80, 0.90, 0.95, 0.99];
const NUM_SAMPLES = 200;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function computeChartData(
  buf: Float64Array,
  count: number,
  nodeCount: number,
  hints: ChartHints,
  viewRange?: [number, number],
): ChartData {
  const n = nodeCount;
  const empty: ChartData = { cdf: [], origin: [], relayer: [], originRate: [], relayerRate: [], timeRange: [0, 0] };

  if (count === 0) return empty;

  const tMin = viewRange ? viewRange[0] : buf[0];
  const tMax = viewRange ? viewRange[1] : buf[(count - 1) * EVENT_STRIDE];

  const originIdx = hints.bandwidth?.originNode ?? -1;

  // CDF: collect first-per-node decode timestamps for the terminal state
  const cdf: CdfPoint[] = [];
  if (hints.cdf !== undefined) {
    const { stateIdx } = hints.cdf;
    const totalReceivers = n - (hints.bandwidth?.originNode != null ? 1 : 0);
    const firstDecodeTs = new Float64Array(n).fill(-1);

    for (let i = 0; i < count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === OP_STATE && buf[base + 3] === stateIdx) {
        const node = buf[base + 1];
        if (firstDecodeTs[node] < 0) firstDecodeTs[node] = buf[base];
      }
    }

    const decodeTimes: number[] = [];
    for (let i = 0; i < n; i++) {
      if (firstDecodeTs[i] >= 0) decodeTimes.push(firstDecodeTs[i]);
    }
    decodeTimes.sort((a, b) => a - b);

    cdf.push({ time: tMin, fraction: 0 });
    for (let i = 0; i < decodeTimes.length; i++) {
      cdf.push({ time: decodeTimes[i], fraction: (i + 1) / Math.max(1, totalReceivers) });
    }
    if (cdf.length > 0 && cdf[cdf.length - 1].time < tMax) {
      cdf.push({ time: tMax, fraction: cdf[cdf.length - 1].fraction });
    }
  }

  // Bandwidth: skip entirely if no hints
  if (hints.bandwidth === undefined) {
    return { cdf, origin: [], relayer: [], originRate: [], relayerRate: [], timeRange: [tMin, tMax] };
  }

  const { arcLayer } = hints.bandwidth;

  // Bandwidth samples at regular intervals
  const dt = (tMax - tMin) / NUM_SAMPLES;
  const sampleTimes: number[] = [];
  for (let i = 0; i <= NUM_SAMPLES; i++) {
    sampleTimes.push(tMin + i * dt);
  }

  // --- Cumulative traffic (200 evenly-spaced samples) ---
  const nodeUp = new Float64Array(n);
  const nodeDown = new Float64Array(n);

  let evIdx = 0;
  const origin: BandwidthSample[] = [];
  const relayer: PercentileSample[] = [];

  for (const sampleTime of sampleTimes) {
    while (evIdx < count && buf[evIdx * EVENT_STRIDE] <= sampleTime) {
      const base = evIdx * EVENT_STRIDE;
      if (buf[base + 2] === OP_TRANSFER && buf[base + 5] === arcLayer) {
        const senderIdx = buf[base + 1];
        const bytes = buf[base + 4];
        const receiverIdx = buf[base + 3];
        nodeUp[senderIdx] += bytes;
        if (receiverIdx >= 0 && receiverIdx < n) {
          nodeDown[receiverIdx] += bytes;
        }
      }
      evIdx++;
    }

    if (originIdx >= 0) {
      origin.push({ time: sampleTime, up: nodeUp[originIdx], down: nodeDown[originIdx] });
    }

    const relUp: number[] = [];
    const relDown: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i === originIdx) continue;
      relUp.push(nodeUp[i]);
      relDown.push(nodeDown[i]);
    }
    relUp.sort((a, b) => a - b);
    relDown.sort((a, b) => a - b);

    relayer.push({
      time: sampleTime,
      up: PERCENTILES.map(p => percentile(relUp, p)),
      down: PERCENTILES.map(p => percentile(relDown, p)),
    });
  }

  // --- Bandwidth rate (50ms buckets, extrapolated to bytes/sec) ---
  const BUCKET_US = 50_000; // 50ms in microseconds
  const BUCKET_SCALE = 1_000_000 / BUCKET_US; // multiplier to extrapolate to per-second
  const bucketStart = Math.floor(tMin / BUCKET_US) * BUCKET_US;
  const bucketEnd = Math.ceil(tMax / BUCKET_US) * BUCKET_US;
  const numBuckets = Math.max(1, Math.round((bucketEnd - bucketStart) / BUCKET_US));

  const bucketNodeUp: Float64Array[] = [];
  const bucketNodeDown: Float64Array[] = [];
  for (let b = 0; b < numBuckets; b++) {
    bucketNodeUp.push(new Float64Array(n));
    bucketNodeDown.push(new Float64Array(n));
  }

  for (let i = 0; i < count; i++) {
    const base = i * EVENT_STRIDE;
    if (buf[base + 2] !== OP_TRANSFER || buf[base + 5] !== arcLayer) continue;
    const ts = buf[base];
    if (ts < bucketStart || ts >= bucketEnd) continue;
    const bi = Math.min(numBuckets - 1, Math.floor((ts - bucketStart) / BUCKET_US));
    const senderIdx = buf[base + 1];
    const bytes = buf[base + 4];
    const receiverIdx = buf[base + 3];

    bucketNodeUp[bi][senderIdx] += bytes;
    if (receiverIdx >= 0 && receiverIdx < n) {
      bucketNodeDown[bi][receiverIdx] += bytes;
    }
  }

  const originRate: RateSample[] = [];
  const relayerRate: PercentileRateSample[] = [];

  for (let b = 0; b < numBuckets; b++) {
    const t = bucketStart + (b + 0.5) * BUCKET_US; // bucket midpoint
    const bUp = bucketNodeUp[b];
    const bDown = bucketNodeDown[b];

    if (originIdx >= 0) {
      originRate.push({ time: t, up: bUp[originIdx] * BUCKET_SCALE, down: bDown[originIdx] * BUCKET_SCALE });
    }

    const rateUp: number[] = [];
    const rateDown: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i === originIdx) continue;
      rateUp.push(bUp[i] * BUCKET_SCALE);
      rateDown.push(bDown[i] * BUCKET_SCALE);
    }
    rateUp.sort((a, b) => a - b);
    rateDown.sort((a, b) => a - b);

    relayerRate.push({
      time: t,
      up: PERCENTILES.map(p => percentile(rateUp, p)),
      down: PERCENTILES.map(p => percentile(rateDown, p)),
    });
  }

  return { cdf, origin, relayer, originRate, relayerRate, timeRange: [tMin, tMax] };
}
