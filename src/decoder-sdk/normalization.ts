import type { DecoderOutput, PackedEvents } from './types';
import { EVENT_STRIDE } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function expectRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(path + ' must be an object');
  return value;
}

function expectArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(path + ' must be an array');
  return value;
}

function isNumericArrayView(value: unknown): value is ArrayBufferView & { length: number } {
  return ArrayBuffer.isView(value) && 'length' in value;
}

function normalizeEventCount(value: unknown, bufLength: number): number {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (bufLength % EVENT_STRIDE === 0) return bufLength / EVENT_STRIDE;
  throw new Error('events.count must be a non-negative integer');
}

function normalizeEventBuffer(value: unknown, count: number): Float64Array {
  let buf: Float64Array;

  if (value instanceof Float64Array) {
    buf = value;
  } else if (isNumericArrayView(value)) {
    const view = value as unknown as ArrayLike<number>;
    buf = Float64Array.from(view);
  } else if (Array.isArray(value)) {
    buf = Float64Array.from(value);
  } else {
    throw new Error('events.buf must be a Float64Array or numeric array');
  }

  const expectedLength = count * EVENT_STRIDE;
  if (buf.length < expectedLength) {
    throw new Error('events.buf is shorter than events.count * EVENT_STRIDE');
  }
  if (buf.length === expectedLength) return buf;
  return buf.slice(0, expectedLength);
}

function normalizeInt16Array(value: unknown, count: number, path: string): Int16Array {
  let buf: Int16Array;

  if (value instanceof Int16Array) {
    buf = value;
  } else if (ArrayBuffer.isView(value)) {
    buf = Int16Array.from(value as unknown as ArrayLike<number>);
  } else if (Array.isArray(value)) {
    buf = Int16Array.from(value);
  } else {
    throw new Error(path + ' must be an Int16Array or numeric array');
  }

  if (buf.length < count) {
    throw new Error(path + ' is shorter than events.count');
  }
  if (buf.length === count) return buf;
  return buf.slice(0, count);
}

function normalizeInt32Array(value: unknown, count: number, path: string): Int32Array {
  let buf: Int32Array;

  if (value instanceof Int32Array) {
    buf = value;
  } else if (ArrayBuffer.isView(value)) {
    buf = Int32Array.from(value as unknown as ArrayLike<number>);
  } else if (Array.isArray(value)) {
    buf = Int32Array.from(value);
  } else {
    throw new Error(path + ' must be an Int32Array or numeric array');
  }

  if (buf.length < count) {
    throw new Error(path + ' is shorter than events.count');
  }
  if (buf.length === count) return buf;
  return buf.slice(0, count);
}

function normalizePackedEvents(value: unknown): PackedEvents {
  const events = expectRecord(value, 'events');
  const rawLogTexts = events.logTexts;
  if (!Array.isArray(rawLogTexts) || !rawLogTexts.every(text => typeof text === 'string')) {
    throw new Error('events.logTexts must be a string array');
  }

  const rawBuf = events.buf;
  const provisionalLength =
    rawBuf instanceof Float64Array ? rawBuf.length
      : isNumericArrayView(rawBuf) ? rawBuf.length
      : Array.isArray(rawBuf) ? rawBuf.length
      : -1;
  if (provisionalLength < 0) {
    throw new Error('events.buf must be a Float64Array or numeric array');
  }

  const count = normalizeEventCount(events.count, provisionalLength);
  const packed: PackedEvents = {
    buf: normalizeEventBuffer(rawBuf, count),
    logTexts: rawLogTexts.slice(),
    count,
  };

  if (events.eventTypeIdxs !== undefined) {
    packed.eventTypeIdxs = normalizeInt16Array(events.eventTypeIdxs, count, 'events.eventTypeIdxs');
  }
  if (events.peerNodeIdxs !== undefined) {
    packed.peerNodeIdxs = normalizeInt32Array(events.peerNodeIdxs, count, 'events.peerNodeIdxs');
  }

  return packed;
}

export function normalizeDecoderOutput(value: unknown): DecoderOutput {
  const output = expectRecord(value, 'DecoderOutput');
  const header = expectRecord(output.header, 'header');

  return {
    header: {
      nodes: expectArray(header.nodes, 'header.nodes'),
      edges: expectArray(header.edges, 'header.edges'),
      meta: isRecord(header.meta) ? { ...header.meta } : {},
    },
    events: normalizePackedEvents(output.events),
    states: expectArray(output.states, 'states'),
    arcLayers: expectArray(output.arcLayers, 'arcLayers'),
    metrics: expectArray(output.metrics, 'metrics'),
    eventTypes: output.eventTypes === undefined ? undefined : expectArray(output.eventTypes, 'eventTypes'),
    milestones: output.milestones === undefined ? [] : expectArray(output.milestones, 'milestones'),
    chartHints: isRecord(output.chartHints) ? { ...output.chartHints } : {},
    messages: output.messages === undefined ? undefined : expectArray(output.messages, 'messages'),
  } as DecoderOutput;
}
