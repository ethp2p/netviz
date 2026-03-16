export type RGBA = [number, number, number, number];

export interface NodeSpec {
  name: string;
  props: Record<string, number | string>;
}

export interface EdgeSpec {
  source: number;
  target: number;
  latency: number; // microseconds, 0 if unknown
}

export interface CanonicalHeader {
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  meta: Record<string, unknown>;
}

export interface StateDef {
  name: string;
  label?: string;
  color: RGBA;
  terminal: boolean;
  initial?: boolean;
  statsGroup?: string;
  statsOrder?: number;
}

export interface ArcLayerDef {
  name: string;
  label?: string;
  color: RGBA;
  lifetimeUs: number;
  travelUs: number;
  radius: number;
}

export interface MetricDef {
  name: string;
  label?: string;
  color?: RGBA;
  format: 'count' | 'bytes' | 'rate';
  aggregate: 'sum' | 'last';
  overlay?: 'ring';
  overlayGroup?: string;
  overlayLabel?: string;
  statsGroup?: string;
  statsOrder?: number;
  kind?: 'nodeCount';
}

export interface ChartHints {
  cdf?: { stateIdx: number };
  bandwidth?: { arcLayer: number; originNode?: number };
  race?: { stateIdx: number };
  series?: CustomSeries[];
}

export interface CustomSeries {
  name: string;
  metricIdx: number;
  percentiles: boolean;
}

export interface Milestone {
  time: number;
  label: string;
  color: RGBA;
}

export interface PackedEvents {
  buf: Float64Array;
  logTexts: string[];
  count: number;
  eventTypeIdxs?: Int16Array;
  peerNodeIdxs?: Int32Array;
}

export interface MessageInfo {
  id: string;
  firstTs: number;
  lastTs: number;
  label: string;
}

export interface EventTypeDef {
  code: string;
  name: string;
  color?: RGBA;
}

export interface DecoderOutput {
  header: CanonicalHeader;
  events: PackedEvents;
  states: StateDef[];
  arcLayers: ArcLayerDef[];
  metrics: MetricDef[];
  eventTypes?: EventTypeDef[];
  milestones: Milestone[];
  chartHints: ChartHints;
  messages?: MessageInfo[];
}

export interface DecodeOptions {
  messageId?: string;
}

export interface Decoder {
  name: string;
  version: string;
  decode(lines: string[], options?: DecodeOptions): DecoderOutput;
}

export interface EventFilter {
  opcodes: Set<number>;
  arcLayers: Set<number>;
  metrics: Set<number>;
  eventTypes: Set<number>;
}

// Opcode constants
export const OP_STATE = 0;
export const OP_TRANSFER = 1;
export const OP_PROGRESS = 2;
export const OP_METRIC = 3;
export const OP_LINK = 4;
export const OP_LOG = 5;

// Event record stride (6 float64s per event)
export const EVENT_STRIDE = 6;
