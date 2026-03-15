import { describe, it, expect } from 'vitest';
import { ethp2pDecoder } from './ethp2p';
import { OP_STATE, OP_METRIC, OP_TRANSFER, OP_LOG, OP_PROGRESS, EVENT_STRIDE } from '../decoder-sdk';

// ---------------------------------------------------------------------------
// Trace helpers
// ---------------------------------------------------------------------------

// The trace format is newline-delimited JSON:
//   line 0: header object
//   lines 1+: event arrays
//
// Header shape:
//   { v: 1, t0: string, nodes: string[], topology: { nodes: TopoNodeSpec[], edges: TopoEdgeSpec[] }, cfg: {} }
//
// Event array shape varies by code:
//   ss: [ts, nodeIdx, 'ss', strategy, msgId, role]
//   sd: [ts, nodeIdx, 'sd', strategy, msgId, latencyUs]
//   sx: [ts, nodeIdx, 'sx', strategy, msgId, reason]
//   sp: [ts, nodeIdx, 'sp', strategy, msgId, have, need]
//   cs: [ts, nodeIdx, 'cs', peerName, strategy, msgId, bytes]
//   cr: [ts, nodeIdx, 'cr', peerName, strategy, msgId, verdict]
//   ce: [ts, nodeIdx, 'ce', strategy, msgId, reason]
//   ph: [ts, nodeIdx, 'ph', peerName, version]
//   ps: [ts, nodeIdx, 'ps', peerName, topic]
//   pu: [ts, nodeIdx, 'pu', peerName, topic]
//   pg: [ts, nodeIdx, 'pg', peerName]
//   ru: [ts, nodeIdx, 'ru', peerName, strategy, msgId]

function header(extra?: Record<string, unknown>): string {
  return JSON.stringify({
    v: 1,
    t0: '2024-01-01T00:00:00Z',
    nodes: ['n0', 'n1'],
    topology: {
      nodes: [
        { num: 0, upload_bw_mbps: 10, download_bw_mbps: 10 },
        { num: 1, upload_bw_mbps: 10, download_bw_mbps: 10 },
      ],
      edges: [{ source: 0, target: 1, latency_ms: 50 }],
    },
    cfg: {},
    ...extra,
  });
}

function event(fields: unknown[]): string {
  return JSON.stringify(fields);
}

function makeTrace(lines: string[]): string[] {
  return lines;
}

// ---------------------------------------------------------------------------
// Basic identity / structure
// ---------------------------------------------------------------------------

