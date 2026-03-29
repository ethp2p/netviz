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

const MSG_ID_FIELD: Record<string, number> = {
  pb: 4, ud: 4,
  va: 5, dl: 5, du: 5, rj: 5,
  ms: 5, hs: 5, hr: 5, ws: 5, wr: 5, ns: 5, nr: 5,
};

const COLORS = {
  idle:       hex('#57534e'),
  origin:     oklch(0.73, 0.16, 300),
  announced:  oklch(0.82, 0.11, 90),
  requested:  oklch(0.80, 0.13, 230),
  validating: oklch(0.72, 0.10, 250),
  delivered:  oklch(0.76, 0.15, 155),
  rejected:   oklch(0.65, 0.20, 25),
  dropped:    oklch(0.56, 0.02, 250),
  messages:   oklch(0.74, 0.14, 170),
  ihave:      oklch(0.80, 0.10, 90),
  iwant:      oklch(0.76, 0.13, 230),
  mesh:       oklch(0.66, 0.10, 280),
  duplicate:  oklch(0.74, 0.13, 40),
} as const;

const STATES: StateDef[] = defineStates([
  { name: 'idle', label: 'Idle', color: COLORS.idle, initial: true },
  { name: 'origin', label: 'Origin', color: COLORS.origin, statsGroup: 'Nodes', statsOrder: 2 },
  { name: 'announced', label: 'Announced', color: COLORS.announced, statsGroup: 'Nodes', statsOrder: 3 },
  { name: 'requested', label: 'Requested', color: COLORS.requested, statsGroup: 'Nodes', statsOrder: 4 },
  { name: 'validating', label: 'Validating', color: COLORS.validating, statsGroup: 'Nodes', statsOrder: 5 },
  { name: 'delivered', label: 'Delivered', color: COLORS.delivered, terminal: true, statsGroup: 'Nodes', statsOrder: 0 },
  { name: 'rejected', label: 'Rejected', color: COLORS.rejected, terminal: true, statsGroup: 'Nodes', statsOrder: 6 },
  { name: 'dropped', label: 'Dropped', color: COLORS.dropped, terminal: true, statsGroup: 'Nodes', statsOrder: 7 },
]);

const ARC_LAYERS: ArcLayerDef[] = defineArcLayers([
  { name: 'messages', label: 'Messages', color: COLORS.messages, lifetimeUs: 450_000, travelUs: 250_000 },
  { name: 'ihave', label: 'IHAVE', color: COLORS.ihave, lifetimeUs: 160_000, travelUs: 100_000, radius: 0.2 },
  { name: 'iwant', label: 'IWANT', color: COLORS.iwant, lifetimeUs: 180_000, travelUs: 120_000, radius: 0.24 },
]);

const METRICS: MetricDef[] = defineMetrics([
  { name: 'published', label: 'Published', color: COLORS.origin, statsGroup: 'Messages', statsOrder: 0 }, // 0
  { name: 'delivered', label: 'Delivered', color: COLORS.delivered, overlay: 'ring', overlayGroup: 'outcome', overlayLabel: 'Delivered', statsGroup: 'Messages', statsOrder: 1 }, // 1
  { name: 'duplicate', label: 'Duplicate', color: COLORS.duplicate, overlay: 'ring', overlayGroup: 'duplicate', overlayLabel: 'Duplicate', statsGroup: 'Messages', statsOrder: 2 }, // 2
  { name: 'rejected', label: 'Rejected', statsGroup: 'Messages', statsOrder: 3 }, // 3
  { name: 'undeliverable', label: 'Undeliverable', statsGroup: 'Messages', statsOrder: 4 }, // 4
  { name: 'ihave_recv', label: 'IHAVE recv', statsGroup: 'Control', statsOrder: 0 }, // 5
  { name: 'iwant_sent', label: 'IWANT sent', statsGroup: 'Control', statsOrder: 1 }, // 6
  { name: 'idontwant_recv', label: 'IDONTWANT recv', statsGroup: 'Control', statsOrder: 2 }, // 7
  { name: 'bytes_sent', label: 'Bytes sent', format: 'bytes', statsGroup: 'Transfer', statsOrder: 0 }, // 8
  { name: 'messages_sent', label: 'Messages sent', statsGroup: 'Transfer', statsOrder: 1 }, // 9
  { name: 'mesh_peers', label: 'Mesh peers', aggregate: 'last', statsGroup: 'Control', statsOrder: 3 }, // 10
]);

