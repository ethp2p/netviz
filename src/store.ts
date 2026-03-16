import type { DecoderOutput, EventFilter } from './decoder-sdk';
import type { RGBA } from './decoder-sdk';
import type { LayoutMode, GraphSettings } from './types';
import type { IncrementalState } from './state';
import type { EventIndex } from './trace';
import type { TopologyGraph } from './graph/topology';
import type { NodeMetadata } from './graph/node-metadata';
import type { ChartControls } from './charts/render';
import type { HoverHighlight } from './map/overlay';

export interface OriginalDecoderColors {
  stateColors: RGBA[];
  arcLayerColors: RGBA[];
  metricColors: (RGBA | undefined)[];
  milestoneColors: RGBA[];
  eventTypeColors: (RGBA | undefined)[];
}

export interface AppStore {
  decoderOutput: DecoderOutput | null;
  originalColors: OriginalDecoderColors | null;
  eventBuf: Float64Array | null;
  logTexts: string[];
  eventCount: number;
  overlayMaxes: number[][];
  nodeColors: RGBA[];
  decodedStateIdx: number;
  timeIndex: number[];
  topoGraph: TopologyGraph | null;
  eventIndex: EventIndex | null;
  incState: IncrementalState | null;
  nodePositions: [number, number][];
  nodeMeta: NodeMetadata | null;
  layoutMode: LayoutMode;
  originNode: number;
  playing: boolean;
  currentTime: number;
  speed: number;
  timeOffset: number;
  selectedNode: number;
  hoveredNode: number;
  hoverHighlight: HoverHighlight | null;
  nodeClickHandled: boolean;
  graphSettings: GraphSettings;
  enabledArcLayers: boolean[];
  eventFilter: EventFilter;
  chartControls: ChartControls | null;
  previewingLoad: boolean;
}

export function createStore(): AppStore {
  return {
    decoderOutput: null,
    originalColors: null,
    eventBuf: null,
    logTexts: [],
    eventCount: 0,
    overlayMaxes: [],
    nodeColors: [],
    decodedStateIdx: -1,
    timeIndex: [],
    topoGraph: null,
    eventIndex: null,
    incState: null,
    nodePositions: [],
    nodeMeta: null,
    layoutMode: 'force',
    originNode: -1,
    playing: false,
    currentTime: 0,
    speed: 1,
    timeOffset: 0,
    selectedNode: -1,
    hoveredNode: -1,
    hoverHighlight: null,
    nodeClickHandled: false,
    graphSettings: { ringToggles: [] },
    enabledArcLayers: [],
    eventFilter: { opcodes: new Set(), arcLayers: new Set(), metrics: new Set(), eventTypes: new Set() },
    chartControls: null,
    previewingLoad: false,
  };
}
