import { ScatterplotLayer, LineLayer } from '@deck.gl/layers';
import type { NodeData } from '../types';
import { P } from '../types';
import type { RGBA } from '../decoder-sdk';

export function buildRaceLayers(
  nodeCount: number,
  nodeColors: RGBA[],
  nodePositions: [number, number][],
  nodeStates: NodeData[],
): (ScatterplotLayer | LineLayer)[] {
  const layers: (ScatterplotLayer | LineLayer)[] = [];
  const n = nodeCount;

  const maxChunks = Math.max(1, ...Array.from({ length: n }, (_, i) => nodeStates[i].chunksNeed || 1));
  const rowH = Math.max(16, Math.min(30, 800 / n));
  const barWidth = Math.max(200, maxChunks * 8);
  const laneWidth = barWidth / maxChunks;

  // Lane grid lines
  const gridLines: { source: [number, number]; target: [number, number]; color: [number, number, number, number] }[] = [];
  const totalH = (n - 1) * rowH;
  for (let k = 0; k <= maxChunks; k++) {
    const x = k * laneWidth;
    gridLines.push({
      source: [x, -rowH],
      target: [x, totalH + rowH],
      color: k === maxChunks
        ? [...P.idle.rgba.slice(0, 3), 120] as [number, number, number, number]
        : [...P.border.rgba.slice(0, 3), 80] as [number, number, number, number],
    });
  }
  layers.push(new LineLayer({
    id: 'race-grid',
    data: gridLines,
    getSourcePosition: (d: { source: [number, number] }) => d.source,
    getTargetPosition: (d: { target: [number, number] }) => d.target,
    getColor: (d: { color: [number, number, number, number] }) => d.color,
    getWidth: 1,
    widthUnits: 'pixels',
  }));

  // Progress bars (filled portion as thick horizontal lines)
  const barLines: { source: [number, number]; target: [number, number]; color: [number, number, number, number] }[] = [];
  for (let i = 0; i < n; i++) {
    const ns = nodeStates[i];
    const have = ns.chunksHave;
    if (have <= 0) continue;
    const y = nodePositions[i][1];
    const w = have * laneWidth;
    const c = nodeColors[ns.state] ?? nodeColors[0];
    const color: [number, number, number, number] = [c[0], c[1], c[2], 180];
    barLines.push({
      source: [0, y],
      target: [w, y],
      color,
    });
  }
  if (barLines.length > 0) {
    layers.push(new LineLayer({
      id: 'race-bars',
      data: barLines,
      getSourcePosition: (d: { source: [number, number] }) => d.source,
      getTargetPosition: (d: { target: [number, number] }) => d.target,
      getColor: (d: { color: [number, number, number, number] }) => d.color,
      getWidth: Math.max(4, rowH * 0.6),
      widthUnits: 'pixels',
    }));
  }

  return layers;
}