const EVENT_TYPES: EventTypeDef[] = [
  { code: 'pa', name: 'peer added', color: COLORS.validating },
  { code: 'pg', name: 'peer removed', color: COLORS.validating },
  { code: 'tj', name: 'joined channel', color: COLORS.origin },
  { code: 'tl', name: 'left channel', color: COLORS.origin },
  { code: 'mg', name: 'graft', color: COLORS.mesh },
  { code: 'mp', name: 'prune', color: COLORS.mesh },
  { code: 'pb', name: 'publish', color: COLORS.origin },
  { code: 'va', name: 'validate', color: COLORS.validating },
  { code: 'dl', name: 'deliver', color: COLORS.delivered },
  { code: 'du', name: 'duplicate', color: COLORS.duplicate },
  { code: 'rj', name: 'reject', color: COLORS.rejected },
  { code: 'ud', name: 'undeliverable', color: COLORS.dropped },
  { code: 'ms', name: 'message sent', color: COLORS.messages },
  { code: 'hs', name: 'IHAVE sent', color: COLORS.ihave },
  { code: 'hr', name: 'IHAVE recv', color: COLORS.ihave },
  { code: 'ws', name: 'IWANT sent', color: COLORS.iwant },
  { code: 'wr', name: 'IWANT recv', color: COLORS.iwant },
  { code: 'ns', name: 'IDONTWANT sent', color: COLORS.mesh },
  { code: 'nr', name: 'IDONTWANT recv', color: COLORS.mesh },
];
const EVENT_TYPE_INDEX = new Map(EVENT_TYPES.map((eventType, index) => [eventType.code, index]));

const S_IDLE = 0;
const S_ORIGIN = 1;
const S_ANNOUNCED = 2;
const S_REQUESTED = 3;
const S_VALIDATING = 4;
const S_DELIVERED = 5;
const S_REJECTED = 6;
const S_DROPPED = 7;

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
  t0?: string;
  nodes: string[];
  topology: TraceTopology | [number, number][];
  config?: Record<string, unknown>;
  peer_ids?: string[];
}

interface MessageScan {
  firstTs: number;
  lastTs: number;
  deliveries: number;
  duplicates: number;
  ihaves: number;
  iwants: number;
}

const PEER_FIELD_CODES = new Set([
  'pa', 'pg', 'mg', 'mp',
  'va', 'dl', 'du', 'rj',
  'ms', 'hs', 'hr', 'ws', 'wr', 'ns', 'nr',
]);

function addNodeAliases(peerToIdx: Map<string, number>, nodeNames: string[]): void {
  for (let i = 0; i < nodeNames.length; i++) {
    const name = nodeNames[i];
    peerToIdx.set(name, i);
    if (name.startsWith('n')) {
      const bare = name.slice(1);
      if (/^\d+$/.test(bare)) peerToIdx.set(bare, i);
    }
  }
}

function buildNeighborSets(edges: EdgeSpec[], nodeCount: number): Array<Set<number>> {
  const neighbors = Array.from({ length: nodeCount }, () => new Set<number>());
  for (const edge of edges) {
    neighbors[edge.source].add(edge.target);
    neighbors[edge.target].add(edge.source);
  }
  return neighbors;
}

