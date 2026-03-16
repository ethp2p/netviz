export type LayoutMode = 'force' | 'hops' | 'latency' | 'race' | 'force3d';
export type Position3D = [number, number, number];

export interface NodeData {
  state: number;           // index into DecoderOutput.states
  lastChunkTime: number;
  chunksHave: number;
  chunksNeed: number;
  metrics: number[];       // one slot per MetricDef
}

export interface GraphSettings {
  ringToggles: boolean[];  // one per visual ring group
}

export interface GlobalStats {
  metrics: number[];       // one per MetricDef, aggregated per MetricDef.aggregate
}

export interface ActiveArc {
  from: number;
  to: number;
  startTime: number;
  bytes: number;
  layer: number;           // index into DecoderOutput.arcLayers
}

export { P, PULSE_RING_DURATION_US } from './palette';
