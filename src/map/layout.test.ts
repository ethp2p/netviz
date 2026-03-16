import { describe, it, expect, beforeEach } from 'vitest';
import { computeLayout, getHopRegions } from './layout';
import { buildTopologyGraph } from '../graph/topology';
import { EVENT_STRIDE, OP_STATE } from '../decoder-sdk';
import type { CanonicalHeader } from '../decoder-sdk';

// 4-node linear chain: 0-1-2-3
// Latencies in microseconds (10ms each).
const header4Linear: CanonicalHeader = {
  nodes: [
    { name: 'node0', props: {} },
    { name: 'node1', props: {} },
    { name: 'node2', props: {} },
    { name: 'node3', props: {} },
  ],
  edges: [
    { source: 0, target: 1, latency: 10_000 },
    { source: 1, target: 2, latency: 10_000 },
    { source: 2, target: 3, latency: 10_000 },
  ],
  meta: {},
};

// 2-node single edge.
const header2: CanonicalHeader = {
  nodes: [
    { name: 'alpha', props: {} },
    { name: 'beta', props: {} },
  ],
  edges: [{ source: 0, target: 1, latency: 5_000 }],
  meta: {},
};

// 3-node star: node 0 connects to 1 and 2.
const header3Star: CanonicalHeader = {
  nodes: [
    { name: 'hub', props: {} },
    { name: 'spoke1', props: {} },
    { name: 'spoke2', props: {} },
  ],
  edges: [
    { source: 0, target: 1, latency: 8_000 },
    { source: 0, target: 2, latency: 20_000 },
  ],
  meta: {},
};

// Empty event buffer — no decoded-state events.
function emptyEvents(n: number): { buf: Float64Array; count: number } {
  return { buf: new Float64Array(0), count: 0 };
}

// Build an event buffer where a single node reaches the decoded state.
// decodedStateIdx = 1 for these helpers.
function eventsWithDecoded(nodeIdx: number, ts: number): { buf: Float64Array; count: number } {
  const buf = new Float64Array(EVENT_STRIDE);
  buf[0] = ts;           // timestamp
  buf[1] = nodeIdx;      // node index
  buf[2] = OP_STATE;     // opcode
  buf[3] = 1;            // stateIdx (decoded)
  return { buf, count: 1 };
}

function isValidTuple(pos: unknown): pos is [number, number, number] {
  return (
    Array.isArray(pos) &&
    pos.length === 3 &&
    typeof pos[0] === 'number' &&
    typeof pos[1] === 'number' &&
    typeof pos[2] === 'number' &&
    isFinite(pos[0]) &&
    isFinite(pos[1]) &&
    isFinite(pos[2])
  );
}

// ─── force mode ─────────────────────────────────────────────────────────────

describe('computeLayout – force mode', () => {
  it('returns one position per node', () => {
    const { buf, count } = emptyEvents(4);
    const positions = computeLayout(header4Linear, buf, count, -1, 'force', 0);
    expect(positions).toHaveLength(4);
  });

  it('each position is a finite [number, number] tuple', () => {
    const { buf, count } = emptyEvents(4);
    const positions = computeLayout(header4Linear, buf, count, -1, 'force', 0);
    for (const p of positions) {
      expect(isValidTuple(p)).toBe(true);
    }
  });

  it('works for a 2-node graph', () => {
    const { buf, count } = emptyEvents(2);
    const positions = computeLayout(header2, buf, count, -1, 'force', 0);
    expect(positions).toHaveLength(2);
    for (const p of positions) {
      expect(isValidTuple(p)).toBe(true);
    }
  });

  it('nodes at distinct positions after simulation', () => {
    const { buf, count } = emptyEvents(4);
    const positions = computeLayout(header4Linear, buf, count, -1, 'force', 0);
    // With charge repulsion, at least two nodes should differ on one axis.
    const xs = positions.map(p => p[0]);
    const allSameX = xs.every(x => x === xs[0]);
    expect(allSameX).toBe(false);
  });
});

// ─── hops mode ──────────────────────────────────────────────────────────────

