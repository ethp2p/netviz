import type {
  Decoder, DecodeOptions, DecoderOutput, CanonicalHeader,
  NodeSpec, EdgeSpec, StateDef, ArcLayerDef, MetricDef,
  ChartHints, Milestone, MessageInfo, PackedEvents, EventTypeDef,
} from '../decoder-sdk';
import {
  hex, oklch,
  createEventWriter, parseNdjson,
  createHeader, defineStates, defineArcLayers, defineMetrics,
  milestone, percentileMilestones,
} from '../decoder-sdk';

// ---------------------------------------------------------------------------
// Field index where messageID lives, per event code.
// Events without an entry here (ph, ps, pu, pg) are "global" events
// included by time window rather than message ID.
// ---------------------------------------------------------------------------
const MSG_ID_FIELD: Record<string, number> = {
  ss: 4, sd: 4, sx: 4, sp: 4, ce: 4,
  cs: 5, cr: 5, ru: 5, po: 5,
};

// ---------------------------------------------------------------------------
// Visual vocabulary
// ---------------------------------------------------------------------------

const COLORS = {
  idle:      hex('#57534e'),
  session:   oklch(0.55, 0.03, 250),
  receiving: oklch(0.72, 0.12, 230),
  decoded:   oklch(0.75, 0.14, 155),
  error:     oklch(0.65, 0.20, 25),
  origin:    oklch(0.72, 0.14, 300),
  chunkSent: oklch(0.82, 0.14, 95),
  lastDecode: oklch(0.80, 0.10, 155),
  routing:   oklch(0.65, 0.10, 280),
  redundant: oklch(0.72, 0.14, 60),
  surplus:   oklch(0.50, 0, 0),
} as const;

const STATES: StateDef[] = defineStates([
  { name: 'idle',      label: 'Idle',      color: COLORS.idle, initial: true },
  { name: 'session',   label: 'Session',   color: COLORS.session },
  { name: 'receiving', label: 'Receiving', color: COLORS.receiving, statsGroup: 'Nodes', statsOrder: 3 },
  { name: 'decoded',   label: 'Decoded',   color: COLORS.decoded, terminal: true, statsGroup: 'Nodes', statsOrder: 1 },
  { name: 'error',     label: 'Error',     color: COLORS.error,   terminal: true, statsGroup: 'Nodes', statsOrder: 4 },
]);

const ARC_LAYERS: ArcLayerDef[] = defineArcLayers([
  { name: 'chunks',  label: 'Chunk transfers', color: COLORS.receiving, lifetimeUs: 500_000, travelUs: 300_000 },
  { name: 'routing', label: 'Routing updates', color: COLORS.routing,   lifetimeUs: 10_000,  travelUs: 10_000, radius: 0.2 },
]);

const METRICS: MetricDef[] = defineMetrics([
  { name: 'accepted',      label: 'Accepted',      color: COLORS.decoded, overlay: 'ring', overlayGroup: 'accepted', overlayLabel: 'Useful',                statsGroup: 'Chunks received', statsOrder: 0 }, // 0
  { name: 'redundant',     label: 'Redundant',     color: COLORS.redundant, overlay: 'ring', overlayGroup: 'waste', overlayLabel: 'Redundant',           statsGroup: 'Chunks received', statsOrder: 1 }, // 1
  { name: 'decoding',      label: 'Decoding',      color: COLORS.receiving, overlay: 'ring', overlayGroup: 'late',  overlayLabel: 'During decode',       statsGroup: 'Chunks received', statsOrder: 2 }, // 2
  { name: 'surplus',       label: 'Surplus',       color: COLORS.surplus,   overlay: 'ring', overlayGroup: 'unused', overlayLabel: 'After decode',       statsGroup: 'Chunks received', statsOrder: 3 }, // 3
  { name: 'invalid',       label: 'Invalid',                                                     statsGroup: 'Chunks received', statsOrder: 4 }, // 4
  { name: 'pending',       label: 'Pending',                                                    statsGroup: 'Chunks received', statsOrder: 5 }, // 5
  { name: 'bytes_sent',    label: 'Bytes sent',    format: 'bytes',                             statsGroup: 'Transfer',        statsOrder: 0 }, // 6
  { name: 'chunks_sent',   label: 'Chunks sent',                                            statsGroup: 'Transfer',        statsOrder: 1 }, // 7
  { name: 'with_session',  label: 'With session', aggregate: 'last', kind: 'nodeCount',        statsGroup: 'Nodes',           statsOrder: 2 }, // 8
]);