function inferPeerMappings(
  eventLines: string[],
  nodeCount: number,
  edges: EdgeSpec[],
  peerToIdx: Map<string, number>,
  fixedNodeIdxs: Set<number>,
): void {
  const neighbors = buildNeighborSets(edges, nodeCount);
  const candidates = new Map<string, Set<number>>();

  for (const line of eventLines) {
    if (!line) continue;
    let ev: unknown[];
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (!Array.isArray(ev) || ev.length < 4) continue;

    const nodeIdx = ev[1];
    const code = ev[2];
    const peer = ev[3];
    if (typeof nodeIdx !== 'number' || nodeIdx < 0 || nodeIdx >= nodeCount) continue;
    if (typeof code !== 'string' || !PEER_FIELD_CODES.has(code)) continue;
    if (typeof peer !== 'string' || peer.length === 0 || peerToIdx.has(peer)) continue;

    const possible = new Set<number>(neighbors[nodeIdx]);
    possible.delete(nodeIdx);
    if (possible.size === 0) continue;

    const prev = candidates.get(peer);
    if (!prev) {
      candidates.set(peer, possible);
      continue;
    }
    for (const candidate of Array.from(prev)) {
      if (!possible.has(candidate)) prev.delete(candidate);
    }
  }

  for (const set of candidates.values()) {
    for (const idx of fixedNodeIdxs) set.delete(idx);
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const [peer, set] of candidates) {
      if (set.size !== 1 || peerToIdx.has(peer)) continue;
      const [idx] = Array.from(set);
      peerToIdx.set(peer, idx);
      fixedNodeIdxs.add(idx);
      for (const [otherPeer, otherSet] of candidates) {
        if (otherPeer !== peer && otherSet.delete(idx)) changed = true;
      }
      changed = true;
    }

    const ownerByNode = new Map<number, string[]>();
    for (const [peer, set] of candidates) {
      if (peerToIdx.has(peer)) continue;
      for (const idx of set) {
        const owners = ownerByNode.get(idx) ?? [];
        owners.push(peer);
        ownerByNode.set(idx, owners);
      }
    }
    for (const [idx, owners] of ownerByNode) {
      if (owners.length !== 1) continue;
      const peer = owners[0];
      if (peerToIdx.has(peer)) continue;
      peerToIdx.set(peer, idx);
      fixedNodeIdxs.add(idx);
      for (const [otherPeer, otherSet] of candidates) {
        if (otherPeer !== peer && otherSet.delete(idx)) changed = true;
      }
      changed = true;
    }
  }
}

function parseHeader(raw: Record<string, unknown>): {
  canonical: CanonicalHeader;
  peerToIdx: Map<string, number>;
  nodeNames: string[];
  fixedNodeIdxs: Set<number>;
} {
  const hdr = raw as unknown as RawHeader;
  if (hdr.v !== 1) throw new Error('Unsupported trace version: ' + hdr.v);

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

  const nodeNames = hdr.nodes;
  const peerToIdx = new Map<string, number>();
  const fixedNodeIdxs = new Set<number>();
  addNodeAliases(peerToIdx, nodeNames);
  for (let i = 0; i < nodeNames.length; i++) {
    const peerId = hdr.peer_ids?.[i];
    if (peerId) {
      peerToIdx.set(peerId, i);
      fixedNodeIdxs.add(i);
    }
  }

  const topoNodeByNum = new Map<number, TopoNodeSpec>();
  for (const tn of topo.nodes) topoNodeByNum.set(tn.num, tn);

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
    latency: e.latency_ms * 1000,
  }));

  const meta: Record<string, unknown> = {};
  if (hdr.t0) meta['t0'] = hdr.t0;
  if (hdr.config) meta['config'] = hdr.config;

  return {
    canonical: createHeader(nodes, edges, meta),
    peerToIdx,
    nodeNames,
    fixedNodeIdxs,
  };
}

export function buildGossipsubPreview(rawHeader: Record<string, unknown>): DecoderOutput {
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
      cdf: { stateIdx: S_DELIVERED },
      race: { stateIdx: S_DELIVERED },
      bandwidth: { arcLayer: 0 },
    },
    messages: [],
  };
}

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
      msgMap.set(msgId, { firstTs: ts, lastTs: ts, deliveries: 0, duplicates: 0, ihaves: 0, iwants: 0 });
    } else {
      if (ts < m.firstTs) m.firstTs = ts;
      if (ts > m.lastTs) m.lastTs = ts;
    }
    const scan = msgMap.get(msgId)!;
    if (type === 'dl') scan.deliveries++;
    if (type === 'du') scan.duplicates++;
    if (type === 'hs' || type === 'hr') scan.ihaves++;
    if (type === 'ws' || type === 'wr') scan.iwants++;
  }

  const messages: MessageInfo[] = [];
  for (const [id, m] of msgMap) {
    const durationMs = Math.round((m.lastTs - m.firstTs) / 1000);
    messages.push({
      id,
      firstTs: m.firstTs,
      lastTs: m.lastTs,
      label: `${id} - ${durationMs}ms, ${m.deliveries} deliveries, ${m.duplicates} duplicates, ${m.ihaves} IHAVEs, ${m.iwants} IWANTs`,
    });
  }
  messages.sort((a, b) => a.firstTs - b.firstTs);
  return messages;
}