describe('computeLayout – hops mode', () => {
  it('returns one position per node', () => {
    const { buf, count } = emptyEvents(4);
    const positions = computeLayout(header4Linear, buf, count, -1, 'hops', 0);
    expect(positions).toHaveLength(4);
  });

  it('each position is a finite [number, number] tuple', () => {
    const { buf, count } = emptyEvents(4);
    const positions = computeLayout(header4Linear, buf, count, -1, 'hops', 0);
    for (const p of positions) {
      expect(isValidTuple(p)).toBe(true);
    }
  });

  it('origin node (hop 0) has smaller x than farthest node (hop 3)', () => {
    const { buf, count } = emptyEvents(4);
    // origin = node 0; node 3 is 3 hops away in linear chain.
    const positions = computeLayout(header4Linear, buf, count, -1, 'hops', 0);
    // In hops layout, regions increase left-to-right by hop distance.
    expect(positions[0][0]).toBeLessThan(positions[3][0]);
  });

  it('origin node is at smaller x than 2-hop node in star topology', () => {
    const { buf, count } = emptyEvents(3);
    // origin = spoke1 (node 1); node 2 is 2 hops away via hub.
    const positions = computeLayout(header3Star, buf, count, -1, 'hops', 1);
    expect(positions[1][0]).toBeLessThan(positions[2][0]);
  });

  it('populates hopRegions after layout', () => {
    const { buf, count } = emptyEvents(4);
    computeLayout(header4Linear, buf, count, -1, 'hops', 0);
    const { regions } = getHopRegions();
    // Linear chain from node 0 has hops 0,1,2,3 → 4 regions.
    expect(regions.length).toBe(4);
    expect(regions[0].hop).toBe(0);
  });

  it('populates hopSeparators (count = regions - 1)', () => {
    const { buf, count } = emptyEvents(4);
    computeLayout(header4Linear, buf, count, -1, 'hops', 0);
    const { regions, separators } = getHopRegions();
    expect(separators.length).toBe(regions.length - 1);
  });

  it('uses precomputed TopologyGraph when supplied', () => {
    const graph = buildTopologyGraph(header4Linear);
    const { buf, count } = emptyEvents(4);
    const positions = computeLayout(header4Linear, buf, count, -1, 'hops', 0, 1.5, graph);
    expect(positions).toHaveLength(4);
    // Should still place origin at smaller x than farthest node.
    expect(positions[0][0]).toBeLessThan(positions[3][0]);
  });

  it('works with 2-node graph', () => {
    const { buf, count } = emptyEvents(2);
    const positions = computeLayout(header2, buf, count, -1, 'hops', 0);
    expect(positions).toHaveLength(2);
    for (const p of positions) {
      expect(isValidTuple(p)).toBe(true);
    }
  });

  it('decoded-state events influence y-sort within hop group', () => {
    // Two nodes at the same hop from origin; whichever decoded first
    // should sort earlier (smaller y or same row index).
    const header: CanonicalHeader = {
      nodes: [
        { name: 'origin', props: {} },
        { name: 'a', props: {} },
        { name: 'b', props: {} },
      ],
      edges: [
        { source: 0, target: 1, latency: 5_000 },
        { source: 0, target: 2, latency: 5_000 },
      ],
      meta: {},
    };
    // Node 2 decoded at ts=100, node 1 decoded at ts=200.
    const buf = new Float64Array(2 * EVENT_STRIDE);
    buf[0] = 100; buf[1] = 2; buf[2] = OP_STATE; buf[3] = 1; // node 2 @ 100
    buf[EVENT_STRIDE + 0] = 200; buf[EVENT_STRIDE + 1] = 1; buf[EVENT_STRIDE + 2] = OP_STATE; buf[EVENT_STRIDE + 3] = 1; // node 1 @ 200
    const positions = computeLayout(header, buf, 2, 1, 'hops', 0);
    expect(positions).toHaveLength(3);
    // Both nodes are valid tuples.
    expect(isValidTuple(positions[1])).toBe(true);
    expect(isValidTuple(positions[2])).toBe(true);
    // Node 2 (earlier decode) should sort before node 1 → smaller or equal y.
    expect(positions[2][1]).toBeLessThanOrEqual(positions[1][1]);
  });
});

// ─── latency mode ───────────────────────────────────────────────────────────

