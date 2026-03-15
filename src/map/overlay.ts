import type { NodeData, LayoutMode } from '../types';
import type { RGBA } from '../decoder-sdk';
import { P } from '../types';
import { getDeck } from './renderer';
import { getHopRegions } from './layout';
const RING_EMPTY = P.borderSubtle.css;

export interface HoverHighlight {
  nodeIdx: number;
  peerIdx: number; // -1 if no peer
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  nodePositions: [number, number][],
  nodeStates: NodeData[],
  overlayMaxes: number[][],        // [metricIdx][nodeIdx]
  overlayMetricGroups: number[][], // metric indices per visual ring
  ringToggles: boolean[],          // one per visual ring
  ringColors: RGBA[],              // one per visual ring
  nodeCount: number,
  highlight: HoverHighlight | null,
  mode: LayoutMode,
  nodeColors: RGBA[],
  nodeNames?: string[],
): void {
  const dk = getDeck();
  if (!dk) return;
  const viewports = dk.getViewports();
  if (!viewports.length) return;
  const vp = viewports[0];

  const canvas = ctx.canvas;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const bufW = Math.round(cssW * dpr);
  const bufH = Math.round(cssH * dpr);
  if (canvas.width !== bufW || canvas.height !== bufH) {
    canvas.width = bufW;
    canvas.height = bufH;
  }

  ctx.clearRect(0, 0, bufW, bufH);
  ctx.save();
  ctx.scale(dpr, dpr);

  const nodeR = Math.max(3, Math.min(8, 200 / Math.sqrt(nodeCount)));

  // --- Rings (skip in race mode) ---
  const anyRing = mode !== 'race' && ringToggles.some(b => b);
  if (anyRing) {
    const ringCount = overlayMetricGroups.length;
    const ringRadii: number[] = [];
    for (let r = 0; r < ringCount; r++) {
      ringRadii.push(nodeR + 3 + r * 3);
    }
    ctx.lineWidth = 2;
    ctx.lineCap = 'butt';

    for (let i = 0; i < nodePositions.length; i++) {
      const [sx, sy] = vp.project(nodePositions[i]);
      if (sx < -20 || sx > cssW + 20 || sy < -20 || sy > cssH + 20) continue;

      const ns = nodeStates[i];

      for (let ring = 0; ring < ringCount; ring++) {
        if (!ringToggles[ring]) continue;
        const metricIndices = overlayMetricGroups[ring];
        let maxCount = 0;
        let current = 0;
        for (const metricIdx of metricIndices) {
          maxCount += overlayMaxes[metricIdx]?.[i] ?? 0;
          current += ns.metrics[metricIdx] ?? 0;
        }
        if (maxCount === 0) continue;
        const r = ringRadii[ring];
        const fill = ringColors[ring] ?? [nodeColors[0]?.[0] ?? 255, nodeColors[0]?.[1] ?? 255, nodeColors[0]?.[2] ?? 255, 255];
        const fillColor = `rgb(${fill[0]},${fill[1]},${fill[2]})`;
        const gapFrac = Math.min(0.15, 1 / (maxCount + 1));
        const totalGap = 2 * Math.PI * gapFrac;
        const gapAngle = totalGap / maxCount;
        const segAngle = (2 * Math.PI - totalGap) / maxCount;

        for (let s = 0; s < maxCount; s++) {
          const a0 = -Math.PI / 2 + s * (segAngle + gapAngle);
          const a1 = a0 + segAngle;
          ctx.beginPath();
          ctx.arc(sx, sy, r, a0, a1);
          ctx.strokeStyle = s < current ? fillColor : RING_EMPTY;
          ctx.stroke();
        }
      }
    }
  }

  // --- Hop mode separators and labels ---
  if (mode === 'hops') {
    const { regions, separators, yExtent } = getHopRegions();
    const [yLo, yHi] = yExtent;

    // Dotted separator lines
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = P.idle.css;
    ctx.lineWidth = 1;
    for (const sx of separators) {
      const [px] = vp.project([sx, 0]);
      const [, pyTop] = vp.project([0, yLo]);
      const [, pyBot] = vp.project([0, yHi]);
      ctx.beginPath();
      ctx.moveTo(px, pyTop);
      ctx.lineTo(px, pyBot);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Hop labels at top of each region
    ctx.font = '10px "Ubuntu Sans Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const r of regions) {
      const [px, pyTop] = vp.project([r.xCenter, yLo]);
      if (px < -100 || px > cssW + 100) continue;
      ctx.fillStyle = P.text2.css;
      ctx.fillText(
        r.hop === 0 ? 'origin' : r.hop + (r.hop === 1 ? ' hop' : ' hops'),
        px,
        pyTop - 6,
      );
      ctx.fillStyle = P.idle.css;
      ctx.fillText(r.count + ' node' + (r.count !== 1 ? 's' : ''), px, pyTop + 6);
    }
  }

  // --- Race mode labels ---
  if (mode === 'race' && nodeNames) {
    ctx.font = '10px "Ubuntu Sans Mono", monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < nodeCount; i++) {
      const [, sy] = vp.project(nodePositions[i]);
      if (sy < -10 || sy > cssH + 10) continue;
      const [originX] = vp.project([0, nodePositions[i][1]]);
      const c = nodeColors[nodeStates[i].state];
      if (c) {
        ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      } else {
        ctx.fillStyle = P.text2.css;
      }
      ctx.fillText(nodeNames[i], originX - 6, sy);
    }
  }

  // --- Hover highlight ---
  if (highlight && highlight.nodeIdx >= 0 && highlight.nodeIdx < nodePositions.length) {
    const [nx, ny] = vp.project(nodePositions[highlight.nodeIdx]);
    const hlR = nodeR + 1;

    // Edge between node and peer (draw first, behind circles)
    if (highlight.peerIdx >= 0 && highlight.peerIdx < nodePositions.length) {
      const [px, py] = vp.project(nodePositions[highlight.peerIdx]);
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(px, py);
      ctx.strokeStyle = P.hover.css.replace(')', ' / 0.45)');
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Peer outline
      ctx.beginPath();
      ctx.arc(px, py, hlR, 0, 2 * Math.PI);
      ctx.strokeStyle = P.hover.css;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Node outline (brighter, on top)
    ctx.beginPath();
    ctx.arc(nx, ny, hlR, 0, 2 * Math.PI);
    ctx.strokeStyle = P.text.css;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  ctx.restore();
}
