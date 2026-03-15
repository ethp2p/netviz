import { describe, it, expect } from 'vitest';
import { normalizeDecoderOutput } from './normalization';
import { EVENT_STRIDE } from './types';

// Minimal valid events block with n events.
function makeEvents(count: number, overrides: Record<string, unknown> = {}): unknown {
  return {
    buf: new Float64Array(count * EVENT_STRIDE),
    logTexts: [],
    count,
    ...overrides,
  };
}

// Minimal valid DecoderOutput-shaped input.
function makeValid(overrides: Record<string, unknown> = {}): unknown {
  return {
    header: {
      nodes: [],
      edges: [],
      meta: {},
    },
    events: makeEvents(2),
    states: [],
    arcLayers: [],
    metrics: [],
    ...overrides,
  };
}

describe('normalizeDecoderOutput', () => {
  describe('valid input with all fields', () => {
    it('returns a DecoderOutput with correct header', () => {
      const input = makeValid({
        header: {
          nodes: [{ name: 'n0', props: { x: 1 } }],
          edges: [{ source: 0, target: 1, latency: 500 }],
          meta: { version: '1.0' },
        },
      });
      const result = normalizeDecoderOutput(input);
      expect(result.header.nodes).toEqual([{ name: 'n0', props: { x: 1 } }]);
      expect(result.header.edges).toEqual([{ source: 0, target: 1, latency: 500 }]);
      expect(result.header.meta).toEqual({ version: '1.0' });
    });

    it('returns correct events with all optional event fields', () => {
      const count = 3;
      const buf = new Float64Array(count * EVENT_STRIDE);
      for (let i = 0; i < buf.length; i++) buf[i] = i + 1;
      const eventTypeIdxs = new Int16Array([1, 2, 3]);
      const peerNodeIdxs = new Int32Array([10, 20, 30]);

      const result = normalizeDecoderOutput(makeValid({
        events: { buf, logTexts: ['a', 'b'], count, eventTypeIdxs, peerNodeIdxs },
      }));

      expect(result.events.count).toBe(count);
      expect(result.events.buf).toBeInstanceOf(Float64Array);
      expect(result.events.buf.length).toBe(count * EVENT_STRIDE);
      expect(result.events.logTexts).toEqual(['a', 'b']);
      expect(result.events.eventTypeIdxs).toBeInstanceOf(Int16Array);
      expect(Array.from(result.events.eventTypeIdxs!)).toEqual([1, 2, 3]);
      expect(result.events.peerNodeIdxs).toBeInstanceOf(Int32Array);
      expect(Array.from(result.events.peerNodeIdxs!)).toEqual([10, 20, 30]);
    });

    it('returns correct states, arcLayers, and metrics arrays', () => {
      const state = { name: 's', color: [255, 0, 0, 255] as [number,number,number,number], terminal: false };
      const arc = { name: 'a', color: [0, 255, 0, 255] as [number,number,number,number], lifetimeUs: 1000, travelUs: 200, radius: 3 };
      const metric = { name: 'm', format: 'count' as const, aggregate: 'sum' as const };

      const result = normalizeDecoderOutput(makeValid({
        states: [state],
        arcLayers: [arc],
        metrics: [metric],
      }));

      expect(result.states).toEqual([state]);
      expect(result.arcLayers).toEqual([arc]);
      expect(result.metrics).toEqual([metric]);
    });

    it('returns eventTypes when present', () => {
      const eventTypes = [{ code: 'TX', name: 'Transaction' }];
      const result = normalizeDecoderOutput(makeValid({ eventTypes }));
      expect(result.eventTypes).toEqual(eventTypes);
    });

    it('returns milestones when present', () => {
      const milestones = [{ time: 1000, label: 'start', color: '#fff' }];
      const result = normalizeDecoderOutput(makeValid({ milestones }));
      expect(result.milestones).toEqual(milestones);
    });

    it('returns messages when present', () => {
      const messages = [{ id: 'm1', firstTs: 0, lastTs: 100, label: 'msg' }];
      const result = normalizeDecoderOutput(makeValid({ messages }));
      expect(result.messages).toEqual(messages);
    });

    it('returns chartHints when present', () => {
      const chartHints = { cdf: { stateIdx: 2 } };
      const result = normalizeDecoderOutput(makeValid({ chartHints }));
      expect(result.chartHints).toEqual(chartHints);
    });
  });

  describe('missing required fields', () => {
    it('throws when input is not an object', () => {
      expect(() => normalizeDecoderOutput(null)).toThrow('DecoderOutput must be an object');
      expect(() => normalizeDecoderOutput(42)).toThrow('DecoderOutput must be an object');
      expect(() => normalizeDecoderOutput('string')).toThrow('DecoderOutput must be an object');
    });

    it('throws when header is missing', () => {
      const input = { ...makeValid() as Record<string, unknown> };
      delete (input as Record<string, unknown>).header;
      expect(() => normalizeDecoderOutput(input)).toThrow('header must be an object');
    });

    it('throws when header.nodes is missing', () => {
      const input = makeValid({ header: { edges: [], meta: {} } });
      expect(() => normalizeDecoderOutput(input)).toThrow('header.nodes must be an array');
    });

    it('throws when header.edges is missing', () => {
      const input = makeValid({ header: { nodes: [], meta: {} } });
      expect(() => normalizeDecoderOutput(input)).toThrow('header.edges must be an array');
    });

    it('throws when events is missing', () => {
      const input = { ...makeValid() as Record<string, unknown> };
      delete (input as Record<string, unknown>).events;
      expect(() => normalizeDecoderOutput(input)).toThrow('events must be an object');
    });

    it('throws when events.logTexts is missing', () => {
      const input = makeValid({ events: { buf: new Float64Array(6), count: 1 } });
      expect(() => normalizeDecoderOutput(input)).toThrow('events.logTexts must be a string array');
    });

    it('throws when events.logTexts contains non-strings', () => {
      const input = makeValid({ events: { buf: new Float64Array(6), count: 1, logTexts: [1, 2] } });
      expect(() => normalizeDecoderOutput(input)).toThrow('events.logTexts must be a string array');
    });

    it('throws when events.buf is missing', () => {
      const input = makeValid({ events: { logTexts: [], count: 0 } });
      expect(() => normalizeDecoderOutput(input)).toThrow('events.buf must be a Float64Array or numeric array');
    });

    it('throws when states is missing', () => {
      const input = { ...makeValid() as Record<string, unknown> };
      delete (input as Record<string, unknown>).states;
      expect(() => normalizeDecoderOutput(input)).toThrow('states must be an array');
    });

    it('throws when arcLayers is missing', () => {
      const input = { ...makeValid() as Record<string, unknown> };
      delete (input as Record<string, unknown>).arcLayers;
      expect(() => normalizeDecoderOutput(input)).toThrow('arcLayers must be an array');
    });

    it('throws when metrics is missing', () => {
      const input = { ...makeValid() as Record<string, unknown> };
      delete (input as Record<string, unknown>).metrics;
      expect(() => normalizeDecoderOutput(input)).toThrow('metrics must be an array');
    });
  });

  describe('events.buf type acceptance', () => {
    it('accepts events.buf as a plain Array', () => {
      const count = 2;
      const buf = Array(count * EVENT_STRIDE).fill(0);
      const result = normalizeDecoderOutput(makeValid({ events: { buf, logTexts: [], count } }));
      expect(result.events.buf).toBeInstanceOf(Float64Array);
      expect(result.events.count).toBe(count);
    });

    it('accepts events.buf as an Int16Array', () => {
      const count = 1;
      const buf = new Int16Array(count * EVENT_STRIDE);
      const result = normalizeDecoderOutput(makeValid({ events: { buf, logTexts: [], count } }));
      expect(result.events.buf).toBeInstanceOf(Float64Array);
      expect(result.events.count).toBe(count);
    });

    it('accepts events.buf as a Float64Array', () => {
      const count = 1;
      const buf = new Float64Array(count * EVENT_STRIDE);
      buf[0] = 123.456;
      const result = normalizeDecoderOutput(makeValid({ events: { buf, logTexts: [], count } }));
      expect(result.events.buf).toBeInstanceOf(Float64Array);
      expect(result.events.buf[0]).toBeCloseTo(123.456);
    });

    it('accepts events.buf as a Uint8Array (ArrayBufferView)', () => {
      const count = 1;
      const buf = new Uint8Array(count * EVENT_STRIDE);
      const result = normalizeDecoderOutput(makeValid({ events: { buf, logTexts: [], count } }));
      expect(result.events.buf).toBeInstanceOf(Float64Array);
    });

    it('rejects events.buf as a string', () => {
      const input = makeValid({ events: { buf: 'notabuffer', logTexts: [], count: 0 } });
      expect(() => normalizeDecoderOutput(input)).toThrow('events.buf must be a Float64Array or numeric array');
    });
  });

  describe('events.count mismatch', () => {
    it('throws when count is larger than buf length / EVENT_STRIDE', () => {
      const buf = new Float64Array(EVENT_STRIDE); // enough for 1 event
      const input = makeValid({ events: { buf, logTexts: [], count: 2 } });
      expect(() => normalizeDecoderOutput(input)).toThrow('events.buf is shorter than events.count * EVENT_STRIDE');
    });

    it('falls back to inferred count when count is non-integer and buf is divisible', () => {
      // When count is invalid but buf length is divisible by EVENT_STRIDE,
      // the implementation infers count from the buffer rather than throwing.
      const buf = new Float64Array(EVENT_STRIDE * 2);
      const input = makeValid({ events: { buf, logTexts: [], count: 1.5 } });
      const result = normalizeDecoderOutput(input);
      expect(result.events.count).toBe(2); // inferred from buf.length / EVENT_STRIDE
    });

    it('throws when count is non-integer and buf is not divisible by EVENT_STRIDE', () => {
      const buf = new Float64Array(EVENT_STRIDE * 2 + 1);
      const input = makeValid({ events: { buf, logTexts: [], count: 1.5 } });
      expect(() => normalizeDecoderOutput(input)).toThrow('events.count must be a non-negative integer');
    });

    it('falls back to inferred count when count is negative and buf is divisible', () => {
      // Same fallback behavior: invalid count triggers inference from buf length.
      const buf = new Float64Array(EVENT_STRIDE);
      const input = makeValid({ events: { buf, logTexts: [], count: -1 } });
      const result = normalizeDecoderOutput(input);
      expect(result.events.count).toBe(1);
    });

    it('throws when count is negative and buf is not divisible by EVENT_STRIDE', () => {
      const buf = new Float64Array(EVENT_STRIDE + 1);
      const input = makeValid({ events: { buf, logTexts: [], count: -1 } });
      expect(() => normalizeDecoderOutput(input)).toThrow('events.count must be a non-negative integer');
    });

    it('infers count from buf length when count is absent and buf is divisible', () => {
      const count = 3;
      const buf = new Float64Array(count * EVENT_STRIDE);
      const input = makeValid({ events: { buf, logTexts: [] } }); // no count field
      const result = normalizeDecoderOutput(input);
      expect(result.events.count).toBe(count);
    });

    it('throws when count is absent and buf length is not divisible by EVENT_STRIDE', () => {
      const buf = new Float64Array(EVENT_STRIDE * 2 + 1); // not divisible
      const input = makeValid({ events: { buf, logTexts: [] } });
      expect(() => normalizeDecoderOutput(input)).toThrow('events.count must be a non-negative integer');
    });
  });

  describe('events.buf too short', () => {
    it('throws when buf has fewer elements than count * EVENT_STRIDE', () => {
      const buf = new Float64Array(EVENT_STRIDE * 2 - 1);
      const input = makeValid({ events: { buf, logTexts: [], count: 2 } });
      expect(() => normalizeDecoderOutput(input)).toThrow('events.buf is shorter than events.count * EVENT_STRIDE');
    });

    it('trims buf to exact length when buf is larger than count * EVENT_STRIDE', () => {
      const count = 1;
      const buf = new Float64Array(count * EVENT_STRIDE + 10); // extra elements
      const result = normalizeDecoderOutput(makeValid({ events: { buf, logTexts: [], count } }));
      expect(result.events.buf.length).toBe(count * EVENT_STRIDE);
    });

    it('keeps buf as-is when length exactly matches count * EVENT_STRIDE', () => {
      const count = 2;
      const buf = new Float64Array(count * EVENT_STRIDE);
      const result = normalizeDecoderOutput(makeValid({ events: { buf, logTexts: [], count } }));
      expect(result.events.buf.length).toBe(count * EVENT_STRIDE);
    });
  });

  describe('optional fields absent', () => {
    it('eventTypes absent → returns undefined', () => {
      const result = normalizeDecoderOutput(makeValid());
      expect(result.eventTypes).toBeUndefined();
    });

    it('milestones absent → defaults to empty array', () => {
      const result = normalizeDecoderOutput(makeValid());
      expect(result.milestones).toEqual([]);
    });

    it('messages absent → returns undefined', () => {
      const result = normalizeDecoderOutput(makeValid());
      expect(result.messages).toBeUndefined();
    });

    it('eventTypeIdxs absent → omitted from packed events', () => {
      const result = normalizeDecoderOutput(makeValid());
      expect(result.events.eventTypeIdxs).toBeUndefined();
    });

    it('peerNodeIdxs absent → omitted from packed events', () => {
      const result = normalizeDecoderOutput(makeValid());
      expect(result.events.peerNodeIdxs).toBeUndefined();
    });

    it('eventTypes as empty array → returns empty array', () => {
      const result = normalizeDecoderOutput(makeValid({ eventTypes: [] }));
      expect(result.eventTypes).toEqual([]);
    });

    it('milestones as populated array → returns that array', () => {
      const milestones = [{ time: 50, label: 'mid', color: 'red' }];
      const result = normalizeDecoderOutput(makeValid({ milestones }));
      expect(result.milestones).toEqual(milestones);
    });
  });

  describe('header.meta absent → defaults to {}', () => {
    it('meta missing → defaults to {}', () => {
      const result = normalizeDecoderOutput(makeValid({ header: { nodes: [], edges: [] } }));
      expect(result.header.meta).toEqual({});
    });

    it('meta null → defaults to {}', () => {
      const result = normalizeDecoderOutput(makeValid({ header: { nodes: [], edges: [], meta: null } }));
      expect(result.header.meta).toEqual({});
    });

    it('meta as a string → defaults to {}', () => {
      const result = normalizeDecoderOutput(makeValid({ header: { nodes: [], edges: [], meta: 'invalid' } }));
      expect(result.header.meta).toEqual({});
    });

    it('meta object is shallow-copied (not the same reference)', () => {
      const meta = { key: 'value' };
      const result = normalizeDecoderOutput(makeValid({ header: { nodes: [], edges: [], meta } }));
      expect(result.header.meta).toEqual({ key: 'value' });
      expect(result.header.meta).not.toBe(meta);
    });
  });

  describe('chartHints absent → defaults to {}', () => {
    it('chartHints missing → defaults to {}', () => {
      const result = normalizeDecoderOutput(makeValid());
      expect(result.chartHints).toEqual({});
    });

    it('chartHints null → defaults to {}', () => {
      const result = normalizeDecoderOutput(makeValid({ chartHints: null }));
      expect(result.chartHints).toEqual({});
    });

    it('chartHints as a number → defaults to {}', () => {
      const result = normalizeDecoderOutput(makeValid({ chartHints: 42 }));
      expect(result.chartHints).toEqual({});
    });

    it('chartHints object is shallow-copied', () => {
      const chartHints = { cdf: { stateIdx: 1 } };
      const result = normalizeDecoderOutput(makeValid({ chartHints }));
      expect(result.chartHints).toEqual(chartHints);
      expect(result.chartHints).not.toBe(chartHints);
    });
  });

  describe('eventTypeIdxs and peerNodeIdxs normalization', () => {
    it('trims eventTypeIdxs to event count when longer', () => {
      const count = 2;
      const buf = new Float64Array(count * EVENT_STRIDE);
      const eventTypeIdxs = new Int16Array([5, 6, 7]); // one extra
      const result = normalizeDecoderOutput(makeValid({
        events: { buf, logTexts: [], count, eventTypeIdxs },
      }));
      expect(result.events.eventTypeIdxs!.length).toBe(count);
      expect(Array.from(result.events.eventTypeIdxs!)).toEqual([5, 6]);
    });

    it('throws when eventTypeIdxs is shorter than count', () => {
      const count = 3;
      const buf = new Float64Array(count * EVENT_STRIDE);
      const eventTypeIdxs = new Int16Array([1, 2]); // one short
      const input = makeValid({ events: { buf, logTexts: [], count, eventTypeIdxs } });
      expect(() => normalizeDecoderOutput(input)).toThrow('events.eventTypeIdxs is shorter than events.count');
    });

    it('accepts eventTypeIdxs as a plain Array', () => {
      const count = 2;
      const buf = new Float64Array(count * EVENT_STRIDE);
      const eventTypeIdxs = [3, 4];
      const result = normalizeDecoderOutput(makeValid({
        events: { buf, logTexts: [], count, eventTypeIdxs },
      }));
      expect(result.events.eventTypeIdxs).toBeInstanceOf(Int16Array);
      expect(Array.from(result.events.eventTypeIdxs!)).toEqual([3, 4]);
    });

    it('trims peerNodeIdxs to event count when longer', () => {
      const count = 1;
      const buf = new Float64Array(count * EVENT_STRIDE);
      const peerNodeIdxs = new Int32Array([99, 100]); // one extra
      const result = normalizeDecoderOutput(makeValid({
        events: { buf, logTexts: [], count, peerNodeIdxs },
      }));
      expect(result.events.peerNodeIdxs!.length).toBe(count);
      expect(Array.from(result.events.peerNodeIdxs!)).toEqual([99]);
    });

    it('throws when peerNodeIdxs is shorter than count', () => {
      const count = 2;
      const buf = new Float64Array(count * EVENT_STRIDE);
      const peerNodeIdxs = new Int32Array([1]); // one short
      const input = makeValid({ events: { buf, logTexts: [], count, peerNodeIdxs } });
      expect(() => normalizeDecoderOutput(input)).toThrow('events.peerNodeIdxs is shorter than events.count');
    });
  });
});
