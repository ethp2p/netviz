import { Deck, OrthographicView, OrbitView } from '@deck.gl/core';
import type { OrthographicViewState } from '@deck.gl/core';
import { ScatterplotLayer, LineLayer } from '@deck.gl/layers';
import type { NodeData, ActiveArc, LayoutMode } from '../types';
import { P, PULSE_RING_DURATION_US } from '../types';
import { chrome } from '../theme';
import type { CanonicalHeader, ArcLayerDef, RGBA, StateDef, MetricDef } from '../decoder-sdk';
import type { NodeMetadata } from '../graph/node-metadata';
import { renderNodeTooltip } from './tooltip';
import type { NodeLayerDatum } from './tooltip';
import { buildRaceLayers } from './race-layers';

function edgeColor(): [number, number, number, number] {
  return [...chrome.border.rgba.slice(0, 3), 200] as [number, number, number, number];
}
const SELECTION_COLOR: [number, number, number, number] = [255, 255, 255, 255];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let deckgl: Deck<any> | null = null;
let orbiting = false;

export function initDeckGL(canvas: HTMLCanvasElement): Deck {
  deckgl = new Deck({
    canvas,
    views: new OrthographicView({ flipY: false }),
    initialViewState: {
      target: [0, 0, 0],
      zoom: 0,
    } as OrthographicViewState,
    controller: true,
    layers: [],
    getCursor: ({ isHovering }: { isHovering: boolean }) => isHovering ? 'pointer' : 'grab',
  });
  orbiting = false;
  return deckgl;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getDeck(): Deck<any> | null {
  return deckgl;
}

export function setOrbitMode(enable: boolean): void {
  if (!deckgl || enable === orbiting) return;
  orbiting = enable;
  deckgl.setProps({
    views: enable
      ? new OrbitView({ orbitAxis: 'Y' })
      : new OrthographicView({ flipY: false }),
  });
}

export function isOrbitMode(): boolean {
  return orbiting;
}

export function fitViewToNodes(
  container: HTMLElement,
  positions: [number, number][],
): void {
  if (!deckgl || positions.length === 0) return;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of positions) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rangeX = (maxX - minX) || 100;
  const rangeY = (maxY - minY) || 100;

  const containerW = container.clientWidth;
  const containerH = container.clientHeight;
  const padding = 80;

  const zoomX = Math.log2((containerW - padding * 2) / rangeX);
  const zoomY = Math.log2((containerH - padding * 2) / rangeY);
  const zoom = Math.min(zoomX, zoomY);

  if (orbiting) {
    deckgl.setProps({
      initialViewState: {
        target: [cx, cy, 0],
        zoom,
        rotationOrbit: 0,
        rotationX: 30,
        transitionDuration: 500,
      } as Record<string, unknown>,
    });
  } else {
    deckgl.setProps({
      initialViewState: {
        target: [cx, cy, 0],
        zoom,
        transitionDuration: 500,
      } as OrthographicViewState,
    });
  }
}