// cr verdict → metric index
const VERDICT_TO_METRIC: Record<number, number> = {
  0: 0, // accepted
  1: 1, // redundant
  2: 2, // decoding
  3: 3, // surplus
  4: 4, // invalid
  5: 5, // pending
};

const EVENT_TYPES: EventTypeDef[] = [
  { code: 'ph', name: 'peer handshook', color: COLORS.session },
  { code: 'ps', name: 'peer subscribed', color: COLORS.session },
  { code: 'pu', name: 'peer unsubscribed', color: COLORS.session },
  { code: 'pg', name: 'peer gone', color: COLORS.session },
  { code: 'ss', name: 'session started', color: COLORS.receiving },
  { code: 'sd', name: 'session decoded', color: COLORS.decoded },
  { code: 'sx', name: 'session disposed', color: COLORS.session },
  { code: 'cs', name: 'chunk sent', color: COLORS.redundant },
  { code: 'cr', name: 'chunk received', color: COLORS.redundant },
  { code: 'ce', name: 'chunk error', color: COLORS.error },
  { code: 'ru', name: 'routing update', color: COLORS.routing },
  { code: 'po', name: 'preamble opened', color: COLORS.session },
  { code: 'sp', name: 'strategy progress', color: COLORS.routing },
];
const EVENT_TYPE_INDEX = new Map(EVENT_TYPES.map((eventType, index) => [eventType.code, index]));
const VERDICT_NAMES = ['accepted', 'redundant', 'decoding', 'surplus', 'invalid', 'pending'];

// State indices for readability
const S_IDLE = 0;
const S_SESSION = 1;
const S_RECEIVING = 2;
const S_DECODED = 3;
const S_ERROR = 4;
const M_SESSION = 8;

// ---------------------------------------------------------------------------
// Topology types (raw trace format)
// ---------------------------------------------------------------------------

interface TopoNodeSpec {
  num: number;
  upload_bw_mbps: number;
  download_bw_mbps: number;
  country?: string;
}

interface TopoEdgeSpec {
  source: number;
  target: number;
  latency_ms: number;
}

interface TraceTopology {
  nodes: TopoNodeSpec[];
  edges: TopoEdgeSpec[];
}

interface RawHeader {
  v: number;
  t0: string;
  nodes: string[];
  topology: TraceTopology | [number, number][];
  config: Record<string, unknown>;
}

interface MessageScan {
  firstTs: number;
  lastTs: number;
  decodes: number;
  chunks: number;
}

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

function parseHeader(raw: Record<string, unknown>): {
  canonical: CanonicalHeader;
  nameToIdx: Map<string, number>;
  nodeNames: string[];
} {
  const hdr = raw as unknown as RawHeader;
  if (hdr.v !== 1) throw new Error('Unsupported trace version: ' + hdr.v);

  // Normalize old topology format (array-of-pairs → {nodes, edges})
  let topo: TraceTopology;
  const rawTopo = hdr.topology as unknown;
  if (Array.isArray(rawTopo) && rawTopo.length > 0 && Array.isArray(rawTopo[0])) {
    const pairs = rawTopo as [number, number][];
    const nodeNums = new Set<number>();
    for (const [a, b] of pairs) { nodeNums.add(a); nodeNums.add(b); }
    topo = {
      nodes: Array.from(nodeNums).sort((a, b) => a - b).map(n => ({
        num: n, upload_bw_mbps: 0, download_bw_mbps: 0,
      })),
      edges: pairs.map(([a, b]) => ({ source: a, target: b, latency_ms: 0 })),
    };
  } else {
    topo = rawTopo as TraceTopology;
  }

  // Build name→index map and preserve the old bare peer-ID aliasing. Trace
  // peer identifiers may be emitted as "167" while header node names are
  // "n167", so both forms need to resolve to the same node index.
  const nodeNames = hdr.nodes;
  const nameToIdx = new Map<string, number>();
  for (let i = 0; i < nodeNames.length; i++) {
    const name = nodeNames[i];
    nameToIdx.set(name, i);
    if (name.length > 1 && /^[a-zA-Z]/.test(name[0])) {
      const bare = name.slice(1);
      if (!nameToIdx.has(bare)) {
        nameToIdx.set(bare, i);
      }
    }
  }

  // Map TopoNodeSpec into NodeSpec.props
  const topoNodeByNum = new Map<number, TopoNodeSpec>();
  for (const tn of topo.nodes) {
    topoNodeByNum.set(tn.num, tn);
  }

  const nodes: NodeSpec[] = nodeNames.map((name, i) => {
    const tn = topoNodeByNum.get(i);
    const props: Record<string, number | string> = {};
    if (tn) {
      props['upload_bw_mbps'] = tn.upload_bw_mbps;
      props['download_bw_mbps'] = tn.download_bw_mbps;
      if (tn.country) props['country'] = tn.country;
    }
    return { name, props };
  });

  const edges: EdgeSpec[] = topo.edges.map(e => ({
    source: e.source,
    target: e.target,
    latency: e.latency_ms * 1000, // ms → µs
  }));

  const meta: Record<string, unknown> = {};
  if (hdr.t0) meta['t0'] = hdr.t0;
  if (hdr.config) meta['config'] = hdr.config;

  return {
    canonical: createHeader(nodes, edges, meta),
    nameToIdx,
    nodeNames,
  };
}

