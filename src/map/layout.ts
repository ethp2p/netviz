import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } from 'd3-force';
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
import type { LayoutMode } from '../types';
import type { CanonicalHeader } from '../decoder-sdk';
import { EVENT_STRIDE, OP_STATE } from '../decoder-sdk';
import type { TopologyGraph } from '../graph/topology';
import { bfsHops, dijkstraLatency } from '../graph/algorithms';

interface ForceNode extends SimulationNodeDatum {
  index: number;
}

// Hop region data for overlay rendering (separators + labels).
interface HopRegion {
  hop: number;
  xCenter: number;
  count: number;
}
let hopRegions: HopRegion[] = [];
let hopSeparatorXs: number[] = [];
let hopYExtent: [number, number] = [0, 0];

export function getHopRegions() {
  return { regions: hopRegions, separators: hopSeparatorXs, yExtent: hopYExtent };
}

export function computeLayout(
  header: CanonicalHeader,
  eventBuf: Float64Array,
  eventCount: number,
  decodedStateIdx: number,
  mode: LayoutMode,
  originNode: number,
  viewportAspect = 1.5,
  graph?: TopologyGraph,
): [number, number][] {
  switch (mode) {
    case 'force': return layoutForce(header);
    case 'hops': return layoutHops(header, eventBuf, eventCount, decodedStateIdx, originNode, viewportAspect, graph);
    case 'latency': return layoutLatency(header, eventBuf, eventCount, decodedStateIdx, originNode, graph);
    case 'race': return layoutRace(header, eventBuf, eventCount, decodedStateIdx);
  }
}

// Force-directed layout with edge latency weighting.
function layoutForce(header: CanonicalHeader): [number, number][] {
  const n = header.nodes.length;
  const edges = header.edges;

  const d3nodes: ForceNode[] = new Array(n);
  const radius = Math.min(400, n * 8);
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n;
    d3nodes[i] = {
      index: i,
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    };
  }

  // Normalize latencies to a distance range (latency is in microseconds, convert to ms)
  let maxLat = 0;
  for (const e of edges) {
    const latMs = e.latency / 1000;
    if (latMs > maxLat) maxLat = latMs;
  }
  const baseDist = Math.max(60, 600 / Math.sqrt(n));

  const d3links: SimulationLinkDatum<ForceNode>[] = edges.map(e => ({
    source: e.source,
    target: e.target,
  }));

  const linkDistances = edges.map(e =>
    maxLat > 0 ? baseDist * (0.3 + 0.7 * ((e.latency / 1000) / maxLat)) : baseDist,
  );

  const linkForce = forceLink(d3links)
    .distance((_, i) => linkDistances[i])
    .strength(0.3);

  const simulation = forceSimulation(d3nodes)
    .force('charge', forceManyBody().strength(-1500).distanceMax(baseDist * 5))
    .force('link', linkForce)
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide(baseDist * 0.3))
    .stop();

  for (let i = 0; i < 300; i++) {
    simulation.tick();
  }

  const positions: [number, number][] = new Array(n);
  for (let i = 0; i < n; i++) {
    positions[i] = [d3nodes[i].x!, d3nodes[i].y!];
  }
  return positions;
}

// Extract decode times from packed event buffer
function extractDecodeTimes(n: number, eventBuf: Float64Array, eventCount: number, decodedStateIdx: number): Float64Array {
  const decodeTime = new Float64Array(n).fill(Infinity);
  if (decodedStateIdx >= 0) {
    for (let i = 0; i < eventCount; i++) {
      const base = i * EVENT_STRIDE;
      if (eventBuf[base + 2] === OP_STATE && eventBuf[base + 3] === decodedStateIdx) {
        const ni = eventBuf[base + 1];
        const ts = eventBuf[base];
        if (ts < decodeTime[ni]) decodeTime[ni] = ts;
      }
    }
  }
  return decodeTime;
}

