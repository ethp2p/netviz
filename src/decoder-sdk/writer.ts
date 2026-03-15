import type { PackedEvents } from './types';
import { OP_STATE, OP_TRANSFER, OP_PROGRESS, OP_METRIC, OP_LINK, OP_LOG, EVENT_STRIDE } from './types';

interface EventWriter {
  state(ts: number, node: number, stateIdx: number): void;
  transfer(ts: number, node: number, peer: number, bytes: number, layer: number): void;
  progress(ts: number, node: number, have: number, need: number): void;
  metric(ts: number, node: number, metricIdx: number, value: number): void;
  link(ts: number, node: number, peer: number, connected: 0 | 1): void;
  log(ts: number, node: number, text: string): void;
  finish(): PackedEvents;
}

const INITIAL_CAPACITY = 8192; // events, not bytes

export function createEventWriter(estimatedCount?: number): EventWriter {
  let capacity = estimatedCount ?? INITIAL_CAPACITY;
  let buf = new Float64Array(capacity * EVENT_STRIDE);
  let count = 0;
  const logTexts: string[] = [];

  function ensureCapacity(): void {
    if (count * EVENT_STRIDE >= buf.length) {
      capacity *= 2;
      const next = new Float64Array(capacity * EVENT_STRIDE);
      next.set(buf);
      buf = next;
    }
  }

  function write(ts: number, node: number, op: number, f0: number, f1: number, f2: number): void {
    ensureCapacity();
    const base = count * EVENT_STRIDE;
    buf[base] = ts;
    buf[base + 1] = node;
    buf[base + 2] = op;
    buf[base + 3] = f0;
    buf[base + 4] = f1;
    buf[base + 5] = f2;
    count++;
  }

  return {
    state(ts, node, stateIdx) { write(ts, node, OP_STATE, stateIdx, 0, 0); },
    transfer(ts, node, peer, bytes, layer) { write(ts, node, OP_TRANSFER, peer, bytes, layer); },
    progress(ts, node, have, need) { write(ts, node, OP_PROGRESS, have, need, 0); },
    metric(ts, node, metricIdx, value) { write(ts, node, OP_METRIC, metricIdx, value, 0); },
    link(ts, node, peer, connected) { write(ts, node, OP_LINK, peer, connected, 0); },
    log(ts, node, text) {
      const idx = logTexts.length;
      logTexts.push(text);
      write(ts, node, OP_LOG, idx, 0, 0);
    },
    finish(): PackedEvents {
      const trimmed = buf.slice(0, count * EVENT_STRIDE);
      return { buf: trimmed, logTexts, count };
    },
  };
}