function selectAndMapEvents(
  eventLines: string[],
  selectedMsg: MessageInfo | undefined,
  peerToIdx: Map<string, number>,
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
  const nodeState = new Uint8Array(nodeCount);
  const meshPeers = new Uint16Array(nodeCount);

  let publishTs = -1;
  let firstIHave = -1;
  let firstIWant = -1;
  let originNodeIdx = -1;
  const firstDeliveryPerNode = new Map<number, number>();

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

  function setState(ts: number, nodeIdx: number, stateIdx: number): void {
    if (nodeState[nodeIdx] === stateIdx) return;
    writeHiddenState(ts, nodeIdx, stateIdx);
    nodeState[nodeIdx] = stateIdx;
  }

  for (const ev of selectedEvents) {
    const ts = ev[0] as number;
    const nodeIdx = ev[1] as number;
    const code = ev[2] as string;

    switch (code) {
      case 'pb': {
        const channel = ev[3] as string;
        const msgId = ev[4] as string;
        const bytes = (ev[5] as number) || 0;
        writeHiddenMetric(ts, nodeIdx, 0, 1);
        setState(ts, nodeIdx, S_ORIGIN);
        if (publishTs < 0) publishTs = ts;
        if (originNodeIdx < 0) originNodeIdx = nodeIdx;
        writeVisible(ts, nodeIdx, 'pb', `${channel}:${msgId} ${bytes}B`);
        break;
      }

      case 'ms': {
        const peer = ev[3] as string;
        const channel = ev[4] as string;
        const msgId = ev[5] as string;
        const bytes = (ev[6] as number) || 0;
        const peerIdx = peerToIdx.get(peer);
        if (peerIdx !== undefined) writeHiddenTransfer(ts, nodeIdx, peerIdx, bytes, 0);
        writeHiddenMetric(ts, nodeIdx, 8, bytes);
        writeHiddenMetric(ts, nodeIdx, 9, 1);
        writeVisible(ts, nodeIdx, 'ms', `peer=${peer} ${channel}:${msgId} ${bytes}B`, peerIdx ?? -1);
        break;
      }

      case 'hs': {
        const peer = ev[3] as string;
        const channel = ev[4] as string;
        const msgId = ev[5] as string;
        const count = (ev[6] as number) || 0;
        const peerIdx = peerToIdx.get(peer);
        if (peerIdx !== undefined) writeHiddenTransfer(ts, nodeIdx, peerIdx, Math.max(1, count), 1);
        if (firstIHave < 0) firstIHave = ts;
        writeVisible(ts, nodeIdx, 'hs', `peer=${peer} ${channel}:${msgId} x${count}`, peerIdx ?? -1);
        break;
      }

      case 'hr': {
        const peer = ev[3] as string;
        const channel = ev[4] as string;
        const msgId = ev[5] as string;
        const count = (ev[6] as number) || 0;
        writeHiddenMetric(ts, nodeIdx, 5, 1);
        if (nodeState[nodeIdx] === S_IDLE) setState(ts, nodeIdx, S_ANNOUNCED);
        if (firstIHave < 0) firstIHave = ts;
        writeVisible(ts, nodeIdx, 'hr', `peer=${peer} ${channel}:${msgId} x${count}`, peerToIdx.get(peer) ?? -1);
        break;
      }

      case 'ws': {
        const peer = ev[3] as string;
        const channel = ev[4] as string;
        const msgId = ev[5] as string;
        const count = (ev[6] as number) || 0;
        const peerIdx = peerToIdx.get(peer);
        if (peerIdx !== undefined) writeHiddenTransfer(ts, nodeIdx, peerIdx, Math.max(1, count), 2);
        writeHiddenMetric(ts, nodeIdx, 6, 1);
        if (nodeState[nodeIdx] === S_IDLE || nodeState[nodeIdx] === S_ANNOUNCED) setState(ts, nodeIdx, S_REQUESTED);
        if (firstIWant < 0) firstIWant = ts;
        writeVisible(ts, nodeIdx, 'ws', `peer=${peer} ${channel}:${msgId} x${count}`, peerIdx ?? -1);
        break;
      }

      case 'wr': {
        const peer = ev[3] as string;
        const channel = ev[4] as string;
        const msgId = ev[5] as string;
        const count = (ev[6] as number) || 0;
        if (firstIWant < 0) firstIWant = ts;
        writeVisible(ts, nodeIdx, 'wr', `peer=${peer} ${channel}:${msgId} x${count}`, peerToIdx.get(peer) ?? -1);
        break;
      }

      case 'ns': {
        const peer = ev[3] as string;
        const channel = ev[4] as string;
        const msgId = ev[5] as string;
        const count = (ev[6] as number) || 0;
        writeVisible(ts, nodeIdx, 'ns', `peer=${peer} ${channel}:${msgId} x${count}`, peerToIdx.get(peer) ?? -1);
        break;
      }

      case 'nr': {
        const peer = ev[3] as string;
        const channel = ev[4] as string;
        const msgId = ev[5] as string;
        const count = (ev[6] as number) || 0;
        writeHiddenMetric(ts, nodeIdx, 7, 1);
        writeVisible(ts, nodeIdx, 'nr', `peer=${peer} ${channel}:${msgId} x${count}`, peerToIdx.get(peer) ?? -1);
        break;
      }

      case 'va': {
        const peer = ev[3] as string;
        const channel = ev[4] as string;
        const msgId = ev[5] as string;
        setState(ts, nodeIdx, S_VALIDATING);
        writeVisible(ts, nodeIdx, 'va', `peer=${peer} ${channel}:${msgId}`, peerToIdx.get(peer) ?? -1);
        break;
      }

      case 'dl': {
        const peer = ev[3] as string;
        const channel = ev[4] as string;
        const msgId = ev[5] as string;
        writeHiddenMetric(ts, nodeIdx, 1, 1);
        setState(ts, nodeIdx, S_DELIVERED);
        if (!firstDeliveryPerNode.has(nodeIdx)) firstDeliveryPerNode.set(nodeIdx, ts);
        writeVisible(ts, nodeIdx, 'dl', `peer=${peer} ${channel}:${msgId}`, peerToIdx.get(peer) ?? -1);
        break;
      }

      case 'du': {
        const peer = ev[3] as string;
        const channel = ev[4] as string;
        const msgId = ev[5] as string;
        writeHiddenMetric(ts, nodeIdx, 2, 1);
        writeVisible(ts, nodeIdx, 'du', `peer=${peer} ${channel}:${msgId}`, peerToIdx.get(peer) ?? -1);
        break;
      }

      case 'rj': {
        const peer = ev[3] as string;
        const channel = ev[4] as string;
        const msgId = ev[5] as string;
        const reason = ev[6] as string;
        writeHiddenMetric(ts, nodeIdx, 3, 1);
        setState(ts, nodeIdx, S_REJECTED);
        writeVisible(ts, nodeIdx, 'rj', `peer=${peer} ${channel}:${msgId} ${reason}`, peerToIdx.get(peer) ?? -1);
        break;
      }

      case 'ud': {
        const channel = ev[3] as string;
        const msgId = ev[4] as string;
        writeHiddenMetric(ts, nodeIdx, 4, 1);
        setState(ts, nodeIdx, S_DROPPED);
        writeVisible(ts, nodeIdx, 'ud', `${channel}:${msgId}`);
        break;
      }

      case 'mg': {
        const peer = ev[3] as string;
        const channel = ev[4] as string;
        const peerIdx = peerToIdx.get(peer);
        if (peerIdx !== undefined) writeHiddenLink(ts, nodeIdx, peerIdx, 1);
        meshPeers[nodeIdx]++;
        writeHiddenMetric(ts, nodeIdx, 10, meshPeers[nodeIdx]);
        writeVisible(ts, nodeIdx, 'mg', `peer=${peer} channel=${channel}`, peerIdx ?? -1);
        break;
      }

      case 'mp': {
        const peer = ev[3] as string;
        const channel = ev[4] as string;
        const peerIdx = peerToIdx.get(peer);
        if (peerIdx !== undefined) writeHiddenLink(ts, nodeIdx, peerIdx, 0);
        if (meshPeers[nodeIdx] > 0) meshPeers[nodeIdx]--;
        writeHiddenMetric(ts, nodeIdx, 10, meshPeers[nodeIdx]);
        writeVisible(ts, nodeIdx, 'mp', `peer=${peer} channel=${channel}`, peerIdx ?? -1);
        break;
      }

      case 'pa': {
        const peer = ev[3] as string;
        const proto = ev[4] as string;
        writeVisible(ts, nodeIdx, 'pa', `peer=${peer} proto=${proto}`, peerToIdx.get(peer) ?? -1);
        break;
      }

      case 'pg': {
        const peer = ev[3] as string;
        writeVisible(ts, nodeIdx, 'pg', `peer=${peer}`, peerToIdx.get(peer) ?? -1);
        break;
      }

      case 'tj': {
        writeVisible(ts, nodeIdx, 'tj', `channel=${ev[3] as string}`);
        break;
      }

      case 'tl': {
        writeVisible(ts, nodeIdx, 'tl', `channel=${ev[3] as string}`);
        break;
      }
    }
  }

  const milestones: Milestone[] = [];
  if (publishTs >= 0) milestones.push(milestone(publishTs, 'Publish', COLORS.origin));
  if (firstIHave >= 0) milestones.push(milestone(firstIHave, '1st IHAVE', COLORS.ihave));
  if (firstIWant >= 0) milestones.push(milestone(firstIWant, '1st IWANT', COLORS.iwant));

  const deliveryTimes = Array.from(firstDeliveryPerNode.values()).sort((a, b) => a - b);
  if (deliveryTimes.length > 0) {
    const first = deliveryTimes[0];
    const firstNodeIdx = Array.from(firstDeliveryPerNode.entries()).find(([, t]) => t === first)?.[0];
    const firstNodeName = firstNodeIdx !== undefined ? nodeNames[firstNodeIdx] : '?';
    milestones.push(milestone(first, `1st delivery (${firstNodeName})`, COLORS.delivered));

    const pctMilestones = percentileMilestones(deliveryTimes, 'delivery', COLORS.delivered);
    for (const m of pctMilestones) {
      if (m.time !== first) milestones.push(m);
    }

    const last = deliveryTimes[deliveryTimes.length - 1];
    if (last !== first) {
      const lastNodeIdx = Array.from(firstDeliveryPerNode.entries()).find(([, t]) => t === last)?.[0];
      const lastNodeName = lastNodeIdx !== undefined ? nodeNames[lastNodeIdx] : '?';
      milestones.push(milestone(last, `Last delivery (${lastNodeName})`, COLORS.delivered));
    }
  }
  milestones.sort((a, b) => a.time - b.time);

  const events = w.finish();
  events.eventTypeIdxs = Int16Array.from(eventTypeIdxs);
  events.peerNodeIdxs = Int32Array.from(peerNodeIdxs);
  return { events, milestones, originNodeIdx };
}

function decode(lines: string[], options?: DecodeOptions): DecoderOutput {
  const { header: rawHeader, eventLines } = parseNdjson(lines);
  const { canonical, peerToIdx, nodeNames, fixedNodeIdxs } = parseHeader(rawHeader);
  inferPeerMappings(eventLines, canonical.nodes.length, canonical.edges, peerToIdx, fixedNodeIdxs);

  const messages = scanMessages(eventLines);
  const selectedMsgId = options?.messageId ?? messages[0]?.id;
  const selectedMsg = selectedMsgId
    ? messages.find(m => m.id === selectedMsgId)
    : undefined;

  const { events, milestones, originNodeIdx } = selectAndMapEvents(
    eventLines, selectedMsg, peerToIdx, nodeNames, canonical.nodes.length,
  );

  const chartHints: ChartHints = {
    cdf: { stateIdx: S_DELIVERED },
    race: { stateIdx: S_DELIVERED },
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
    milestones,
    chartHints,
    messages,
  };
}

export const gossipsubDecoder: Decoder = {
  name: 'gossipsub',
  version: '0.1.0',
  decode,
};