// BFS hop regions: nodes placed in hex grids within proportionally-sized regions.
function layoutHops(
  header: CanonicalHeader,
  eventBuf: Float64Array,
  eventCount: number,
  decodedStateIdx: number,
  originNode: number,
  viewportAspect: number,
  graph?: TopologyGraph,
): [number, number][] {
  const n = header.nodes.length;

  const hopCount = graph
    ? bfsHops(graph.adj, originNode, n)
    : bfsHopsFallback(header, originNode);

  const decodeTime = extractDecodeTimes(n, eventBuf, eventCount, decodedStateIdx);

  // Group nodes by hop count
  let maxHop = 0;
  for (let i = 0; i < n; i++) {
    if (hopCount[i] > maxHop) maxHop = hopCount[i];
  }
  const groups: number[][] = new Array(maxHop + 1);
  for (let h = 0; h <= maxHop; h++) groups[h] = [];
  for (let i = 0; i < n; i++) {
    const h = hopCount[i] < 0 ? maxHop : hopCount[i];
    groups[h].push(i);
  }
  for (const g of groups) {
    g.sort((a, b) => decodeTime[a] - decodeTime[b]);
  }

  // Compute hex grid dimensions per region.
  // Columns proportional to count: largest group gets targetMaxCols columns,
  // others are scaled proportionally.
  const nodeSpacing = Math.max(14, Math.min(28, 600 / Math.sqrt(n)));
  const rowH = nodeSpacing * 0.866;
  const regionGap = nodeSpacing * 3;

  let maxCount = 0;
  for (const g of groups) { if (g.length > maxCount) maxCount = g.length; }

  const targetMaxCols = Math.max(4, Math.ceil(Math.sqrt(maxCount * 1.5)));

  const grids: { cols: number; rows: number }[] = [];
  for (const g of groups) {
    const count = g.length;
    if (count === 0) { grids.push({ cols: 0, rows: 0 }); continue; }
    const cols = Math.max(count <= 1 ? 1 : 2, Math.round(targetMaxCols * count / maxCount));
    const rows = Math.ceil(count / cols);
    grids.push({ cols, rows });
  }

  // Lay out regions left to right
  const regionCenters: number[] = [];
  let x = 0;
  for (let h = 0; h <= maxHop; h++) {
    const w = Math.max(0, (grids[h].cols - 1) * nodeSpacing);
    regionCenters.push(x + w / 2);
    x += w;
    if (h < maxHop) x += regionGap;
  }

  // Find max grid height so all regions span the same vertical extent
  let maxGridH = 0;
  for (const grid of grids) {
    const gh = Math.max(0, (grid.rows - 1) * rowH);
    if (gh > maxGridH) maxGridH = gh;
  }

  // Place nodes in hex grid within each region, stretching row spacing
  // so every region fills the full height.
  const positions: [number, number][] = new Array(n);
  let yMin = Infinity, yMax = -Infinity;

  for (let h = 0; h <= maxHop; h++) {
    const g = groups[h];
    const grid = grids[h];
    const cx = regionCenters[h];
    const gridW = Math.max(0, (grid.cols - 1) * nodeSpacing);
    const effectiveRowH = grid.rows > 1 ? maxGridH / (grid.rows - 1) : rowH;
    const gridH = Math.max(0, (grid.rows - 1) * effectiveRowH);
    const left = cx - gridW / 2;
    const top = -gridH / 2;

    for (let j = 0; j < g.length; j++) {
      const row = Math.floor(j / grid.cols);
      const col = j % grid.cols;
      const hexOff = (row % 2 === 1 && grid.cols > 1) ? nodeSpacing * 0.5 : 0;
      const px = left + col * nodeSpacing + hexOff;
      const py = top + row * effectiveRowH;
      positions[g[j]] = [px, py];
      if (py < yMin) yMin = py;
      if (py > yMax) yMax = py;
    }
  }

  // Scale Y so the layout fills the viewport height.
  // Target height = totalWidth / viewportAspect.
  const totalW = x; // accumulated width from region layout
  const currentH = yMax - yMin;
  if (currentH > 0 && totalW > 0) {
    const targetH = totalW / viewportAspect;
    const yScale = targetH / currentH;
    if (yScale > 1) {
      for (const p of positions) {
        p[1] *= yScale;
      }
      yMin *= yScale;
      yMax *= yScale;
    }
  }

  // Store region data for overlay
  hopRegions = [];
  hopSeparatorXs = [];
  for (let h = 0; h <= maxHop; h++) {
    hopRegions.push({ hop: h, xCenter: regionCenters[h], count: groups[h].length });
  }
  // Separators are at the midpoint of each gap
  for (let h = 0; h < maxHop; h++) {
    const w0 = Math.max(0, (grids[h].cols - 1) * nodeSpacing);
    const rightEdge = regionCenters[h] + w0 / 2;
    const w1 = Math.max(0, (grids[h + 1].cols - 1) * nodeSpacing);
    const leftEdge = regionCenters[h + 1] - w1 / 2;
    hopSeparatorXs.push((rightEdge + leftEdge) / 2);
  }
  const pad = nodeSpacing * 2;
  hopYExtent = [yMin - pad, yMax + pad];

  return positions;
}

