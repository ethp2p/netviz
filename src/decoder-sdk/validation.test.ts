import { describe, it, expect } from 'vitest';
import { validateDecoderOutput } from './validation';
import type { DecoderOutput } from './types';
import { EVENT_STRIDE, OP_STATE } from './types';

// Minimal valid StateDef — states array must have at least one entry.
const validState = {
  name: 'idle',
  color: [100, 100, 100, 255] as [number, number, number, number],
  terminal: false,
};

// Minimal valid ArcLayerDef.
const validArcLayer = {
  name: 'transfer',
  color: [0, 200, 0, 255] as [number, number, number, number],
  lifetimeUs: 1000,
  travelUs: 200,
  radius: 3,
};

// Minimal valid MetricDef.
const validMetric = {
  name: 'bytes',
  format: 'count' as const,
  aggregate: 'sum' as const,
};

// Build a valid PackedEvents block with a single OP_STATE event for node 0.
function makeEvents(nodeCount: number): DecoderOutput['events'] {
  const count = 1;
  const buf = new Float64Array(count * EVENT_STRIDE);
  buf[0] = 0;       // time
  buf[1] = 0;       // nodeIdx
  buf[2] = OP_STATE; // opcode
  buf[3] = 0;       // stateIdx (must reference valid state)
  buf[4] = 0;
  buf[5] = 0;
  return { buf, count, logTexts: [] };
}

// Build a minimal fully-valid DecoderOutput.
function makeValid(overrides: Partial<DecoderOutput> = {}): DecoderOutput {
  const nodes = [{ name: 'n0', props: {} }];
  return {
    header: { nodes, edges: [], meta: {} },
    states: [validState],
    arcLayers: [validArcLayer],
    metrics: [validMetric],
    milestones: [],
    chartHints: {},
    events: makeEvents(nodes.length),
    ...overrides,
  };
}

