import { describe, it, expect } from 'vitest';
import { computeNodeMetadata } from './node-metadata';
import { buildTopologyGraph } from './topology';
import { EVENT_STRIDE, OP_TRANSFER, OP_STATE } from '../decoder-sdk';
import type { CanonicalHeader } from '../decoder-sdk';

// Build a minimal CanonicalHeader for a linear chain: 0 -- 1 -- 2 -- 3
function makeHeader(nodeCount: number, edges: { source: number; target: number; latency: number }[]): CanonicalHeader {
  return {
    nodes: Array.from({ length: nodeCount }, (_, i) => ({ name: `node${i}`, props: {} })),
    edges,
    meta: {},
  };
}

// Pack a single event into a Float64Array at offset i*EVENT_STRIDE.
// Layout: [ts, sender, opcode, receiver, bytes, extra]
function packEvent(buf: Float64Array, idx: number, ts: number, sender: number, opcode: number, receiver: number, bytes: number): void {
  const base = idx * EVENT_STRIDE;
  buf[base]     = ts;
  buf[base + 1] = sender;
  buf[base + 2] = opcode;
  buf[base + 3] = receiver;
  buf[base + 4] = bytes;
  buf[base + 5] = 0;
}

describe('computeNodeMetadata', () => {
  describe('empty events (count=0)', () => {
    it('returns hops array sized to node count', () => {
      const header = makeHeader(4, [
        { source: 0, target: 1, latency: 1000 },
        { source: 1, target: 2, latency: 1000 },
        { source: 2, target: 3, latency: 1000 },
      ]);
      const graph = buildTopologyGraph(header);
      const buf = new Float64Array(0);

      const result = computeNodeMetadata(header, buf, 0, 0, graph);

      expect(result.hops).toBeInstanceOf(Int32Array);
      expect(result.hops.length).toBe(4);
    });

    it('computes hops from origin via BFS', () => {
      const header = makeHeader(4, [
        { source: 0, target: 1, latency: 1000 },
        { source: 1, target: 2, latency: 1000 },
        { source: 2, target: 3, latency: 1000 },
      ]);
      const graph = buildTopologyGraph(header);
      const buf = new Float64Array(0);

      const result = computeNodeMetadata(header, buf, 0, 0, graph);

      // Origin is at 0 hops; each step along the chain adds one hop.
      expect(result.hops[0]).toBe(0);
      expect(result.hops[1]).toBe(1);
      expect(result.hops[2]).toBe(2);
      expect(result.hops[3]).toBe(3);
    });

    it('returns latencyMs array sized to node count', () => {
      const header = makeHeader(3, [
        { source: 0, target: 1, latency: 2000 },
        { source: 1, target: 2, latency: 3000 },
      ]);
      const graph = buildTopologyGraph(header);
      const buf = new Float64Array(0);

      const result = computeNodeMetadata(header, buf, 0, 0, graph);

      expect(result.latencyMs).toBeInstanceOf(Float64Array);
      expect(result.latencyMs.length).toBe(3);
      // Latency is stored in ms (latency field in µs / 1000)
      expect(result.latencyMs[0]).toBe(0);
      expect(result.latencyMs[1]).toBe(2);
      expect(result.latencyMs[2]).toBe(5);
    });

    it('returns bwSamples=0 and empty bwUp/bwDown arrays', () => {
      const header = makeHeader(3, []);
      const graph = buildTopologyGraph(header);
      const buf = new Float64Array(0);

      const result = computeNodeMetadata(header, buf, 0, 0, graph);

      expect(result.bwSamples).toBe(0);
      expect(result.bwTimeMin).toBe(0);
      expect(result.bwTimeMax).toBe(0);
      // Each per-node array should be empty (no bucket allocation without events)
      expect(result.bwUp.length).toBe(3);
      expect(result.bwDown.length).toBe(3);
      for (let i = 0; i < 3; i++) {
        expect(result.bwUp[i].length).toBe(0);
        expect(result.bwDown[i].length).toBe(0);
      }
    });
  });

  describe('single OP_TRANSFER event', () => {
    it('fills bwUp for sender and bwDown for receiver', () => {
      const header = makeHeader(3, [
        { source: 0, target: 1, latency: 1000 },
        { source: 1, target: 2, latency: 1000 },
      ]);
      const graph = buildTopologyGraph(header);

      // Two events at different timestamps so tMax > tMin
      const buf = new Float64Array(2 * EVENT_STRIDE);
      packEvent(buf, 0, 0.0,  1, OP_TRANSFER, 2, 512); // sender=1, receiver=2, bytes=512
      packEvent(buf, 1, 1.0,  1, OP_TRANSFER, 2,   0); // second event just to create a time span

      const result = computeNodeMetadata(header, buf, 2, 0, graph);

      expect(result.bwSamples).toBe(60);

      // Sender node 1 should have upload bytes in bucket 0 (ts=0, earliest bucket)
      expect(result.bwUp[1][0]).toBeGreaterThan(0);

      // Receiver node 2 should have download bytes in bucket 0
      expect(result.bwDown[2][0]).toBeGreaterThan(0);

      // Unrelated node 0 should have no upload or download
      expect(result.bwUp[0].reduce((a, b) => a + b, 0)).toBe(0);
      expect(result.bwDown[0].reduce((a, b) => a + b, 0)).toBe(0);
    });

    it('records the correct byte count in the sender upload bucket', () => {
      const header = makeHeader(2, [{ source: 0, target: 1, latency: 1000 }]);
      const graph = buildTopologyGraph(header);

      const buf = new Float64Array(2 * EVENT_STRIDE);
      packEvent(buf, 0, 0.0, 0, OP_TRANSFER, 1, 1024);
      packEvent(buf, 1, 1.0, 0, OP_TRANSFER, 1,    0); // anchor for time range

      const result = computeNodeMetadata(header, buf, 2, 0, graph);

      // Event at ts=0 maps to bucket 0; 1024 bytes uploaded by node 0
      expect(result.bwUp[0][0]).toBe(1024);
      expect(result.bwDown[1][0]).toBe(1024);
    });
  });

  describe('non-transfer events are ignored', () => {
    it('OP_STATE events do not contribute to bandwidth', () => {
      const header = makeHeader(3, [
        { source: 0, target: 1, latency: 1000 },
        { source: 1, target: 2, latency: 1000 },
      ]);
      const graph = buildTopologyGraph(header);

      const buf = new Float64Array(2 * EVENT_STRIDE);
      // First event is OP_STATE (not OP_TRANSFER)
      packEvent(buf, 0, 0.0, 1, OP_STATE, 2, 999);
      // Second event just provides the time span so count=2 triggers bucket allocation
      packEvent(buf, 1, 1.0, 1, OP_STATE, 2, 999);

      const result = computeNodeMetadata(header, buf, 2, 0, graph);

      // bwSamples is 60 (time range is valid), but all buckets should be zero
      expect(result.bwSamples).toBe(60);
      for (let node = 0; node < 3; node++) {
        const upTotal = result.bwUp[node].reduce((a, b) => a + b, 0);
        const downTotal = result.bwDown[node].reduce((a, b) => a + b, 0);
        expect(upTotal).toBe(0);
        expect(downTotal).toBe(0);
      }
    });

    it('mixed events: only OP_TRANSFER events contribute', () => {
      const header = makeHeader(2, [{ source: 0, target: 1, latency: 1000 }]);
      const graph = buildTopologyGraph(header);

      const buf = new Float64Array(3 * EVENT_STRIDE);
      packEvent(buf, 0, 0.0, 0, OP_STATE,    1, 999); // ignored
      packEvent(buf, 1, 0.5, 0, OP_TRANSFER, 1, 256); // counted
      packEvent(buf, 2, 1.0, 0, OP_STATE,    1, 999); // ignored, but anchors time range

      const result = computeNodeMetadata(header, buf, 3, 0, graph);

      const upTotal = result.bwUp[0].reduce((a, b) => a + b, 0);
      expect(upTotal).toBe(256);
    });
  });

  describe('bwSamples = 60', () => {
    it('is set to BW_BUCKETS when events span a non-zero time range', () => {
      const header = makeHeader(2, [{ source: 0, target: 1, latency: 1000 }]);
      const graph = buildTopologyGraph(header);

      const buf = new Float64Array(2 * EVENT_STRIDE);
      packEvent(buf, 0,   0.0, 0, OP_TRANSFER, 1, 100);
      packEvent(buf, 1, 100.0, 0, OP_TRANSFER, 1, 200);

      const result = computeNodeMetadata(header, buf, 2, 0, graph);

      expect(result.bwSamples).toBe(60);
      expect(result.bwTimeMin).toBe(0.0);
      expect(result.bwTimeMax).toBe(100.0);
    });

    it('bwUp and bwDown arrays each have 60 buckets per node', () => {
      const header = makeHeader(2, [{ source: 0, target: 1, latency: 1000 }]);
      const graph = buildTopologyGraph(header);

      const buf = new Float64Array(2 * EVENT_STRIDE);
      packEvent(buf, 0, 0.0, 0, OP_TRANSFER, 1, 1);
      packEvent(buf, 1, 1.0, 0, OP_TRANSFER, 1, 1);

      const result = computeNodeMetadata(header, buf, 2, 0, graph);

      for (let i = 0; i < 2; i++) {
        expect(result.bwUp[i].length).toBe(60);
        expect(result.bwDown[i].length).toBe(60);
      }
    });

    it('events spread across time range land in distinct buckets', () => {
      const header = makeHeader(2, [{ source: 0, target: 1, latency: 1000 }]);
      const graph = buildTopologyGraph(header);

      // tMin=0, tMax=60 => dt=1, so event at ts=30 lands in bucket 30
      const buf = new Float64Array(2 * EVENT_STRIDE);
      packEvent(buf, 0,  0.0, 0, OP_TRANSFER, 1, 100);
      packEvent(buf, 1, 60.0, 0, OP_TRANSFER, 1, 200);

      const result = computeNodeMetadata(header, buf, 2, 0, graph);

      // bucket for ts=0 is 0; bucket for ts=60 is clamped to 59 (BW_BUCKETS-1)
      expect(result.bwUp[0][0]).toBe(100);
      expect(result.bwUp[0][59]).toBe(200);
    });
  });

  describe('hops from origin via BFS', () => {
    it('origin node has 0 hops', () => {
      const header = makeHeader(4, [
        { source: 0, target: 1, latency: 500 },
        { source: 1, target: 2, latency: 500 },
        { source: 2, target: 3, latency: 500 },
      ]);
      const graph = buildTopologyGraph(header);
      const buf = new Float64Array(0);

      const result = computeNodeMetadata(header, buf, 0, 2, graph);

      expect(result.hops[2]).toBe(0);
      expect(result.hops[1]).toBe(1);
      expect(result.hops[3]).toBe(1);
      expect(result.hops[0]).toBe(2);
    });

    it('unreachable nodes get hop count -1', () => {
      // Two disconnected subgraphs: {0,1} and {2,3}
      const header = makeHeader(4, [
        { source: 0, target: 1, latency: 500 },
        { source: 2, target: 3, latency: 500 },
      ]);
      const graph = buildTopologyGraph(header);
      const buf = new Float64Array(0);

      const result = computeNodeMetadata(header, buf, 0, 0, graph);

      expect(result.hops[0]).toBe(0);
      expect(result.hops[1]).toBe(1);
      expect(result.hops[2]).toBe(-1);
      expect(result.hops[3]).toBe(-1);
    });

    it('different origin shifts hop distances', () => {
      const header = makeHeader(3, [
        { source: 0, target: 1, latency: 500 },
        { source: 1, target: 2, latency: 500 },
      ]);
      const graph = buildTopologyGraph(header);
      const buf = new Float64Array(0);

      const fromNode0 = computeNodeMetadata(header, buf, 0, 0, graph);
      const fromNode2 = computeNodeMetadata(header, buf, 0, 2, graph);

      expect(Array.from(fromNode0.hops)).toEqual([0, 1, 2]);
      expect(Array.from(fromNode2.hops)).toEqual([2, 1, 0]);
    });
  });
});
