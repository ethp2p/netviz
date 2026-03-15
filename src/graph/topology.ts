import type { CanonicalHeader } from '../decoder-sdk';

export interface TopologyGraph {
  adj: number[][];                          // unweighted adjacency (for BFS)
  adjW: { to: number; w: number }[][];     // weighted adjacency (for Dijkstra)
}

export function buildTopologyGraph(header: CanonicalHeader): TopologyGraph {
  const n = header.nodes.length;
  const edges = header.edges;
  const adj: number[][] = new Array(n);
  const adjW: { to: number; w: number }[][] = new Array(n);
  for (let i = 0; i < n; i++) { adj[i] = []; adjW[i] = []; }
  for (const e of edges) {
    adj[e.source].push(e.target);
    adj[e.target].push(e.source);
    // latency is in microseconds, convert to ms for display
    adjW[e.source].push({ to: e.target, w: e.latency / 1000 });
    adjW[e.target].push({ to: e.source, w: e.latency / 1000 });
  }
  return { adj, adjW };
}
