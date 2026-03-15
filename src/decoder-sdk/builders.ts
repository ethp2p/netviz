import type { CanonicalHeader, NodeSpec, EdgeSpec, StateDef, ArcLayerDef, MetricDef, RGBA } from './types';

const MAX_SLOTS = 16;

function assertBound(arr: unknown[], label: string): void {
  if (arr.length > MAX_SLOTS) throw new Error(label + ': max ' + MAX_SLOTS + ', got ' + arr.length);
}

export function createHeader(
  nodes: NodeSpec[],
  edges: EdgeSpec[],
  meta: Record<string, unknown> = {},
): CanonicalHeader {
  return { nodes, edges, meta };
}


export function defineStates(defs: Array<{
  name: string;
  label?: string;
  color: RGBA;
  terminal?: boolean;
  initial?: boolean;
  statsGroup?: string;
  statsOrder?: number;
}>): StateDef[] {
  assertBound(defs, 'states');
  return Object.freeze(defs.map(d => ({
    name: d.name,
    label: d.label,
    color: d.color,
    terminal: d.terminal ?? false,
    initial: d.initial,
    statsGroup: d.statsGroup,
    statsOrder: d.statsOrder,
  }))) as StateDef[];
}

export function defineArcLayers(defs: Array<{
  name: string;
  label?: string;
  color: RGBA;
  lifetimeUs: number;
  travelUs: number;
  radius?: number;
}>): ArcLayerDef[] {
  assertBound(defs, 'arcLayers');
  return Object.freeze(defs.map(d => ({
    name: d.name,
    label: d.label,
    color: d.color,
    lifetimeUs: d.lifetimeUs,
    travelUs: d.travelUs,
    radius: d.radius ?? 0.3,
  }))) as ArcLayerDef[];
}

export function defineMetrics(defs: Array<{
  name: string;
  label?: string;
  color?: RGBA;
  format?: 'count' | 'bytes' | 'rate';
  aggregate?: 'sum' | 'last';
  overlay?: 'ring';
  overlayGroup?: string;
  overlayLabel?: string;
  statsGroup?: string;
  statsOrder?: number;
  kind?: 'nodeCount';
}>): MetricDef[] {
  assertBound(defs, 'metrics');
  return Object.freeze(defs.map(d => ({
    name: d.name,
    label: d.label,
    color: d.color,
    format: d.format ?? 'count',
    aggregate: d.aggregate ?? 'sum',
    overlay: d.overlay,
    overlayGroup: d.overlayGroup,
    overlayLabel: d.overlayLabel,
    statsGroup: d.statsGroup,
    statsOrder: d.statsOrder,
    kind: d.kind,
  }))) as MetricDef[];
}