// Latency spread: X = shortest-path latency from origin, Y = force-spread.
function layoutLatency(
  header: CanonicalHeader,
  eventBuf: Float64Array,
  eventCount: number,
  decodedStateIdx: number,
  originNode: number,
  graph?: TopologyGraph,
): [number, number][] {
  const n = header.nodes.length;

  const dist = graph
    ? dijkstraLatency(graph.adjW, originNode, n)
    : dijkstraFallback(header, originNode);

  // X = latency (scaled), Y = force-separated to avoid overlap
  let maxDist = 0;
  for (let i = 0; i < n; i++) {
    if (dist[i] < Infinity && dist[i] > maxDist) maxDist = dist[i];
  }
  const xScale = maxDist > 0 ? (Math.max(400, n * 6)) / maxDist : 1;

  const decodeTime = extractDecodeTimes(n, eventBuf, eventCount, decodedStateIdx);

  // Sort all nodes by latency distance, break ties by decode time
  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => dist[a] - dist[b] || decodeTime[a] - decodeTime[b]);
  const rank = new Int32Array(n);
  for (let j = 0; j < n; j++) rank[order[j]] = j;

  // Use force simulation for Y positions only, X fixed by latency
  const d3nodes: ForceNode[] = new Array(n);
  const rowSpacing = Math.max(20, 200 / Math.sqrt(n));
  for (let i = 0; i < n; i++) {
    d3nodes[i] = {
      index: i,
      x: (dist[i] < Infinity ? dist[i] : maxDist) * xScale,
      y: (rank[i] - n / 2) * rowSpacing * 0.5,
    };
  }

  // Light force sim for Y-only spread (fix X positions)
  const sim = forceSimulation(d3nodes)
    .force('collide', forceCollide(rowSpacing * 0.4))
    .force('y', forceCenter(0, 0))
    .stop();

  const fixedX = d3nodes.map(nd => nd.x!);
  for (let i = 0; i < 100; i++) {
    sim.tick();
    for (let j = 0; j < n; j++) {
      d3nodes[j].x = fixedX[j];
    }
  }

  const positions: [number, number][] = new Array(n);
  for (let i = 0; i < n; i++) {
    positions[i] = [d3nodes[i].x!, d3nodes[i].y!];
  }
  return positions;
}

// Inline BFS fallback when no precomputed graph is available.
function bfsHopsFallback(header: CanonicalHeader, originNode: number): Int32Array {
  const n = header.nodes.length;
  const edges = header.edges;
  const adj: number[][] = new Array(n);
  for (let i = 0; i < n; i++) adj[i] = [];
  for (const e of edges) {
    adj[e.source].push(e.target);
    adj[e.target].push(e.source);
  }
  return bfsHops(adj, originNode, n);
}

// Inline Dijkstra fallback when no precomputed graph is available.
function dijkstraFallback(header: CanonicalHeader, originNode: number): Float64Array {
  const n = header.nodes.length;
  const edges = header.edges;
  const adjW: { to: number; w: number }[][] = new Array(n);
  for (let i = 0; i < n; i++) adjW[i] = [];
  for (const e of edges) {
    const latMs = e.latency / 1000;
    adjW[e.source].push({ to: e.target, w: latMs });
    adjW[e.target].push({ to: e.source, w: latMs });
  }
  return dijkstraLatency(adjW, originNode, n);
}

// Racing bars layout: nodes stacked vertically, X will be driven by chunk progress at render time.
// Returns initial positions (all at X=0), actual X is set per-frame in the racing renderer.
function layoutRace(
  header: CanonicalHeader,
  eventBuf: Float64Array,
  eventCount: number,
  decodedStateIdx: number,
): [number, number][] {
  const n = header.nodes.length;

  const decodeTime = extractDecodeTimes(n, eventBuf, eventCount, decodedStateIdx);

  const order = Array.from({ length: n }, (_, i) => i);
  order.sort((a, b) => decodeTime[a] - decodeTime[b]);
  const rank = new Int32Array(n);
  for (let j = 0; j < n; j++) rank[order[j]] = j;

  const rowHeight = Math.max(16, Math.min(30, 800 / n));
  const positions: [number, number][] = new Array(n);
  for (let i = 0; i < n; i++) {
    positions[i] = [0, rank[i] * rowHeight];
  }
  return positions;
}
