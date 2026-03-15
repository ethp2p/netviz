import { describe, it, expect } from 'vitest';
import { MinHeap } from './heap';
import { bfsHops, dijkstraLatency } from './algorithms';
import { buildTopologyGraph } from './topology';
import type { CanonicalHeader } from '../decoder-sdk';

// ---------------------------------------------------------------------------
// MinHeap
// ---------------------------------------------------------------------------

describe('MinHeap', () => {
  describe('basic push/pop', () => {
    it('pops items in ascending priority order', () => {
      const h = new MinHeap(5);
      h.push(2, 10);
      h.push(0, 5);
      h.push(4, 20);
      h.push(1, 1);
      h.push(3, 15);

      expect(h.pop()).toBe(1); // prio 1
      expect(h.pop()).toBe(0); // prio 5
      expect(h.pop()).toBe(2); // prio 10
      expect(h.pop()).toBe(3); // prio 15
      expect(h.pop()).toBe(4); // prio 20
    });

    it('tracks size correctly through push and pop', () => {
      const h = new MinHeap(3);
      expect(h.size).toBe(0);
      expect(h.isEmpty()).toBe(true);

      h.push(0, 1);
      expect(h.size).toBe(1);
      expect(h.isEmpty()).toBe(false);

      h.push(1, 2);
      expect(h.size).toBe(2);

      h.pop();
      expect(h.size).toBe(1);

      h.pop();
      expect(h.size).toBe(0);
      expect(h.isEmpty()).toBe(true);
    });

    it('handles a single element correctly', () => {
      const h = new MinHeap(1);
      h.push(0, 42);
      expect(h.size).toBe(1);
      expect(h.pop()).toBe(0);
      expect(h.isEmpty()).toBe(true);
    });

    it('handles equal priorities stably (returns some element)', () => {
      const h = new MinHeap(3);
      h.push(0, 5);
      h.push(1, 5);
      h.push(2, 5);
      const results = [h.pop(), h.pop(), h.pop()].sort();
      expect(results).toEqual([0, 1, 2]);
    });

    it('handles pushing with priority 0', () => {
      const h = new MinHeap(2);
      h.push(0, 0);
      h.push(1, 1);
      expect(h.pop()).toBe(0);
      expect(h.pop()).toBe(1);
    });
  });

  describe('decreaseKey', () => {
    it('re-orders the heap when a priority is decreased', () => {
      const h = new MinHeap(3);
      h.push(0, 100);
      h.push(1, 200);
      h.push(2, 300);

      // Drop node 2 to the front
      h.decreaseKey(2, 50);

      expect(h.pop()).toBe(2); // now the minimum
      expect(h.pop()).toBe(0);
      expect(h.pop()).toBe(1);
    });

    it('is a no-op when the new priority is not lower', () => {
      const h = new MinHeap(2);
      h.push(0, 10);
      h.push(1, 20);

      h.decreaseKey(1, 20); // same value — no change
      h.decreaseKey(1, 30); // higher value — no change

      expect(h.pop()).toBe(0);
      expect(h.pop()).toBe(1);
    });

    it('correctly moves a node from middle of heap to top', () => {
      const h = new MinHeap(5);
      h.push(0, 10);
      h.push(1, 30);
      h.push(2, 20);
      h.push(3, 40);
      h.push(4, 50);

      h.decreaseKey(3, 5); // node 3 jumps to the front

      expect(h.pop()).toBe(3);
    });

    it('handles decrease to same minimum as current top', () => {
      const h = new MinHeap(3);
      h.push(0, 10);
      h.push(1, 20);
      h.push(2, 30);

      h.decreaseKey(2, 10); // tie with current top

      // Both 0 and 2 have priority 10; one comes out first
      const first = h.pop();
      expect([0, 2]).toContain(first);
    });
  });

  describe('edge cases', () => {
    it('pop from a heap with one element leaves it empty', () => {
      const h = new MinHeap(1);
      h.push(0, 7);
      h.pop();
      expect(h.isEmpty()).toBe(true);
    });

    it('processes a large sequence in correct order', () => {
      const n = 20;
      const h = new MinHeap(n);
      // Push in reverse order
      for (let i = n - 1; i >= 0; i--) {
        h.push(i, i);
      }
      const out: number[] = [];
      while (!h.isEmpty()) out.push(h.pop());
      // Each node i had priority i, so pop order is 0,1,...,n-1
      expect(out).toEqual(Array.from({ length: n }, (_, i) => i));
    });
  });
});

// ---------------------------------------------------------------------------
// bfsHops
// ---------------------------------------------------------------------------