export function buildEthp2pPreview(rawHeader: Record<string, unknown>): DecoderOutput {
  const { canonical } = parseHeader(rawHeader);
  return {
    header: canonical,
    events: {
      buf: new Float64Array(0),
      logTexts: [],
      count: 0,
      eventTypeIdxs: new Int16Array(0),
      peerNodeIdxs: new Int32Array(0),
    },
    states: STATES,
    arcLayers: ARC_LAYERS,
    metrics: METRICS,
    eventTypes: EVENT_TYPES,
    milestones: [],
    chartHints: {
      cdf: { stateIdx: S_DECODED },
      race: { stateIdx: S_DECODED },
      bandwidth: { arcLayer: 0 },
    },
    messages: [],
  };
}

// ---------------------------------------------------------------------------
// Message scanning
// ---------------------------------------------------------------------------

function scanMessages(eventLines: string[]): MessageInfo[] {
  const msgMap = new Map<string, MessageScan>();

  for (const line of eventLines) {
    if (!line) continue;
    let ev: unknown[];
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (!Array.isArray(ev) || ev.length < 3) continue;

    const type = ev[2] as string;
    const fieldIdx = MSG_ID_FIELD[type];
    if (fieldIdx === undefined) continue;

    const msgId = ev[fieldIdx] as string;
    if (typeof msgId !== 'string') continue;

    const ts = ev[0] as number;
    const m = msgMap.get(msgId);
    if (!m) {
      msgMap.set(msgId, { firstTs: ts, lastTs: ts, decodes: 0, chunks: 0 });
    } else {
      if (ts < m.firstTs) m.firstTs = ts;
      if (ts > m.lastTs) m.lastTs = ts;
    }
    if (type === 'sd') msgMap.get(msgId)!.decodes++;
    if (type === 'cs') msgMap.get(msgId)!.chunks++;
  }

  const messages: MessageInfo[] = [];
  for (const [id, m] of msgMap) {
    const durationMs = Math.round((m.lastTs - m.firstTs) / 1000);
    messages.push({
      id,
      firstTs: m.firstTs,
      lastTs: m.lastTs,
      label: `${id} - ${durationMs}ms, ${m.decodes} decodes, ${m.chunks} chunks`,
    });
  }
  messages.sort((a, b) => a.firstTs - b.firstTs);
  return messages;
}

// ---------------------------------------------------------------------------
// Event selection + mapping
// ---------------------------------------------------------------------------