export function buildLayers(
  header: CanonicalHeader,
  nodePositions: [number, number][],
  nodeStates: NodeData[],
  arcBuckets: ActiveArc[][],      // one per arc layer
  arcLayers: ArcLayerDef[],
  currentTime: number,
  selectedNode: number,
  originNode: number,
  nodeColors: RGBA[],
  originColor: RGBA,
  onNodeClick: (idx: number) => void,
  onNodeHover: (idx: number) => void,
  tooltipEl: HTMLElement,
  mode: LayoutMode,
  meta: NodeMetadata | null,
  hoveredNode: number,
  states: StateDef[],
  metrics: MetricDef[],
): (ScatterplotLayer | LineLayer)[] {
  const n = header.nodes.length;
  const edges = header.edges;
  const nodeRadius = Math.max(3, Math.min(8, 200 / Math.sqrt(n)));

  // For race mode, compute bar metrics for node positioning
  const maxChunksForRace = mode === 'race'
    ? Math.max(1, ...Array.from({ length: n }, (_, i) => nodeStates[i].chunksNeed || 1))
    : 0;
  const raceBarWidth = mode === 'race' ? Math.max(200, maxChunksForRace * 8) : 0;
  const raceLaneWidth = mode === 'race' ? raceBarWidth / maxChunksForRace : 0;

  const nodeData: NodeLayerDatum[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const ns = nodeStates[i];
    // In race mode, position nodes at bar tips for interactive picking
    const pos: [number, number] = mode === 'race'
      ? [ns.chunksHave * raceLaneWidth, nodePositions[i][1]]
      : nodePositions[i];
    const color: [number, number, number, number] = i === originNode
      ? originColor
      : (nodeColors[ns.state] ?? nodeColors[0]);
    nodeData[i] = {
      index: i,
      position: pos,
      color,
      radius: mode === 'race' ? 3 : ((i === selectedNode) ? nodeRadius * 1.5 : nodeRadius),
      state: ns.state,
      name: header.nodes[i].name,
      chunksHave: ns.chunksHave,
      chunksNeed: ns.chunksNeed,
    };
  }

  const edgeData = edges.map(e => ({
    source: nodePositions[e.source],
    target: nodePositions[e.target],
  }));

  // Arc particles: unified across all layers
  const allDots: { position: [number, number]; color: [number, number, number, number]; radius: number }[] = [];
  for (let layer = 0; layer < arcBuckets.length; layer++) {
    const def = arcLayers[layer];
    if (!def) continue;
    const [cR, cG, cB] = def.color;
    for (const arc of arcBuckets[layer]) {
      const age = currentTime - arc.startTime;
      if (age > def.lifetimeUs) continue;
      const progress = age / def.travelUs;
      if (progress < 0 || progress > 1) continue;
      const src = nodePositions[arc.from];
      const tgt = nodePositions[arc.to];
      const ease = 1 - (1 - progress) * (1 - progress);
      allDots.push({
        position: [src[0] + (tgt[0] - src[0]) * ease, src[1] + (tgt[1] - src[1]) * ease],
        color: [cR, cG, cB, Math.floor(180 * (1 - progress * 0.5))],
        radius: nodeRadius * def.radius,
      });
    }
  }

  // Pulse rings: trigger whenever lastChunkTime is recent
  const pulseData: { position: [number, number]; radius: number; color: [number, number, number, number] }[] = [];
  for (let i = 0; i < n; i++) {
    const ns = nodeStates[i];
    const timeSinceChunk = currentTime - ns.lastChunkTime;
    if (ns.lastChunkTime > 0 && timeSinceChunk >= 0 && timeSinceChunk < PULSE_RING_DURATION_US) {
      const pulseAlpha = Math.floor(80 * (1 - timeSinceChunk / PULSE_RING_DURATION_US));
      const c = nodeColors[ns.state] ?? nodeColors[0];
      pulseData.push({
        position: nodePositions[i],
        radius: nodeRadius * 2.5,
        color: [c[0], c[1], c[2], pulseAlpha],
      });
    }
  }

  const selectionData: { position: [number, number]; radius: number }[] = [];
  if (selectedNode >= 0 && selectedNode < n) {
    selectionData.push({
      position: nodePositions[selectedNode],
      radius: nodeRadius * 2,
    });
  }

  const layers: (ScatterplotLayer | LineLayer)[] = [];
  const isRace = mode === 'race';

  if (isRace) {
    layers.push(...buildRaceLayers(n, nodeColors, nodePositions, nodeStates));
  }

  // Build hovered-node peer set for highlighting
  const hoveredPeers = new Set<number>();
  if (hoveredNode >= 0 && !isRace) {
    for (const e of edges) {
      if (e.source === hoveredNode) hoveredPeers.add(e.target);
      if (e.target === hoveredNode) hoveredPeers.add(e.source);
    }
  }

  if (!isRace) {
    layers.push(new LineLayer({
      id: 'topology-edges',
      data: edgeData,
      getSourcePosition: (d: { source: [number, number] }) => d.source,
      getTargetPosition: (d: { target: [number, number] }) => d.target,
      getColor: edgeColor(),
      getWidth: 1,
      widthUnits: 'pixels',
    }));
  }

  if (!isRace && allDots.length > 0) {
    layers.push(new ScatterplotLayer({
      id: 'arc-particles',
      data: allDots,
      getPosition: (d: { position: [number, number] }) => d.position,
      getRadius: (d: { radius: number }) => d.radius,
      getFillColor: (d: { color: [number, number, number, number] }) => d.color,
      radiusUnits: 'common',
      antialiasing: true,
    }));
  }

  if (!isRace && pulseData.length > 0) {
    layers.push(new ScatterplotLayer({
      id: 'pulse-rings',
      data: pulseData,
      getPosition: (d: { position: [number, number] }) => d.position,
      getRadius: (d: { radius: number }) => d.radius,
      getFillColor: (d: { color: [number, number, number, number] }) => d.color,
      radiusUnits: 'common',
      antialiasing: true,
    }));
  }

  if (selectionData.length > 0) {
    layers.push(new ScatterplotLayer({
      id: 'selection-ring',
      data: selectionData,
      getPosition: (d: { position: [number, number] }) => d.position,
      getRadius: (d: { radius: number }) => d.radius,
      getFillColor: [0, 0, 0, 0],
      getLineColor: SELECTION_COLOR,
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      stroked: true,
      filled: false,
      radiusUnits: 'common',
    }));
  }

  layers.push(new ScatterplotLayer({
    id: 'nodes',
    data: nodeData,
    getPosition: (d: NodeLayerDatum) => d.position,
    getRadius: (d: NodeLayerDatum) => d.radius,
    getFillColor: (d: NodeLayerDatum) => d.color,
    radiusUnits: 'common',
    antialiasing: true,
    pickable: true,
    onClick: (info: { object?: NodeLayerDatum }) => {
      if (info.object) {
        onNodeClick(info.object.index);
      }
    },
    onHover: (info: { object?: NodeLayerDatum; x?: number; y?: number }) => {
      if (info.object) {
        const d = info.object;
        tooltipEl.style.display = 'block';
        tooltipEl.style.left = (info.x! + 12) + 'px';
        tooltipEl.style.top = (info.y! - 8) + 'px';
        // safe: renderNodeTooltip escapes all user-data strings with escapeHtml
        tooltipEl.innerHTML = renderNodeTooltip(d, nodeStates[d.index], header, states, metrics, meta, currentTime);
        onNodeHover(d.index);
      } else {
        tooltipEl.style.display = 'none';
        onNodeHover(-1);
      }
    },
    updateTriggers: {
      getRadius: [selectedNode, currentTime],
      getFillColor: [currentTime, originNode],
    },
  }));

  // Hover highlights on top of everything
  if (hoveredPeers.size > 0) {
    const hlEdges = edges
      .filter(e => e.source === hoveredNode || e.target === hoveredNode)
      .map(e => ({
        source: nodePositions[e.source],
        target: nodePositions[e.target],
      }));
    layers.push(new LineLayer({
      id: 'hover-edges',
      data: hlEdges,
      getSourcePosition: (d: { source: [number, number] }) => d.source,
      getTargetPosition: (d: { target: [number, number] }) => d.target,
      getColor: [...P.hover.rgba.slice(0, 3), 120] as [number, number, number, number],
      getWidth: 2,
      widthUnits: 'pixels',
    }));
    const peerRings = Array.from(hoveredPeers).map(i => ({
      position: nodePositions[i],
      radius: nodeRadius + 4,
    }));
    layers.push(new ScatterplotLayer({
      id: 'hover-peer-rings',
      data: peerRings,
      getPosition: (d: { position: [number, number] }) => d.position,
      getRadius: (d: { radius: number }) => d.radius,
      getFillColor: [0, 0, 0, 0],
      getLineColor: [...P.hover.rgba.slice(0, 3), 140] as [number, number, number, number],
      getLineWidth: 1.5,
      lineWidthUnits: 'pixels',
      stroked: true,
      filled: false,
      radiusUnits: 'common',
    }));
  }

  return layers;
}