describe('validateDecoderOutput', () => {
  describe('valid output', () => {
    it('returns the output unchanged for a minimal valid object', () => {
      const output = makeValid();
      const result = validateDecoderOutput(output);
      expect(result).toBe(output);
    });

    it('accepts empty nodes and edges arrays', () => {
      // Edge case: no nodes means no events can reference them, so use 0 events.
      const output: DecoderOutput = {
        header: { nodes: [], edges: [], meta: {} },
        states: [validState],
        arcLayers: [validArcLayer],
        metrics: [validMetric],
        milestones: [],
        chartHints: {},
        events: { buf: new Float64Array(0), count: 0, logTexts: [] },
      };
      expect(() => validateDecoderOutput(output)).not.toThrow();
    });

    it('accepts optional milestones, messages, and eventTypes', () => {
      const output = makeValid({
        milestones: [{ time: 500, label: 'mid', color: '#fff' }],
        messages: [{ id: 'm1', firstTs: 0, lastTs: 100, label: 'msg' }],
        eventTypes: [{ code: 'TX', name: 'Transaction' }],
      });
      expect(() => validateDecoderOutput(output)).not.toThrow();
    });
  });

  describe('invalid header nodes', () => {
    it('throws when a node is missing a name', () => {
      const output = makeValid({
        header: {
          nodes: [{ name: '', props: {} }],
          edges: [],
          meta: {},
        },
      });
      expect(() => validateDecoderOutput(output)).toThrow(/name.*non-empty string/);
    });

    it('throws when a node has no props object', () => {
      const output = makeValid({
        header: {
          // Force non-object props via cast.
          nodes: [{ name: 'n0', props: null as unknown as Record<string, number | string> }],
          edges: [],
          meta: {},
        },
      });
      expect(() => validateDecoderOutput(output)).toThrow(/props.*must be an object/);
    });

    it('throws when a node is not an object', () => {
      const output = makeValid({
        header: {
          nodes: [null as unknown as { name: string; props: Record<string, number | string> }],
          edges: [],
          meta: {},
        },
      });
      expect(() => validateDecoderOutput(output)).toThrow(/must be an object/);
    });
  });

  describe('invalid header edges', () => {
    it('throws when an edge has an out-of-range source', () => {
      const output = makeValid({
        header: {
          nodes: [{ name: 'n0', props: {} }],
          edges: [{ source: 5, target: 0, latency: 0 }],
          meta: {},
        },
      });
      expect(() => validateDecoderOutput(output)).toThrow(/source.*valid node index/);
    });

    it('throws when an edge has a negative latency', () => {
      const output = makeValid({
        header: {
          nodes: [{ name: 'n0', props: {} }, { name: 'n1', props: {} }],
          edges: [{ source: 0, target: 1, latency: -1 }],
          meta: {},
        },
        events: { buf: new Float64Array(0), count: 0, logTexts: [] },
      });
      expect(() => validateDecoderOutput(output)).toThrow(/latency.*non-negative/);
    });
  });

  describe('events.count vs buf length', () => {
    it('throws when count exceeds buf length / EVENT_STRIDE', () => {
      // buf only holds 1 event but count claims 2.
      const buf = new Float64Array(EVENT_STRIDE);
      const output = makeValid({
        events: { buf, count: 2, logTexts: [] },
      });
      expect(() => validateDecoderOutput(output)).toThrow(/length must equal events\.count \* EVENT_STRIDE/);
    });

    it('throws when buf is shorter than count * EVENT_STRIDE', () => {
      const buf = new Float64Array(EVENT_STRIDE - 1);
      const output = makeValid({
        events: { buf, count: 1, logTexts: [] },
      });
      expect(() => validateDecoderOutput(output)).toThrow(/length must equal events\.count \* EVENT_STRIDE/);
    });
  });

  describe('invalid node format in events', () => {
    it('throws when an event references an out-of-range node index', () => {
      const count = 1;
      const buf = new Float64Array(count * EVENT_STRIDE);
      buf[1] = 99; // nodeIdx out of range (only 1 node at index 0)
      buf[2] = OP_STATE;
      buf[3] = 0;
      const output = makeValid({
        events: { buf, count, logTexts: [] },
      });
      expect(() => validateDecoderOutput(output)).toThrow(/valid node index/);
    });

    it('throws when an event references an out-of-range state index', () => {
      const count = 1;
      const buf = new Float64Array(count * EVENT_STRIDE);
      buf[1] = 0; // valid node
      buf[2] = OP_STATE;
      buf[3] = 99; // stateIdx out of range
      const output = makeValid({
        events: { buf, count, logTexts: [] },
      });
      expect(() => validateDecoderOutput(output)).toThrow(/valid state index/);
    });
  });

  describe('states validation', () => {
    it('throws when states array is empty', () => {
      const output = makeValid({
        states: [],
        events: { buf: new Float64Array(0), count: 0, logTexts: [] },
      });
      expect(() => validateDecoderOutput(output)).toThrow(/states.*at least one/);
    });

    it('throws when a state has an invalid color', () => {
      const output = makeValid({
        states: [{ name: 'idle', color: 'red' as unknown as [number, number, number, number], terminal: false }],
      });
      expect(() => validateDecoderOutput(output)).toThrow(/color.*RGBA/);
    });

    it('throws when a state has a non-boolean terminal field', () => {
      const output = makeValid({
        states: [{
          name: 'idle',
          color: [0, 0, 0, 255] as [number, number, number, number],
          terminal: 'yes' as unknown as boolean,
        }],
      });
      expect(() => validateDecoderOutput(output)).toThrow(/terminal.*boolean/);
    });
  });

  describe('header.meta', () => {
    it('throws when header.meta is null', () => {
      const output = makeValid({
        header: {
          nodes: [{ name: 'n0', props: {} }],
          edges: [],
          meta: null as unknown as Record<string, unknown>,
        },
      });
      expect(() => validateDecoderOutput(output)).toThrow(/header\.meta.*must be an object/);
    });
  });
});