function selectAndMapEvents(
  eventLines: string[],
  selectedMsg: MessageInfo | undefined,
  nameToIdx: Map<string, number>,
  nodeNames: string[],
  nodeCount: number,
): {
  events: PackedEvents;
  milestones: Milestone[];
  originNodeIdx: number;
} {
  if (!selectedMsg) {
    return {
      events: { buf: new Float64Array(0), logTexts: [], count: 0, eventTypeIdxs: new Int16Array(0), peerNodeIdxs: new Int32Array(0) },
      milestones: [],
      originNodeIdx: -1,
    };
  }

  const selectedEvents: unknown[][] = [];
  for (const line of eventLines) {
    if (!line) continue;
    let ev: unknown[];
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (!Array.isArray(ev) || ev.length < 3) continue;

    const type = ev[2] as string;
    const fieldIdx = MSG_ID_FIELD[type];

    if (fieldIdx !== undefined) {
      if (ev[fieldIdx] === selectedMsg.id) selectedEvents.push(ev);
    } else {
      const ts = ev[0] as number;
      if (ts >= selectedMsg.firstTs && ts <= selectedMsg.lastTs) selectedEvents.push(ev);
    }
  }

  selectedEvents.sort((a, b) => (a[0] as number) - (b[0] as number));

  const w = createEventWriter(selectedEvents.length);
  const eventTypeIdxs: number[] = [];
  const peerNodeIdxs: number[] = [];

  function writeHiddenState(ts: number, nodeIdx: number, stateIdx: number): void {
    w.state(ts, nodeIdx, stateIdx);
    eventTypeIdxs.push(-1);
    peerNodeIdxs.push(-1);
  }

  function writeHiddenTransfer(ts: number, nodeIdx: number, peerIdx: number, bytes: number, layerIdx: number): void {
    w.transfer(ts, nodeIdx, peerIdx, bytes, layerIdx);
    eventTypeIdxs.push(-1);
    peerNodeIdxs.push(-1);
  }

  function writeHiddenMetric(ts: number, nodeIdx: number, metricIdx: number, value: number): void {
    w.metric(ts, nodeIdx, metricIdx, value);
    eventTypeIdxs.push(-1);
    peerNodeIdxs.push(-1);
  }

  function writeHiddenProgress(ts: number, nodeIdx: number, have: number, need: number): void {
    w.progress(ts, nodeIdx, have, need);
    eventTypeIdxs.push(-1);
    peerNodeIdxs.push(-1);
  }

  function writeHiddenLink(ts: number, nodeIdx: number, peerIdx: number, connected: 0 | 1): void {
    w.link(ts, nodeIdx, peerIdx, connected);
    eventTypeIdxs.push(-1);
    peerNodeIdxs.push(-1);
  }

  function writeVisible(ts: number, nodeIdx: number, type: string, detail: string, peerIdx = -1): void {
    w.log(ts, nodeIdx, detail);
    eventTypeIdxs.push(EVENT_TYPE_INDEX.get(type) ?? -1);
    peerNodeIdxs.push(peerIdx);
  }

  function formatLatency(us: number): string {
    return (us / 1000).toFixed(3) + 'ms';
  }

  // Per-node tracking (counters, not keyed Sets: assumes no duplicate ss/sd
  // events for the same channel:messageId pair, which holds for well-formed traces)
  const sessions = new Uint16Array(nodeCount);
  const decodedCount = new Uint16Array(nodeCount);
  const nodeState = new Uint8Array(nodeCount); // tracks current state index per node

  // Milestone tracking
  let originStart = -1;
  let originNodeIdx = -1;
  let firstChunkSent = -1;
  let firstChunkRecv = -1;
  const firstDecodePerNode = new Map<number, number>();

  for (const ev of selectedEvents) {
    const ts = ev[0] as number;
    const nodeIdx = ev[1] as number;
    const code = ev[2] as string;

    switch (code) {
      case 'ss': {
        sessions[nodeIdx]++;
        writeHiddenMetric(ts, nodeIdx, M_SESSION, sessions[nodeIdx]);
        // Transition idle → session only if node was idle
        if (sessions[nodeIdx] === 1 && nodeState[nodeIdx] === S_IDLE) {
          writeHiddenState(ts, nodeIdx, S_SESSION);
          nodeState[nodeIdx] = S_SESSION;
        }
        // Milestone: origin encodes (role=0)
        if ((ev[5] as number) === 0 && originStart < 0) {
          originStart = ts;
          originNodeIdx = nodeIdx;
        }
        writeVisible(ts, nodeIdx, 'ss', `${ev[3] as string}:${ev[4] as string} role=${ev[5] as number}`);
        break;
      }

      case 'sd': {
        decodedCount[nodeIdx]++;
        writeHiddenState(ts, nodeIdx, S_DECODED);
        nodeState[nodeIdx] = S_DECODED;
        // Milestone: first decode per node
        if (!firstDecodePerNode.has(nodeIdx)) {
          firstDecodePerNode.set(nodeIdx, ts);
        }
        writeVisible(ts, nodeIdx, 'sd', `${ev[3] as string}:${ev[4] as string} lat=${formatLatency(ev[5] as number)}`);
        break;
      }

      case 'sx': {
        if (sessions[nodeIdx] > 0) sessions[nodeIdx]--;
        writeHiddenMetric(ts, nodeIdx, M_SESSION, sessions[nodeIdx]);
        if (sessions[nodeIdx] === 0 && decodedCount[nodeIdx] === 0) {
          writeHiddenState(ts, nodeIdx, S_IDLE);
          nodeState[nodeIdx] = S_IDLE;
        }
        writeVisible(ts, nodeIdx, 'sx', `${ev[3] as string}:${ev[4] as string} ${ev[5] as string}`);
        break;
      }

      case 'cs': {
        const peerName = ev[3] as string;
        const bytes = (ev[6] as number) || 0;
        const peerIdx = nameToIdx.get(peerName);
        if (peerIdx !== undefined) {
          writeHiddenTransfer(ts, nodeIdx, peerIdx, bytes, 0);
        }
        writeHiddenMetric(ts, nodeIdx, 6, bytes);  // bytes_sent
        writeHiddenMetric(ts, nodeIdx, 7, 1);      // chunks_sent
        if (firstChunkSent < 0) firstChunkSent = ts;
        writeVisible(ts, nodeIdx, 'cs', `peer=${peerName} ${ev[4] as string}:${ev[5] as string} ${bytes}B`, peerIdx ?? -1);
        break;
      }

      case 'cr': {
        const v = (ev[6] as number) || 0;
        const metricIdx = VERDICT_TO_METRIC[v];
        if (metricIdx !== undefined) {
          writeHiddenMetric(ts, nodeIdx, metricIdx, 1);
        }
        if (nodeState[nodeIdx] !== S_DECODED && nodeState[nodeIdx] !== S_ERROR) {
          writeHiddenState(ts, nodeIdx, S_RECEIVING);
          nodeState[nodeIdx] = S_RECEIVING;
        }
        if (firstChunkRecv < 0) firstChunkRecv = ts;
        const peerName = ev[3] as string;
        const peerIdx = nameToIdx.get(peerName);
        writeVisible(ts, nodeIdx, 'cr', `peer=${peerName} ${ev[4] as string}:${ev[5] as string} ${VERDICT_NAMES[v] ?? v}`, peerIdx ?? -1);
        break;
      }

      case 'ce': {
        writeHiddenState(ts, nodeIdx, S_ERROR);
        nodeState[nodeIdx] = S_ERROR;
        writeVisible(ts, nodeIdx, 'ce', `${ev[3] as string}:${ev[4] as string} ${ev[5] as string}`);
        break;
      }

      case 'ru': {
        const peerName = ev[3] as string;
        const peerIdx = nameToIdx.get(peerName);
        if (peerIdx !== undefined) {
          writeHiddenTransfer(ts, nodeIdx, peerIdx, 0, 1);
        }
        writeVisible(ts, nodeIdx, 'ru', `peer=${peerName} ${ev[4] as string}:${ev[5] as string}`, peerIdx ?? -1);
        break;
      }

      case 'sp': {
        writeHiddenProgress(ts, nodeIdx, ev[5] as number, ev[6] as number);
        writeVisible(ts, nodeIdx, 'sp', `${ev[3] as string}:${ev[4] as string} ${ev[5] as number}/${ev[6] as number}`);
        break;
      }

      case 'po': {
        const peerName = ev[3] as string;
        const peerIdx = nameToIdx.get(peerName);
        writeVisible(ts, nodeIdx, 'po', `peer=${peerName} ${ev[4] as string}:${ev[5] as string}`, peerIdx ?? -1);
        break;
      }

      case 'ph': {
        const peerName = ev[3] as string;
        const peerIdx = nameToIdx.get(peerName);
        if (peerIdx !== undefined) {
          writeHiddenLink(ts, nodeIdx, peerIdx, 1);
        }
        const channels = Array.isArray(ev[5]) ? (ev[5] as string[]).join(',') : '';
        const channelSuffix = channels.length > 0 ? ` channels=${channels}` : '';
        writeVisible(ts, nodeIdx, 'ph', `peer=${peerName} v=${String(ev[4])}${channelSuffix}`, peerIdx ?? -1);
        break;
      }

      case 'ps': {
        const peerName = ev[3] as string;
        const peerIdx = nameToIdx.get(peerName);
        writeVisible(ts, nodeIdx, 'ps', `peer=${peerName} channel=${ev[4] as string}`, peerIdx ?? -1);
        break;
      }

      case 'pu': {
        const peerName = ev[3] as string;
        const peerIdx = nameToIdx.get(peerName);
        writeVisible(ts, nodeIdx, 'pu', `peer=${peerName} channel=${ev[4] as string}`, peerIdx ?? -1);
        break;
      }

      case 'pg': {
        const peerName = ev[3] as string;
        const peerIdx = nameToIdx.get(peerName);
        if (peerIdx !== undefined) {
          writeHiddenLink(ts, nodeIdx, peerIdx, 0);
        }
        writeVisible(ts, nodeIdx, 'pg', `peer=${peerName}`, peerIdx ?? -1);
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Milestones
  // ---------------------------------------------------------------------------
  const milestones: Milestone[] = [];

  if (originStart >= 0) {
    milestones.push(milestone(originStart, 'Origin encodes', COLORS.origin));
  }
  if (firstChunkSent >= 0) {
    milestones.push(milestone(firstChunkSent, '1st chunk sent', COLORS.chunkSent));
  }
  if (firstChunkRecv >= 0) {
    milestones.push(milestone(firstChunkRecv, '1st chunk recv', COLORS.receiving));
  }

  const decodeTimes = Array.from(firstDecodePerNode.values()).sort((a, b) => a - b);
  if (decodeTimes.length > 0) {
    const first = decodeTimes[0];
    const firstNodeIdx = Array.from(firstDecodePerNode.entries()).find(([, t]) => t === first)?.[0];
    const firstNodeName = firstNodeIdx !== undefined ? nodeNames[firstNodeIdx] : '?';
    milestones.push(milestone(first, `1st decode (${firstNodeName})`, COLORS.decoded));

    // Percentile milestones, skip any that equal the first decode time
    const pctMilestones = percentileMilestones(decodeTimes, 'decode', COLORS.decoded);
    for (const m of pctMilestones) {
      if (m.time !== first) milestones.push(m);
    }

    const last = decodeTimes[decodeTimes.length - 1];
    if (last !== first) {
      const lastNodeIdx = Array.from(firstDecodePerNode.entries()).find(([, t]) => t === last)?.[0];
      const lastNodeName = lastNodeIdx !== undefined ? nodeNames[lastNodeIdx] : '?';
      milestones.push(milestone(last, `Last decode (${lastNodeName})`, COLORS.lastDecode));
    }
  }

  milestones.sort((a, b) => a.time - b.time);

  const events = w.finish();
  events.eventTypeIdxs = Int16Array.from(eventTypeIdxs);
  events.peerNodeIdxs = Int32Array.from(peerNodeIdxs);
  return { events, milestones, originNodeIdx };
}

// ---------------------------------------------------------------------------
// Decoder implementation
// ---------------------------------------------------------------------------

function decode(lines: string[], options?: DecodeOptions): DecoderOutput {
  const { header: rawHeader, eventLines } = parseNdjson(lines);
  const { canonical, nameToIdx, nodeNames } = parseHeader(rawHeader);

  const messages = scanMessages(eventLines);
  const selectedMsgId = options?.messageId ?? messages[0]?.id;
  const selectedMsg = selectedMsgId
    ? messages.find(m => m.id === selectedMsgId)
    : undefined;

  const { events, milestones: ms, originNodeIdx } = selectAndMapEvents(
    eventLines, selectedMsg, nameToIdx, nodeNames, canonical.nodes.length,
  );

  const chartHints: ChartHints = {
    cdf: { stateIdx: S_DECODED },
    race: { stateIdx: S_DECODED },
    bandwidth: {
      arcLayer: 0,
      originNode: originNodeIdx >= 0 ? originNodeIdx : undefined,
    },
  };

  return {
    header: canonical,
    events,
    states: STATES,
    arcLayers: ARC_LAYERS,
    metrics: METRICS,
    eventTypes: EVENT_TYPES,
    milestones: ms,
    chartHints,
    messages,
  };
}

export const ethp2pDecoder: Decoder = {
  name: 'ethp2p',
  version: '1.0.0',
  decode,
};
