import type { CanonicalHeader } from '../decoder-sdk';
import { EVENT_STRIDE, OP_TRANSFER } from '../decoder-sdk';
import type { TopologyGraph } from './topology';
import { bfsHops, dijkstraLatency } from './algorithms';

export interface NodeMetadata {
  hops: Int32Array;
  latencyMs: Float64Array;
  bwSamples: number;
  bwTimeMin: number;
  bwTimeMax: number;
  bwUp: Float64Array[];   // per-node upload bytes per bucket
  bwDown: Float64Array[]; // per-node download bytes per bucket
}

const BW_BUCKETS = 60;

export function computeNodeMetadata(
  header: CanonicalHeader,
  buf: Float64Array,
  count: number,
  originNode: number,
  graph: TopologyGraph,
): NodeMetadata {
  const n = header.nodes.length;

  const hops = bfsHops(graph.adj, originNode, n);
  const latencyMs = dijkstraLatency(graph.adjW, originNode, n);

  const empty: NodeMetadata = {
    hops, latencyMs,
    bwSamples: 0, bwTimeMin: 0, bwTimeMax: 0,
    bwUp: Array.from({ length: n }, () => new Float64Array(0)),
    bwDown: Array.from({ length: n }, () => new Float64Array(0)),
  };
  if (count === 0) return empty;

  const tMin = buf[0];
  const tMax = buf[(count - 1) * EVENT_STRIDE];
  if (tMax <= tMin) return empty;

  const dt = (tMax - tMin) / BW_BUCKETS;
  const bwUp: Float64Array[] = Array.from({ length: n }, () => new Float64Array(BW_BUCKETS));
  const bwDown: Float64Array[] = Array.from({ length: n }, () => new Float64Array(BW_BUCKETS));

  for (let i = 0; i < count; i++) {
    const base = i * EVENT_STRIDE;
    if (buf[base + 2] !== OP_TRANSFER) continue;
    const ts     = buf[base];
    const sender = buf[base + 1];
    const bytes  = buf[base + 4];
    const bucket = Math.min(BW_BUCKETS - 1, Math.floor((ts - tMin) / dt));
    bwUp[sender][bucket] += bytes;
    const receiver = buf[base + 3];
    if (receiver >= 0 && receiver < n) bwDown[receiver][bucket] += bytes;
  }

  return { hops, latencyMs, bwSamples: BW_BUCKETS, bwTimeMin: tMin, bwTimeMax: tMax, bwUp, bwDown };
}
