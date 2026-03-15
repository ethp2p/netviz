import type { NodeData, ActiveArc, GlobalStats } from './types';
import type { ArcLayerDef, MetricDef } from './decoder-sdk';
import { OP_STATE, OP_TRANSFER, OP_PROGRESS, OP_METRIC, OP_LINK, EVENT_STRIDE } from './decoder-sdk';

function createNodeStates(count: number, metricCount: number): NodeData[] {
  const states = new Array<NodeData>(count);
  for (let i = 0; i < count; i++) {
    states[i] = {
      state: 0,
      lastChunkTime: 0,
      chunksHave: 0,
      chunksNeed: 0,
      metrics: new Array(metricCount).fill(0),
    };
  }
  return states;
}

function applyEvent(
  buf: Float64Array,
  i: number,
  nodeStates: NodeData[],
  arcBuckets: ActiveArc[][] | null,
  globalStats: GlobalStats,
  currentT: number,
  arcLayers: ArcLayerDef[],
  enabledArcLayers: boolean[],
  metricDefs: MetricDef[],
  overlayMaxes: number[][],
): void {
  const base = i * EVENT_STRIDE;
  const ts   = buf[base];
  const node = buf[base + 1];
  const op   = buf[base + 2];
  const ns = nodeStates[node];
  if (!ns) return;

  switch (op) {
    case OP_STATE: {
      ns.state = buf[base + 3];
      ns.lastChunkTime = ts;
      break;
    }
    case OP_TRANSFER: {
      const peer  = buf[base + 3];
      const bytes = buf[base + 4];
      const layer = buf[base + 5];
      if (arcBuckets && enabledArcLayers[layer]) {
        const bucket = arcBuckets[layer];
        if (bucket) {
          const def = arcLayers[layer];
          const age = currentT - ts;
          if (age < def.lifetimeUs) {
            bucket.push({ from: node, to: peer, startTime: ts, bytes, layer });
          }
        }
      }
      break;
    }
    case OP_PROGRESS: {
      ns.chunksHave = buf[base + 3];
      ns.chunksNeed = buf[base + 4];
      break;
    }
    case OP_METRIC: {
      const metricIdx = buf[base + 3];
      const value     = buf[base + 4];
      const def = metricDefs[metricIdx];
      if (def.aggregate === 'last') {
        ns.metrics[metricIdx] = value;
        globalStats.metrics[metricIdx] = value;
      } else {
        ns.metrics[metricIdx] += value;
        globalStats.metrics[metricIdx] += value;
      }
      if (def.overlay === 'ring') {
        const cur = ns.metrics[metricIdx];
        if (cur > overlayMaxes[metricIdx][node]) {
          overlayMaxes[metricIdx][node] = cur;
        }
      }
      break;
    }
    case OP_LINK: {
      // Link events carry topology edges, not node state — nothing to animate.
      break;
    }
  }
}

interface Checkpoint {
  eventIdx: number;
  time: number;
  nodeStates: NodeData[];
  globalStats: GlobalStats;
}

const CHECKPOINT_INTERVAL = 5000;
const MAX_CHECKPOINTS = 50;

export interface IncrementalState {
  nodeStates: NodeData[];
  arcBuckets: ActiveArc[][];  // one per arc layer
  globalStats: GlobalStats;
  lastComputedIdx: number;
  checkpoints: Checkpoint[];
  eventsSinceCheckpoint: number;
}

export function createIncrementalState(nodeCount: number, metricCount: number, arcLayerCount: number): IncrementalState {
  const arcBuckets: ActiveArc[][] = [];
  for (let i = 0; i < arcLayerCount; i++) arcBuckets.push([]);
  return {
    nodeStates: createNodeStates(nodeCount, metricCount),
    arcBuckets,
    globalStats: { metrics: new Array(metricCount).fill(0) },
    lastComputedIdx: -1,
    checkpoints: [],
    eventsSinceCheckpoint: 0,
  };
}

export function resetIncrementalState(state: IncrementalState, nodeCount: number, metricCount: number, arcLayerCount: number): void {
  state.nodeStates = createNodeStates(nodeCount, metricCount);
  state.arcBuckets = [];
  for (let i = 0; i < arcLayerCount; i++) state.arcBuckets.push([]);
  state.globalStats = { metrics: new Array(metricCount).fill(0) };
  state.lastComputedIdx = -1;
  state.checkpoints = [];
  state.eventsSinceCheckpoint = 0;
}

function deepCloneNodeStates(states: NodeData[]): NodeData[] {
  const out = new Array<NodeData>(states.length);
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    out[i] = {
      state: s.state,
      lastChunkTime: s.lastChunkTime,
      chunksHave: s.chunksHave,
      chunksNeed: s.chunksNeed,
      metrics: s.metrics.slice(),
    };
  }
  return out;
}

function deepCloneStats(stats: GlobalStats): GlobalStats {
  return { metrics: stats.metrics.slice() };
}

function saveCheckpoint(state: IncrementalState, time: number): void {
  const cp: Checkpoint = {
    eventIdx: state.lastComputedIdx,
    time,
    nodeStates: deepCloneNodeStates(state.nodeStates),
    globalStats: deepCloneStats(state.globalStats),
  };
  if (state.checkpoints.length >= MAX_CHECKPOINTS) {
    state.checkpoints.shift();
  }
  state.checkpoints.push(cp);
}

export function restoreCheckpoint(state: IncrementalState, targetIdx: number): boolean {
  let best: Checkpoint | null = null;
  for (let i = state.checkpoints.length - 1; i >= 0; i--) {
    if (state.checkpoints[i].eventIdx <= targetIdx) {
      best = state.checkpoints[i];
      break;
    }
  }
  if (!best) return false;

  state.nodeStates = deepCloneNodeStates(best.nodeStates);
  state.globalStats = deepCloneStats(best.globalStats);
  for (let i = 0; i < state.arcBuckets.length; i++) state.arcBuckets[i] = [];
  state.lastComputedIdx = best.eventIdx;
  const cutoff = state.checkpoints.indexOf(best);
  // Drop checkpoints beyond the restore point so replay stays consistent.
  state.checkpoints.length = cutoff + 1;
  state.eventsSinceCheckpoint = 0;
  return true;
}

export function advanceStateTo(
  state: IncrementalState,
  t: number,
  endIdx: number,
  buf: Float64Array,
  arcLayers: ArcLayerDef[],
  enabledArcLayers: boolean[],
  metricDefs: MetricDef[],
  overlayMaxes: number[][],
): void {
  if (endIdx <= state.lastComputedIdx) return;

  // Prune expired arcs per layer
  for (let layer = 0; layer < arcLayers.length; layer++) {
    if (enabledArcLayers[layer]) {
      state.arcBuckets[layer] = state.arcBuckets[layer].filter(
        a => t - a.startTime < arcLayers[layer].lifetimeUs
      );
    } else {
      state.arcBuckets[layer].length = 0;
    }
  }

  const startFrom = state.lastComputedIdx + 1;
  for (let i = startFrom; i < endIdx; i++) {
    applyEvent(
      buf,
      i,
      state.nodeStates,
      state.arcBuckets,
      state.globalStats,
      t,
      arcLayers,
      enabledArcLayers,
      metricDefs,
      overlayMaxes,
    );
    state.eventsSinceCheckpoint++;
    if (state.eventsSinceCheckpoint >= CHECKPOINT_INTERVAL) {
      state.lastComputedIdx = i;
      saveCheckpoint(state, buf[i * EVENT_STRIDE]);
      state.eventsSinceCheckpoint = 0;
    }
  }
  state.lastComputedIdx = endIdx - 1;
}