describe('bfsHops', () => {
  it('assigns 0 hops to the origin', () => {
    const adj = [[1], [0]];
    const hops = bfsHops(adj, 0, 2);
    expect(hops[0]).toBe(0);
  });

  it('computes correct hop counts on a simple chain', () => {
    // 0 — 1 — 2 — 3
    const adj = [[1], [0, 2], [1, 3], [2]];
    const hops = bfsHops(adj, 0, 4);
    expect(Array.from(hops)).toEqual([0, 1, 2, 3]);
  });

  it('uses node 0 as origin when origin is negative', () => {
    const adj = [[1], [0, 2], [1]];
    const hops = bfsHops(adj, -1, 3);
    expect(hops[0]).toBe(0);
    expect(hops[1]).toBe(1);
    expect(hops[2]).toBe(2);
  });

  it('marks unreachable nodes with -1', () => {
    // Two disconnected components: {0,1} and {2,3}
    const adj = [[1], [0], [3], [2]];
    const hops = bfsHops(adj, 0, 4);
    expect(hops[0]).toBe(0);
    expect(hops[1]).toBe(1);
    expect(hops[2]).toBe(-1);
    expect(hops[3]).toBe(-1);
  });

  it('handles a single isolated node', () => {
    const adj: number[][] = [[]];
    const hops = bfsHops(adj, 0, 1);
    expect(hops[0]).toBe(0);
  });

  it('handles a fully connected clique (all at hop 1)', () => {
    // 4-clique: every node connects to all others
    const adj = [
      [1, 2, 3],
      [0, 2, 3],
      [0, 1, 3],
      [0, 1, 2],
    ];
    const hops = bfsHops(adj, 0, 4);
    expect(Array.from(hops)).toEqual([0, 1, 1, 1]);
  });

  it('handles a star topology', () => {
    // Center 0, spokes 1–4
    const adj = [[1, 2, 3, 4], [0], [0], [0], [0]];
    const hops = bfsHops(adj, 0, 5);
    expect(Array.from(hops)).toEqual([0, 1, 1, 1, 1]);
  });

  it('BFS from a leaf gives correct distances outward', () => {
    // Chain: 0 — 1 — 2 — 3, origin = 3
    const adj = [[1], [0, 2], [1, 3], [2]];
    const hops = bfsHops(adj, 3, 4);
    expect(Array.from(hops)).toEqual([3, 2, 1, 0]);
  });
});

// ---------------------------------------------------------------------------
// dijkstraLatency
// ---------------------------------------------------------------------------

describe('dijkstraLatency', () => {
  it('returns 0 for the origin', () => {
    const adjW = [[{ to: 1, w: 5 }], [{ to: 0, w: 5 }]];
    const dist = dijkstraLatency(adjW, 0, 2);
    expect(dist[0]).toBe(0);
  });

  it('computes correct distances on a simple chain', () => {
    // 0 -1- 1 -2- 2 -3- 3
    const adjW = [
      [{ to: 1, w: 1 }],
      [{ to: 0, w: 1 }, { to: 2, w: 2 }],
      [{ to: 1, w: 2 }, { to: 3, w: 3 }],
      [{ to: 2, w: 3 }],
    ];
    const dist = dijkstraLatency(adjW, 0, 4);
    expect(dist[0]).toBe(0);
    expect(dist[1]).toBe(1);
    expect(dist[2]).toBe(3);
    expect(dist[3]).toBe(6);
  });

  it('chooses shorter alternate path over longer direct path', () => {
    // 0 directly to 2 costs 10; via 1 costs 1+2=3
    const adjW = [
      [{ to: 1, w: 1 }, { to: 2, w: 10 }],
      [{ to: 0, w: 1 }, { to: 2, w: 2 }],
      [{ to: 0, w: 10 }, { to: 1, w: 2 }],
    ];
    const dist = dijkstraLatency(adjW, 0, 3);
    expect(dist[2]).toBe(3);
  });

  it('marks unreachable nodes as Infinity', () => {
    // Two disconnected components: {0,1} and {2,3}
    const adjW = [
      [{ to: 1, w: 1 }],
      [{ to: 0, w: 1 }],
      [{ to: 3, w: 1 }],
      [{ to: 2, w: 1 }],
    ];
    const dist = dijkstraLatency(adjW, 0, 4);
    expect(dist[0]).toBe(0);
    expect(dist[1]).toBe(1);
    expect(dist[2]).toBe(Infinity);
    expect(dist[3]).toBe(Infinity);
  });

  it('handles a single isolated node', () => {
    const adjW: { to: number; w: number }[][] = [[]];
    const dist = dijkstraLatency(adjW, 0, 1);
    expect(dist[0]).toBe(0);
  });

  it('uses node 0 as origin when origin is negative', () => {
    const adjW = [[{ to: 1, w: 7 }], [{ to: 0, w: 7 }]];
    const dist = dijkstraLatency(adjW, -1, 2);
    expect(dist[0]).toBe(0);
    expect(dist[1]).toBe(7);
  });

  it('handles a graph with multiple equal-cost paths', () => {
    // Diamond: 0->1 (1), 0->2 (1), 1->3 (1), 2->3 (1); dist[3] = 2
    const adjW = [
      [{ to: 1, w: 1 }, { to: 2, w: 1 }],
      [{ to: 0, w: 1 }, { to: 3, w: 1 }],
      [{ to: 0, w: 1 }, { to: 3, w: 1 }],
      [{ to: 1, w: 1 }, { to: 2, w: 1 }],
    ];
    const dist = dijkstraLatency(adjW, 0, 4);
    expect(dist[3]).toBe(2);
  });

  it('handles fractional weights', () => {
    const adjW = [
      [{ to: 1, w: 0.5 }],
      [{ to: 0, w: 0.5 }, { to: 2, w: 0.3 }],
      [{ to: 1, w: 0.3 }],
    ];
    const dist = dijkstraLatency(adjW, 0, 3);
    expect(dist[2]).toBeCloseTo(0.8);
  });
});