describe('ethp2pDecoder', () => {
  it('has name "ethp2p"', () => {
    expect(ethp2pDecoder.name).toBe('ethp2p');
  });

  it('has a version string', () => {
    expect(typeof ethp2pDecoder.version).toBe('string');
    expect(ethp2pDecoder.version.length).toBeGreaterThan(0);
  });

  it('has a decode function', () => {
    expect(typeof ethp2pDecoder.decode).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Minimal valid input: 2 nodes, 1 edge, no events
// ---------------------------------------------------------------------------

describe('decode — minimal header, no events', () => {
  // parseNdjson requires at least 2 lines; the second can be empty/junk.
  const lines = makeTrace([header(), '']);

  it('returns a DecoderOutput with the expected top-level fields', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(out).toBeDefined();
    expect(out.header).toBeDefined();
    expect(out.events).toBeDefined();
    expect(out.states).toBeDefined();
    expect(out.arcLayers).toBeDefined();
    expect(out.metrics).toBeDefined();
    expect(out.milestones).toBeDefined();
    expect(out.chartHints).toBeDefined();
  });

  it('produces 2 nodes from the header', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(out.header.nodes).toHaveLength(2);
    expect(out.header.nodes[0].name).toBe('n0');
    expect(out.header.nodes[1].name).toBe('n1');
  });

  it('produces 1 edge with latency converted from ms to µs', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(out.header.edges).toHaveLength(1);
    expect(out.header.edges[0].source).toBe(0);
    expect(out.header.edges[0].target).toBe(1);
    expect(out.header.edges[0].latency).toBe(50_000); // 50 ms → 50000 µs
  });

  it('produces zero events when no event lines exist', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(out.events.count).toBe(0);
    expect(out.events.buf.byteLength).toBe(0);
  });

  it('produces an empty messages array when there are no events', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(out.messages).toBeDefined();
    expect(out.messages).toHaveLength(0);
  });

  it('stores t0 and cfg in header.meta', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(out.header.meta['t0']).toBe('2024-01-01T00:00:00Z');
    expect(out.header.meta['cfg']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Header parsing — old topology format (array of pairs)
// ---------------------------------------------------------------------------

describe('decode — legacy array-of-pairs topology', () => {
  const legacyHeader = JSON.stringify({
    v: 1,
    t0: '2024-01-01T00:00:00Z',
    nodes: ['n0', 'n1'],
    topology: [[0, 1]],
    cfg: {},
  });

  it('normalizes legacy topology and produces edges', () => {
    const out = ethp2pDecoder.decode([legacyHeader, '']);
    expect(out.header.edges).toHaveLength(1);
    expect(out.header.edges[0].latency).toBe(0); // legacy format has no latency
  });
});

// ---------------------------------------------------------------------------
// Header parsing — version mismatch
// ---------------------------------------------------------------------------

describe('decode — unsupported version', () => {
  it('throws for v !== 1', () => {
    const badHeader = JSON.stringify({ v: 2, nodes: [], topology: { nodes: [], edges: [] }, cfg: {} });
    expect(() => ethp2pDecoder.decode([badHeader, ''])).toThrow('Unsupported trace version');
  });
});

// ---------------------------------------------------------------------------
// Header parsing — missing fields produce reasonable output
// ---------------------------------------------------------------------------

describe('decode — header with missing optional fields', () => {
  it('handles missing t0 without throwing', () => {
    const h = JSON.stringify({
      v: 1,
      nodes: ['n0'],
      topology: { nodes: [{ num: 0, upload_bw_mbps: 0, download_bw_mbps: 0 }], edges: [] },
      cfg: {},
    });
    const out = ethp2pDecoder.decode([h, '']);
    expect(out.header.nodes).toHaveLength(1);
    expect(out.header.meta['t0']).toBeUndefined();
  });

  it('handles missing cfg without throwing', () => {
    const h = JSON.stringify({
      v: 1,
      t0: '2024-01-01T00:00:00Z',
      nodes: ['n0'],
      topology: { nodes: [{ num: 0, upload_bw_mbps: 0, download_bw_mbps: 0 }], edges: [] },
    });
    const out = ethp2pDecoder.decode([h, '']);
    expect(out.header.nodes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Node name aliasing: bare numeric IDs resolve to "n<N>" nodes
// ---------------------------------------------------------------------------

describe('decode — bare node name aliasing', () => {
  it('registers both "n0" and "0" as aliases for the same node index', () => {
    // A cs event uses bare peer name "1"; it should resolve to node index 1.
    const lines = [
      header(),
      event([1000, 0, 'ss', 'rs', 'msg1', 0]),
      event([2000, 0, 'cs', '1', 'rs', 'msg1', 100]),
      event([3000, 1, 'cr', 'n0', 'rs', 'msg1', 0]),
      event([4000, 1, 'sd', 'rs', 'msg1', 3000]),
    ];
    // Should not throw; the bare peer name "1" maps to node 1.
    expect(() => ethp2pDecoder.decode(lines)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Message scanning
// ---------------------------------------------------------------------------

describe('decode — message scanning', () => {
  const lines = makeTrace([
    header(),
    event([1000, 0, 'ss', 'rs', 'msg-a', 0]),
    event([2000, 1, 'cr', 'n0', 'rs', 'msg-a', 0]),
    event([3000, 1, 'sd', 'rs', 'msg-a', 2000]),
    event([5000, 0, 'ss', 'rs', 'msg-b', 0]),
    event([6000, 1, 'sd', 'rs', 'msg-b', 1000]),
  ]);

  it('discovers all distinct message IDs', () => {
    const out = ethp2pDecoder.decode(lines);
    const ids = out.messages?.map(m => m.id) ?? [];
    expect(ids).toContain('msg-a');
    expect(ids).toContain('msg-b');
  });

  it('sorts messages by firstTs ascending', () => {
    const out = ethp2pDecoder.decode(lines);
    const msgs = out.messages ?? [];
    expect(msgs[0].id).toBe('msg-a');
    expect(msgs[1].id).toBe('msg-b');
  });

  it('records correct firstTs and lastTs for a message', () => {
    const out = ethp2pDecoder.decode(lines);
    const msgA = out.messages?.find(m => m.id === 'msg-a');
    expect(msgA?.firstTs).toBe(1000);
    expect(msgA?.lastTs).toBe(3000);
  });

  it('auto-selects the first message when no messageId option is provided', () => {
    const out = ethp2pDecoder.decode(lines);
    // Events should be non-empty because the first message was selected.
    expect(out.events.count).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Event parsing: ss (session start)
// ---------------------------------------------------------------------------

describe('decode — ss event', () => {
  const lines = [
    header(),
    event([1000, 0, 'ss', 'rs', 'msg1', 0]),
    event([9999, 0, 'sd', 'rs', 'msg1', 8999]), // keep window open
  ];

  it('produces at least one event', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(out.events.count).toBeGreaterThan(0);
  });

  it('emits a visible log entry for ss', () => {
    const out = ethp2pDecoder.decode(lines);
    const { buf, logTexts, eventTypeIdxs } = out.events;
    // Find OP_LOG events
    const logEntries: string[] = [];
    for (let i = 0; i < out.events.count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === OP_LOG) {
        logEntries.push(logTexts[buf[base + 3]]);
      }
    }
    expect(logEntries.some(t => t.includes('role=0'))).toBe(true);
  });

  it('transitions node 0 to session state (emits OP_STATE)', () => {
    const out = ethp2pDecoder.decode(lines);
    const { buf } = out.events;
    const stateEvents: Array<{ nodeIdx: number; stateIdx: number }> = [];
    for (let i = 0; i < out.events.count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === OP_STATE) {
        stateEvents.push({ nodeIdx: buf[base + 1], stateIdx: buf[base + 3] });
      }
    }
    // State index 1 = session
    expect(stateEvents.some(e => e.nodeIdx === 0 && e.stateIdx === 1)).toBe(true);
  });

  it('sets originNodeIdx to 0 (role=0 node)', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(out.chartHints.bandwidth?.originNode).toBe(0);
  });

  it('emits an OP_METRIC event for the with_session metric (index 8)', () => {
    const out = ethp2pDecoder.decode(lines);
    const { buf } = out.events;
    const metricEvents: Array<{ metricIdx: number; value: number }> = [];
    for (let i = 0; i < out.events.count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === OP_METRIC) {
        metricEvents.push({ metricIdx: buf[base + 3], value: buf[base + 4] });
      }
    }
    expect(metricEvents.some(e => e.metricIdx === 8 && e.value === 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Event parsing: sd (session decoded)
// ---------------------------------------------------------------------------

describe('decode — sd event', () => {
  const lines = [
    header(),
    event([1000, 0, 'ss', 'rs', 'msg1', 0]),
    event([4000, 1, 'sd', 'rs', 'msg1', 3000]),
  ];

  it('transitions receiving node to decoded state (state index 3)', () => {
    const out = ethp2pDecoder.decode(lines);
    const { buf } = out.events;
    const stateEvents: Array<{ nodeIdx: number; stateIdx: number }> = [];
    for (let i = 0; i < out.events.count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === OP_STATE) {
        stateEvents.push({ nodeIdx: buf[base + 1], stateIdx: buf[base + 3] });
      }
    }
    expect(stateEvents.some(e => e.nodeIdx === 1 && e.stateIdx === 3)).toBe(true);
  });

  it('emits a milestone for the first decode', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(out.milestones.some(m => m.label.includes('1st decode') || m.label.includes('decode'))).toBe(true);
  });

  it('emits a log entry containing the latency', () => {
    const out = ethp2pDecoder.decode(lines);
    const { buf, logTexts } = out.events;
    const logs: string[] = [];
    for (let i = 0; i < out.events.count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === OP_LOG) logs.push(logTexts[buf[base + 3]]);
    }
    expect(logs.some(t => t.includes('lat='))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Event parsing: sx (session disposed)
// ---------------------------------------------------------------------------

describe('decode — sx event', () => {
  it('decrements session count and reverts to idle if no decodes', () => {
    const lines = [
      header(),
      event([1000, 0, 'ss', 'rs', 'msg1', 0]),
      event([2000, 0, 'sx', 'rs', 'msg1', 'timeout']),
    ];
    const out = ethp2pDecoder.decode(lines);
    const { buf } = out.events;
    const stateEvents: Array<{ ts: number; nodeIdx: number; stateIdx: number }> = [];
    for (let i = 0; i < out.events.count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === OP_STATE) {
        stateEvents.push({ ts: buf[base], nodeIdx: buf[base + 1], stateIdx: buf[base + 3] });
      }
    }
    // Should transition session → idle (state 0) after sx with no decode
    const idle = stateEvents.filter(e => e.nodeIdx === 0 && e.stateIdx === 0);
    expect(idle.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Event parsing: cs (chunk sent) and cr (chunk received)
// ---------------------------------------------------------------------------

describe('decode — cs / cr events', () => {
  const lines = [
    header(),
    event([1000, 0, 'ss', 'rs', 'msg1', 0]),
    event([1500, 0, 'cs', 'n1', 'rs', 'msg1', 1024]),
    event([2000, 1, 'cr', 'n0', 'rs', 'msg1', 0]),  // verdict 0 = accepted
    event([3000, 1, 'sd', 'rs', 'msg1', 2000]),
  ];

  it('emits a transfer arc for cs (OP_TRANSFER, layer 0)', () => {
    const out = ethp2pDecoder.decode(lines);
    const { buf } = out.events;
    const transfers: Array<{ peerIdx: number; bytes: number; layer: number }> = [];
    for (let i = 0; i < out.events.count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === OP_TRANSFER) {
        transfers.push({ peerIdx: buf[base + 3], bytes: buf[base + 4], layer: buf[base + 5] });
      }
    }
    // cs from node 0 to n1 (index 1) with 1024 bytes on layer 0
    expect(transfers.some(t => t.peerIdx === 1 && t.bytes === 1024 && t.layer === 0)).toBe(true);
  });

  it('emits OP_METRIC for bytes_sent (index 6) on cs', () => {
    const out = ethp2pDecoder.decode(lines);
    const { buf } = out.events;
    const metrics: Array<{ metricIdx: number; value: number }> = [];
    for (let i = 0; i < out.events.count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === OP_METRIC) {
        metrics.push({ metricIdx: buf[base + 3], value: buf[base + 4] });
      }
    }
    expect(metrics.some(m => m.metricIdx === 6 && m.value === 1024)).toBe(true);
  });

  it('emits OP_METRIC for chunks_sent (index 7) on cs', () => {
    const out = ethp2pDecoder.decode(lines);
    const { buf } = out.events;
    const metrics: Array<{ metricIdx: number; value: number }> = [];
    for (let i = 0; i < out.events.count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === OP_METRIC) {
        metrics.push({ metricIdx: buf[base + 3], value: buf[base + 4] });
      }
    }
    expect(metrics.some(m => m.metricIdx === 7 && m.value === 1)).toBe(true);
  });

  it('transitions receiving node to receiving state on cr (state index 2)', () => {
    const out = ethp2pDecoder.decode(lines);
    const { buf } = out.events;
    const stateEvents: Array<{ nodeIdx: number; stateIdx: number }> = [];
    for (let i = 0; i < out.events.count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === OP_STATE) {
        stateEvents.push({ nodeIdx: buf[base + 1], stateIdx: buf[base + 3] });
      }
    }
    expect(stateEvents.some(e => e.nodeIdx === 1 && e.stateIdx === 2)).toBe(true);
  });

  it('emits OP_METRIC for the accepted verdict (metric index 0) on cr', () => {
    const out = ethp2pDecoder.decode(lines);
    const { buf } = out.events;
    const metrics: Array<{ nodeIdx: number; metricIdx: number }> = [];
    for (let i = 0; i < out.events.count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === OP_METRIC) {
        metrics.push({ nodeIdx: buf[base + 1], metricIdx: buf[base + 3] });
      }
    }
    expect(metrics.some(m => m.nodeIdx === 1 && m.metricIdx === 0)).toBe(true);
  });

  it('emits the "1st chunk sent" milestone', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(out.milestones.some(m => m.label.includes('chunk sent'))).toBe(true);
  });

  it('emits the "1st chunk recv" milestone', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(out.milestones.some(m => m.label.includes('chunk recv'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Event parsing: cs / cr — all verdict codes map to distinct metrics
// ---------------------------------------------------------------------------

describe('decode — cr verdict mapping', () => {
  const verdicts = [
    { v: 0, metricIdx: 0, name: 'accepted' },
    { v: 1, metricIdx: 1, name: 'useless' },
    { v: 2, metricIdx: 2, name: 'not_needed' },
    { v: 3, metricIdx: 3, name: 'invalid' },
    { v: 4, metricIdx: 4, name: 'duplicate' },
    { v: 5, metricIdx: 5, name: 'pending' },
  ];

  for (const { v, metricIdx, name } of verdicts) {
    it(`verdict ${v} (${name}) emits metric at index ${metricIdx}`, () => {
      const lines = [
        header(),
        event([1000, 0, 'ss', 'rs', 'msg1', 0]),
        event([2000, 1, 'cr', 'n0', 'rs', 'msg1', v]),
        event([3000, 1, 'sd', 'rs', 'msg1', 2000]),
      ];
      const out = ethp2pDecoder.decode(lines);
      const { buf } = out.events;
      const metrics: number[] = [];
      for (let i = 0; i < out.events.count; i++) {
        const base = i * EVENT_STRIDE;
        if (buf[base + 2] === OP_METRIC && buf[base + 1] === 1) {
          metrics.push(buf[base + 3]);
        }
      }
      expect(metrics).toContain(metricIdx);
    });
  }
});

// ---------------------------------------------------------------------------
// Event parsing: sp (strategy progress)
// ---------------------------------------------------------------------------

describe('decode — sp event', () => {
  const lines = [
    header(),
    event([1000, 0, 'ss', 'rs', 'msg1', 0]),
    event([1500, 1, 'sp', 'rs', 'msg1', 3, 10]),
    event([2000, 1, 'sd', 'rs', 'msg1', 1000]),
  ];

  it('emits OP_PROGRESS with correct have/need values', () => {
    const out = ethp2pDecoder.decode(lines);
    const { buf } = out.events;
    const progress: Array<{ nodeIdx: number; have: number; need: number }> = [];
    for (let i = 0; i < out.events.count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === OP_PROGRESS) {
        progress.push({ nodeIdx: buf[base + 1], have: buf[base + 3], need: buf[base + 4] });
      }
    }
    expect(progress.some(p => p.nodeIdx === 1 && p.have === 3 && p.need === 10)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Event parsing: ce (chunk error)
// ---------------------------------------------------------------------------

describe('decode — ce event', () => {
  it('transitions node to error state (state index 4)', () => {
    // cr at ts=3000 extends msg1's lastTs beyond the ce timestamp so the ce
    // event falls inside the selected message's time window.
    const lines = [
      header(),
      event([1000, 0, 'ss', 'rs', 'msg1', 0]),
      event([2000, 1, 'ce', 'rs', 'msg1', 'decode_error']),
      event([3000, 1, 'cr', 'n0', 'rs', 'msg1', 0]),
    ];
    const out = ethp2pDecoder.decode(lines);
    const { buf } = out.events;
    const stateEvents: Array<{ nodeIdx: number; stateIdx: number }> = [];
    for (let i = 0; i < out.events.count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === OP_STATE) {
        stateEvents.push({ nodeIdx: buf[base + 1], stateIdx: buf[base + 3] });
      }
    }
    expect(stateEvents.some(e => e.nodeIdx === 1 && e.stateIdx === 4)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Event parsing: ph / pg (peer handshook / peer gone)
// ---------------------------------------------------------------------------

describe('decode — ph / pg peer lifecycle events', () => {
  // ph and pg are "global" events included by time window (firstTs..lastTs of
  // the selected message). Placing them inside that window ensures they appear
  // in the decoded output.
  const lines = [
    header(),
    event([1000, 0, 'ss', 'rs', 'msg1', 0]),
    event([1100, 0, 'ph', 'n1', 'eth/1']),
    event([1500, 0, 'cs', 'n1', 'rs', 'msg1', 512]),
    event([2000, 1, 'sd', 'rs', 'msg1', 1000]),
    event([1800, 0, 'pg', 'n1']),
  ];

  it('emits OP_LINK connected=1 for ph', () => {
    const out = ethp2pDecoder.decode(lines);
    const { buf } = out.events;
    const links: Array<{ nodeIdx: number; peerIdx: number; connected: number }> = [];
    for (let i = 0; i < out.events.count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === 4) { // OP_LINK = 4
        links.push({ nodeIdx: buf[base + 1], peerIdx: buf[base + 3], connected: buf[base + 4] });
      }
    }
    expect(links.some(l => l.nodeIdx === 0 && l.peerIdx === 1 && l.connected === 1)).toBe(true);
  });

  it('emits OP_LINK connected=0 for pg', () => {
    const out = ethp2pDecoder.decode(lines);
    const { buf } = out.events;
    const links: Array<{ nodeIdx: number; peerIdx: number; connected: number }> = [];
    for (let i = 0; i < out.events.count; i++) {
      const base = i * EVENT_STRIDE;
      if (buf[base + 2] === 4) {
        links.push({ nodeIdx: buf[base + 1], peerIdx: buf[base + 3], connected: buf[base + 4] });
      }
    }
    expect(links.some(l => l.nodeIdx === 0 && l.peerIdx === 1 && l.connected === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DecodeOptions.messageId selects a specific message
// ---------------------------------------------------------------------------

describe('decode — options.messageId', () => {
  const lines = [
    header(),
    event([1000, 0, 'ss', 'rs', 'msg-a', 0]),
    event([2000, 1, 'sd', 'rs', 'msg-a', 1000]),
    event([5000, 0, 'ss', 'rs', 'msg-b', 0]),
    event([6000, 1, 'sd', 'rs', 'msg-b', 1000]),
  ];

  it('selects msg-b when messageId is "msg-b"', () => {
    const outA = ethp2pDecoder.decode(lines);              // default → msg-a
    const outB = ethp2pDecoder.decode(lines, { messageId: 'msg-b' });

    // msg-b events start at ts=5000; msg-a events start at ts=1000.
    // The earliest timestamp in the buf must differ between the two.
    expect(outA.events.buf[0]).toBe(1000);
    expect(outB.events.buf[0]).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Output structure: states / arcLayers / metrics / eventTypes
// ---------------------------------------------------------------------------

describe('decode — constant output fields', () => {
  const lines = [header(), ''];

  it('exposes 5 states', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(out.states).toHaveLength(5);
  });

  it('state names include idle, session, receiving, decoded, error', () => {
    const out = ethp2pDecoder.decode(lines);
    const names = out.states.map(s => s.name);
    expect(names).toContain('idle');
    expect(names).toContain('session');
    expect(names).toContain('receiving');
    expect(names).toContain('decoded');
    expect(names).toContain('error');
  });

  it('exposes 2 arc layers', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(out.arcLayers).toHaveLength(2);
  });

  it('exposes 9 metrics', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(out.metrics).toHaveLength(9);
  });

  it('exposes eventTypes array', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(Array.isArray(out.eventTypes)).toBe(true);
    expect(out.eventTypes!.length).toBeGreaterThan(0);
  });

  it('chartHints.cdf.stateIdx points to the decoded state', () => {
    const out = ethp2pDecoder.decode(lines);
    const decodedIdx = out.states.findIndex(s => s.name === 'decoded');
    expect(out.chartHints.cdf?.stateIdx).toBe(decodedIdx);
  });

  it('chartHints.race.stateIdx points to the decoded state', () => {
    const out = ethp2pDecoder.decode(lines);
    const decodedIdx = out.states.findIndex(s => s.name === 'decoded');
    expect(out.chartHints.race?.stateIdx).toBe(decodedIdx);
  });

  it('chartHints.bandwidth.arcLayer is 0', () => {
    const out = ethp2pDecoder.decode(lines);
    expect(out.chartHints.bandwidth?.arcLayer).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Malformed / ignored lines
// ---------------------------------------------------------------------------

describe('decode — malformed event lines', () => {
  it('skips non-JSON lines without throwing', () => {
    const lines = [header(), 'not json at all', event([1000, 0, 'ss', 'rs', 'msg1', 0]), event([2000, 0, 'sd', 'rs', 'msg1', 1000])];
    expect(() => ethp2pDecoder.decode(lines)).not.toThrow();
  });

  it('skips too-short arrays without throwing', () => {
    const lines = [header(), '[1000]', event([1000, 0, 'ss', 'rs', 'msg1', 0]), event([2000, 0, 'sd', 'rs', 'msg1', 1000])];
    expect(() => ethp2pDecoder.decode(lines)).not.toThrow();
  });

  it('skips unknown event codes gracefully', () => {
    const lines = [header(), event([1000, 0, 'zz', 'rs', 'msg1', 0]), event([2000, 0, 'ss', 'rs', 'msg1', 0]), event([3000, 0, 'sd', 'rs', 'msg1', 1000])];
    expect(() => ethp2pDecoder.decode(lines)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Milestones ordering
// ---------------------------------------------------------------------------

describe('decode — milestones are sorted by time', () => {
  const lines = [
    header(),
    event([1000, 0, 'ss', 'rs', 'msg1', 0]),
    event([1200, 0, 'cs', 'n1', 'rs', 'msg1', 512]),
    event([1400, 1, 'cr', 'n0', 'rs', 'msg1', 0]),
    event([1800, 1, 'sd', 'rs', 'msg1', 800]),
  ];

  it('returns milestones in ascending time order', () => {
    const out = ethp2pDecoder.decode(lines);
    for (let i = 1; i < out.milestones.length; i++) {
      expect(out.milestones[i].time).toBeGreaterThanOrEqual(out.milestones[i - 1].time);
    }
  });
});
