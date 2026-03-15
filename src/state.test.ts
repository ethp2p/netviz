import { describe, it, expect } from 'vitest';
import {
  createIncrementalState,
  resetIncrementalState,
  restoreCheckpoint,
  advanceStateTo,
  type IncrementalState,
} from './state';
import { OP_STATE, OP_TRANSFER, OP_PROGRESS, OP_METRIC, EVENT_STRIDE } from './decoder-sdk';
import type { ArcLayerDef, MetricDef } from './decoder-sdk';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeArcLayer(lifetimeUs = 100_000): ArcLayerDef {
  return {
    name: 'test',
    color: [255, 255, 255, 255],
    lifetimeUs,
    travelUs: 10_000,
    radius: 5,
  };
}

function makeMetricDef(aggregate: 'sum' | 'last' = 'sum', overlay?: 'ring'): MetricDef {
  return { name: 'metric', format: 'count', aggregate, overlay };
}

/**
 * Builds a Float64Array event buffer from plain event tuples.
 * Each tuple: [ts, nodeIdx, opCode, arg0, arg1, arg2]
 */
function makeEventBuf(events: [number, number, number, number, number, number][]): Float64Array {
  const buf = new Float64Array(events.length * EVENT_STRIDE);
  for (let i = 0; i < events.length; i++) {
    const base = i * EVENT_STRIDE;
    const [ts, node, op, a0, a1, a2] = events[i];
    buf[base + 0] = ts;
    buf[base + 1] = node;
    buf[base + 2] = op;
    buf[base + 3] = a0;
    buf[base + 4] = a1;
    buf[base + 5] = a2;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// createIncrementalState
// ---------------------------------------------------------------------------

describe('createIncrementalState', () => {
  it('initializes nodeStates with correct count and zeroed fields', () => {
    const s = createIncrementalState(4, 2, 1);
    expect(s.nodeStates).toHaveLength(4);
    for (const ns of s.nodeStates) {
      expect(ns.state).toBe(0);
      expect(ns.lastChunkTime).toBe(0);
      expect(ns.chunksHave).toBe(0);
      expect(ns.chunksNeed).toBe(0);
      expect(ns.metrics).toHaveLength(2);
      expect(ns.metrics.every(v => v === 0)).toBe(true);
    }
  });

  it('creates one arc bucket per arcLayerCount', () => {
    const s = createIncrementalState(2, 0, 3);
    expect(s.arcBuckets).toHaveLength(3);
    for (const b of s.arcBuckets) {
      expect(b).toEqual([]);
    }
  });

  it('initializes globalStats with zeroed metrics array', () => {
    const s = createIncrementalState(1, 5, 0);
    expect(s.globalStats.metrics).toHaveLength(5);
    expect(s.globalStats.metrics.every(v => v === 0)).toBe(true);
  });

  it('sets lastComputedIdx to -1 and empty checkpoints', () => {
    const s = createIncrementalState(2, 1, 1);
    expect(s.lastComputedIdx).toBe(-1);
    expect(s.checkpoints).toEqual([]);
    expect(s.eventsSinceCheckpoint).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resetIncrementalState
// ---------------------------------------------------------------------------

describe('resetIncrementalState', () => {
  it('clears all state back to initial values', () => {
    const s = createIncrementalState(3, 1, 2);

    // Dirty it
    s.nodeStates[0].state = 7;
    s.nodeStates[0].chunksHave = 10;
    s.arcBuckets[0].push({ from: 0, to: 1, startTime: 1000, bytes: 512, layer: 0 });
    s.globalStats.metrics[0] = 99;
    s.lastComputedIdx = 42;
    s.eventsSinceCheckpoint = 10;

    resetIncrementalState(s, 3, 1, 2);

    expect(s.nodeStates).toHaveLength(3);
    expect(s.nodeStates[0].state).toBe(0);
    expect(s.nodeStates[0].chunksHave).toBe(0);
    expect(s.arcBuckets).toHaveLength(2);
    expect(s.arcBuckets[0]).toEqual([]);
    expect(s.globalStats.metrics[0]).toBe(0);
    expect(s.lastComputedIdx).toBe(-1);
    expect(s.checkpoints).toEqual([]);
    expect(s.eventsSinceCheckpoint).toBe(0);
  });

  it('can change dimensions on reset', () => {
    const s = createIncrementalState(2, 1, 1);
    resetIncrementalState(s, 5, 3, 4);
    expect(s.nodeStates).toHaveLength(5);
    expect(s.nodeStates[4].metrics).toHaveLength(3);
    expect(s.arcBuckets).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// advanceStateTo — OP_STATE
// ---------------------------------------------------------------------------

describe('advanceStateTo — OP_STATE', () => {
  it('updates nodeStates[node].state from an OP_STATE event', () => {
    const s = createIncrementalState(3, 0, 0);
    const buf = makeEventBuf([
      [1000, 1, OP_STATE, 2, 0, 0],
    ]);
    advanceStateTo(s, 1000, 1, buf, [], [], [], []);
    expect(s.nodeStates[1].state).toBe(2);
  });

  it('sets lastChunkTime to the event timestamp', () => {
    const s = createIncrementalState(2, 0, 0);
    const buf = makeEventBuf([
      [5000, 0, OP_STATE, 3, 0, 0],
    ]);
    advanceStateTo(s, 5000, 1, buf, [], [], [], []);
    expect(s.nodeStates[0].lastChunkTime).toBe(5000);
  });

  it('applies multiple OP_STATE events in sequence', () => {
    const s = createIncrementalState(2, 0, 0);
    const buf = makeEventBuf([
      [1000, 0, OP_STATE, 1, 0, 0],
      [2000, 1, OP_STATE, 2, 0, 0],
      [3000, 0, OP_STATE, 3, 0, 0],
    ]);
    advanceStateTo(s, 3000, 3, buf, [], [], [], []);
    expect(s.nodeStates[0].state).toBe(3);
    expect(s.nodeStates[1].state).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// advanceStateTo — OP_PROGRESS
// ---------------------------------------------------------------------------

describe('advanceStateTo — OP_PROGRESS', () => {
  it('updates chunksHave and chunksNeed', () => {
    const s = createIncrementalState(2, 0, 0);
    const buf = makeEventBuf([
      [1000, 0, OP_PROGRESS, 5, 10, 0],
    ]);
    advanceStateTo(s, 1000, 1, buf, [], [], [], []);
    expect(s.nodeStates[0].chunksHave).toBe(5);
    expect(s.nodeStates[0].chunksNeed).toBe(10);
  });

  it('overwrites previous chunksHave/chunksNeed on subsequent event', () => {
    const s = createIncrementalState(2, 0, 0);
    const buf = makeEventBuf([
      [1000, 0, OP_PROGRESS, 5, 10, 0],
      [2000, 0, OP_PROGRESS, 8, 10, 0],
    ]);
    advanceStateTo(s, 2000, 2, buf, [], [], [], []);
    expect(s.nodeStates[0].chunksHave).toBe(8);
    expect(s.nodeStates[0].chunksNeed).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// advanceStateTo — OP_METRIC
// ---------------------------------------------------------------------------

describe('advanceStateTo — OP_METRIC', () => {
  it('accumulates metric value for aggregate=sum', () => {
    const s = createIncrementalState(2, 1, 0);
    const metricDefs: MetricDef[] = [makeMetricDef('sum')];
    const overlayMaxes: number[][] = [[]];
    const buf = makeEventBuf([
      [1000, 0, OP_METRIC, 0, 3, 0],
      [2000, 0, OP_METRIC, 0, 7, 0],
    ]);
    advanceStateTo(s, 2000, 2, buf, [], [], metricDefs, overlayMaxes);
    expect(s.nodeStates[0].metrics[0]).toBe(10);
    expect(s.globalStats.metrics[0]).toBe(10);
  });

  it('replaces metric value for aggregate=last', () => {
    const s = createIncrementalState(2, 1, 0);
    const metricDefs: MetricDef[] = [makeMetricDef('last')];
    const overlayMaxes: number[][] = [[]];
    const buf = makeEventBuf([
      [1000, 0, OP_METRIC, 0, 3, 0],
      [2000, 0, OP_METRIC, 0, 7, 0],
    ]);
    advanceStateTo(s, 2000, 2, buf, [], [], metricDefs, overlayMaxes);
    expect(s.nodeStates[0].metrics[0]).toBe(7);
    expect(s.globalStats.metrics[0]).toBe(7);
  });

  it('updates overlayMaxes for overlay=ring metric', () => {
    const s = createIncrementalState(3, 1, 0);
    const metricDefs: MetricDef[] = [makeMetricDef('sum', 'ring')];
    const overlayMaxes: number[][] = [[0, 0, 0]];
    const buf = makeEventBuf([
      [1000, 1, OP_METRIC, 0, 50, 0],
    ]);
    advanceStateTo(s, 1000, 1, buf, [], [], metricDefs, overlayMaxes);
    expect(overlayMaxes[0][1]).toBe(50);
    // Other nodes untouched
    expect(overlayMaxes[0][0]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// advanceStateTo — OP_TRANSFER (arc creation)
// ---------------------------------------------------------------------------

describe('advanceStateTo — OP_TRANSFER', () => {
  it('adds an arc to the correct arcBucket when layer is enabled', () => {
    const s = createIncrementalState(3, 0, 1);
    const arcLayers: ArcLayerDef[] = [makeArcLayer(100_000)];
    const enabledArcLayers = [true];
    // Event at t=1000; currentT=1000 → age=0 < lifetimeUs
    const buf = makeEventBuf([
      [1000, 0, OP_TRANSFER, 2, 512, 0],
    ]);
    advanceStateTo(s, 1000, 1, buf, arcLayers, enabledArcLayers, [], []);
    expect(s.arcBuckets[0]).toHaveLength(1);
    const arc = s.arcBuckets[0][0];
    expect(arc.from).toBe(0);
    expect(arc.to).toBe(2);
    expect(arc.bytes).toBe(512);
    expect(arc.layer).toBe(0);
    expect(arc.startTime).toBe(1000);
  });

  it('does not add an arc when layer is disabled', () => {
    const s = createIncrementalState(3, 0, 1);
    const arcLayers: ArcLayerDef[] = [makeArcLayer(100_000)];
    const enabledArcLayers = [false];
    const buf = makeEventBuf([
      [1000, 0, OP_TRANSFER, 2, 256, 0],
    ]);
    advanceStateTo(s, 1000, 1, buf, arcLayers, enabledArcLayers, [], []);
    expect(s.arcBuckets[0]).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// advanceStateTo — idempotency
// ---------------------------------------------------------------------------

describe('advanceStateTo — idempotency', () => {
  it('does not re-apply events when called with the same endIdx', () => {
    const s = createIncrementalState(3, 0, 0);
    const buf = makeEventBuf([
      [1000, 0, OP_STATE, 1, 0, 0],
    ]);
    advanceStateTo(s, 1000, 1, buf, [], [], [], []);
    expect(s.nodeStates[0].state).toBe(1);

    // Mutate the buffer to a different state value; a re-application would pick it up
    buf[3] = 99;
    advanceStateTo(s, 1000, 1, buf, [], [], [], []);
    // State should still be 1, not 99
    expect(s.nodeStates[0].state).toBe(1);
  });

  it('does not advance when endIdx is less than lastComputedIdx', () => {
    const s = createIncrementalState(3, 0, 0);
    const buf = makeEventBuf([
      [1000, 0, OP_STATE, 1, 0, 0],
      [2000, 0, OP_STATE, 2, 0, 0],
    ]);
    advanceStateTo(s, 2000, 2, buf, [], [], [], []);
    expect(s.nodeStates[0].state).toBe(2);

    // Try to rewind by calling with smaller endIdx — should be a no-op
    buf[0 * EVENT_STRIDE + 3] = 99;
    advanceStateTo(s, 2000, 1, buf, [], [], [], []);
    expect(s.nodeStates[0].state).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// restoreCheckpoint
// ---------------------------------------------------------------------------

describe('restoreCheckpoint', () => {
  it('returns false when there are no checkpoints', () => {
    const s = createIncrementalState(2, 0, 1);
    expect(restoreCheckpoint(s, 100)).toBe(false);
  });

  it('returns false when all checkpoints are beyond targetIdx', () => {
    // Manufacture a checkpoint at eventIdx=100 by advancing past CHECKPOINT_INTERVAL
    const nodeCount = 2;
    const s = createIncrementalState(nodeCount, 0, 0);
    // CHECKPOINT_INTERVAL = 5000, so feed 5001 events
    const eventCount = 5001;
    const events: [number, number, number, number, number, number][] = [];
    for (let i = 0; i < eventCount; i++) {
      events.push([i * 10, 0, OP_STATE, 1, 0, 0]);
    }
    const buf = makeEventBuf(events);
    advanceStateTo(s, eventCount * 10, eventCount, buf, [], [], [], []);
    expect(s.checkpoints.length).toBeGreaterThan(0);

    // Ask for a checkpoint before any exist (targetIdx = 0, checkpoints are at >=5000)
    expect(restoreCheckpoint(s, 0)).toBe(false);
  });

  it('restores state from the nearest prior checkpoint', () => {
    const s = createIncrementalState(2, 0, 1);
    const arcLayers: ArcLayerDef[] = [makeArcLayer(1_000_000)];
    const enabledArcLayers = [true];

    // Advance 5001 events to force a checkpoint at idx ~4999
    const eventCount = 5001;
    const events: [number, number, number, number, number, number][] = [];
    for (let i = 0; i < eventCount; i++) {
      // Node 0 transitions state each event
      events.push([i * 10, 0, OP_STATE, i % 5, 0, 0]);
    }
    const buf = makeEventBuf(events);
    advanceStateTo(s, eventCount * 10, eventCount, buf, arcLayers, enabledArcLayers, [], []);

    const idxAfterAdvance = s.lastComputedIdx;
    expect(s.checkpoints.length).toBeGreaterThan(0);

    // Restore to a point within the first checkpoint's range
    const targetIdx = s.checkpoints[0].eventIdx;
    const restored = restoreCheckpoint(s, targetIdx);
    expect(restored).toBe(true);

    // lastComputedIdx must be <= targetIdx
    expect(s.lastComputedIdx).toBeLessThanOrEqual(targetIdx);
    // Arc buckets are cleared on restore
    expect(s.arcBuckets[0]).toEqual([]);
    // eventsSinceCheckpoint is reset
    expect(s.eventsSinceCheckpoint).toBe(0);
    // The restored idx is less than where we were
    expect(s.lastComputedIdx).toBeLessThan(idxAfterAdvance);
  });

  it('trims checkpoints after the restored one', () => {
    const s = createIncrementalState(2, 0, 0);
    // Produce two checkpoints: advance 5001, then another 5001 events
    const firstPass = 5001;
    const secondPass = 5001;
    const totalEvents = firstPass + secondPass;
    const events: [number, number, number, number, number, number][] = [];
    for (let i = 0; i < totalEvents; i++) {
      events.push([i * 10, 0, OP_STATE, 1, 0, 0]);
    }
    const buf = makeEventBuf(events);
    advanceStateTo(s, totalEvents * 10, totalEvents, buf, [], [], [], []);
    expect(s.checkpoints.length).toBeGreaterThanOrEqual(2);

    // Restore to first checkpoint
    const firstCpIdx = s.checkpoints[0].eventIdx;
    restoreCheckpoint(s, firstCpIdx);

    // Only the first checkpoint (and anything at/before it) should remain
    for (const cp of s.checkpoints) {
      expect(cp.eventIdx).toBeLessThanOrEqual(firstCpIdx);
    }
  });
});

// ---------------------------------------------------------------------------
// Arc expiry
// ---------------------------------------------------------------------------

describe('arc expiry', () => {
  it('prunes arcs whose age >= lifetimeUs on the next advanceStateTo call', () => {
    const lifetimeUs = 50_000;
    const s = createIncrementalState(3, 0, 1);
    const arcLayers: ArcLayerDef[] = [makeArcLayer(lifetimeUs)];
    const enabledArcLayers = [true];

    // Place a transfer at t=1000
    const buf = makeEventBuf([
      [1000, 0, OP_TRANSFER, 1, 100, 0],
      [60_000, 2, OP_STATE, 1, 0, 0],
    ]);

    // First call: currentT=1000, arc age=0 → accepted
    advanceStateTo(s, 1000, 1, buf, arcLayers, enabledArcLayers, [], []);
    expect(s.arcBuckets[0]).toHaveLength(1);

    // Second call: currentT=1000+lifetimeUs=51000, age = 51000-1000 = 50000 >= lifetimeUs → pruned
    advanceStateTo(s, 1000 + lifetimeUs, 2, buf, arcLayers, enabledArcLayers, [], []);
    expect(s.arcBuckets[0]).toHaveLength(0);
  });

  it('keeps arcs that are still within lifetime', () => {
    const lifetimeUs = 100_000;
    const s = createIncrementalState(3, 0, 1);
    const arcLayers: ArcLayerDef[] = [makeArcLayer(lifetimeUs)];
    const enabledArcLayers = [true];

    const buf = makeEventBuf([
      [1000, 0, OP_TRANSFER, 1, 200, 0],
      [20_000, 2, OP_STATE, 1, 0, 0],
    ]);

    advanceStateTo(s, 1000, 1, buf, arcLayers, enabledArcLayers, [], []);
    // Advance time to 20000 — arc age = 19000 < 100000
    advanceStateTo(s, 20_000, 2, buf, arcLayers, enabledArcLayers, [], []);
    expect(s.arcBuckets[0]).toHaveLength(1);
  });
});