// ---------------------------------------------------------------------------
// buildTopologyGraph
// ---------------------------------------------------------------------------

describe('buildTopologyGraph', () => {
  const makeHeader = (
    nodeCount: number,
    edges: { source: number; target: number; latency: number }[],
  ): CanonicalHeader => ({
    nodes: Array.from({ length: nodeCount }, (_, i) => ({ name: `n${i}`, props: {} })),
    edges,
    meta: {},
  });

  it('builds empty adj lists for zero edges', () => {
    const g = buildTopologyGraph(makeHeader(3, []));
    expect(g.adj.length).toBe(3);
    expect(g.adj[0]).toEqual([]);
    expect(g.adjW[1]).toEqual([]);
  });

  it('adds both directions for each edge', () => {
    const g = buildTopologyGraph(makeHeader(2, [{ source: 0, target: 1, latency: 2000 }]));
    expect(g.adj[0]).toContain(1);
    expect(g.adj[1]).toContain(0);
    expect(g.adjW[0]).toEqual([{ to: 1, w: 2 }]);
    expect(g.adjW[1]).toEqual([{ to: 0, w: 2 }]);
  });

  it('converts latency from microseconds to milliseconds', () => {
    // 5000 µs -> 5 ms
    const g = buildTopologyGraph(makeHeader(2, [{ source: 0, target: 1, latency: 5000 }]));
    expect(g.adjW[0][0].w).toBe(5);
    expect(g.adjW[1][0].w).toBe(5);
  });

  it('handles a single-node graph with no edges', () => {
    const g = buildTopologyGraph(makeHeader(1, []));
    expect(g.adj.length).toBe(1);
    expect(g.adj[0]).toEqual([]);
    expect(g.adjW[0]).toEqual([]);
  });

  it('builds correct structure for a triangle', () => {
    const edges = [
      { source: 0, target: 1, latency: 1000 },
      { source: 1, target: 2, latency: 2000 },
      { source: 0, target: 2, latency: 3000 },
    ];
    const g = buildTopologyGraph(makeHeader(3, edges));

    expect(g.adj[0].sort()).toEqual([1, 2]);
    expect(g.adj[1].sort()).toEqual([0, 2]);
    expect(g.adj[2].sort()).toEqual([0, 1]);

    const wFor = (node: number, neighbor: number) =>
      g.adjW[node].find(e => e.to === neighbor)?.w;

    expect(wFor(0, 1)).toBe(1);
    expect(wFor(1, 2)).toBe(2);
    expect(wFor(0, 2)).toBe(3);
  });

  it('produces adj and adjW usable by bfsHops and dijkstraLatency', () => {
    // Chain: 0 -500µs- 1 -1000µs- 2
    const edges = [
      { source: 0, target: 1, latency: 500 },
      { source: 1, target: 2, latency: 1000 },
    ];
    const { adj, adjW } = buildTopologyGraph(makeHeader(3, edges));

    const hops = bfsHops(adj, 0, 3);
    expect(Array.from(hops)).toEqual([0, 1, 2]);

    const dist = dijkstraLatency(adjW, 0, 3);
    expect(dist[0]).toBe(0);
    expect(dist[1]).toBeCloseTo(0.5);
    expect(dist[2]).toBeCloseTo(1.5);
  });

  it('handles zero latency edges', () => {
    const g = buildTopologyGraph(makeHeader(2, [{ source: 0, target: 1, latency: 0 }]));
    expect(g.adjW[0][0].w).toBe(0);
    expect(g.adjW[1][0].w).toBe(0);
  });
});