describe('computeLayout – latency mode', () => {
  it('returns one position per node', () => {
    const { buf, count } = emptyEvents(4);
    const positions = computeLayout(header4Linear, buf, count, -1, 'latency', 0);
    expect(positions).toHaveLength(4);
  });

  it('each position is a finite [number, number] tuple', () => {
    const { buf, count } = emptyEvents(4);
    const positions = computeLayout(header4Linear, buf, count, -1, 'latency', 0);
    for (const p of positions) {
      expect(isValidTuple(p)).toBe(true);
    }
  });

  it('origin node has x = 0 (zero latency from itself)', () => {
    const { buf, count } = emptyEvents(4);
    const positions = computeLayout(header4Linear, buf, count, -1, 'latency', 0);
    // Origin starts at dist=0, so xScale*0 = 0.
    expect(positions[0][0]).toBe(0);
  });

  it('farther nodes have strictly larger x', () => {
    const { buf, count } = emptyEvents(4);
    const positions = computeLayout(header4Linear, buf, count, -1, 'latency', 0);
    // In linear chain each hop adds equal latency: x[1] < x[2] < x[3].
    expect(positions[0][0]).toBeLessThan(positions[1][0]);
    expect(positions[1][0]).toBeLessThan(positions[2][0]);
    expect(positions[2][0]).toBeLessThan(positions[3][0]);
  });

  it('uses precomputed TopologyGraph when supplied', () => {
    const graph = buildTopologyGraph(header4Linear);
    const { buf, count } = emptyEvents(4);
    const positions = computeLayout(header4Linear, buf, count, -1, 'latency', 0, 1.5, graph);
    expect(positions).toHaveLength(4);
    expect(positions[0][0]).toBe(0);
  });

  it('non-origin node with higher latency edge has larger x', () => {
    // node2 is 20ms from origin, node1 is 8ms → x[2] > x[1].
    const { buf, count } = emptyEvents(3);
    const positions = computeLayout(header3Star, buf, count, -1, 'latency', 0);
    expect(positions[1][0]).toBeLessThan(positions[2][0]);
  });
});

// ─── race mode ──────────────────────────────────────────────────────────────

describe('computeLayout – race mode', () => {
  it('returns one position per node', () => {
    const { buf, count } = emptyEvents(4);
    const positions = computeLayout(header4Linear, buf, count, -1, 'race', 0);
    expect(positions).toHaveLength(4);
  });

  it('each position is a valid [number, number] tuple', () => {
    const { buf, count } = emptyEvents(4);
    const positions = computeLayout(header4Linear, buf, count, -1, 'race', 0);
    for (const p of positions) {
      expect(isValidTuple(p)).toBe(true);
    }
  });

  it('all x positions are 0 (racing bars start flush left)', () => {
    const { buf, count } = emptyEvents(4);
    const positions = computeLayout(header4Linear, buf, count, -1, 'race', 0);
    for (const p of positions) {
      expect(p[0]).toBe(0);
    }
  });

  it('y positions are distinct multiples of rowHeight', () => {
    const { buf, count } = emptyEvents(4);
    const positions = computeLayout(header4Linear, buf, count, -1, 'race', 0);
    const ys = positions.map(p => p[1]).sort((a, b) => a - b);
    // All y values should be non-negative.
    expect(ys[0]).toBeGreaterThanOrEqual(0);
    // Each rank step should be equal-spaced.
    const step = ys[1] - ys[0];
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBeCloseTo(step, 5);
    }
  });

  it('node that decoded earliest gets smallest y', () => {
    // Node 2 decodes at ts=50, all others never decode → node 2 sorts first.
    const { buf, count } = eventsWithDecoded(2, 50);
    const positions = computeLayout(header4Linear, buf, count, 1, 'race', 0);
    const ys = positions.map(p => p[1]);
    expect(ys[2]).toBeLessThan(ys[0]);
    expect(ys[2]).toBeLessThan(ys[1]);
    expect(ys[2]).toBeLessThan(ys[3]);
  });

  it('works for 2-node graph', () => {
    const { buf, count } = emptyEvents(2);
    const positions = computeLayout(header2, buf, count, -1, 'race', 0);
    expect(positions).toHaveLength(2);
    for (const p of positions) {
      expect(isValidTuple(p)).toBe(true);
    }
  });
});

// ─── getHopRegions initial state ─────────────────────────────────────────────

describe('getHopRegions', () => {
  it('returns an object with regions, separators, yExtent', () => {
    const result = getHopRegions();
    expect(result).toHaveProperty('regions');
    expect(result).toHaveProperty('separators');
    expect(result).toHaveProperty('yExtent');
  });
});
