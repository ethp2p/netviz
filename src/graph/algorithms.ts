import { MinHeap } from './heap';

// BFS from origin, returns hop count per node (-1 if unreachable).
export function bfsHops(adj: number[][], origin: number, n: number): Int32Array {
  const hops = new Int32Array(n).fill(-1);
  const start = origin >= 0 ? origin : 0;
  hops[start] = 0;
  const queue = [start];
  let qi = 0;
  while (qi < queue.length) {
    const u = queue[qi++];
    for (const v of adj[u]) {
      if (hops[v] < 0) {
        hops[v] = hops[u] + 1;
        queue.push(v);
      }
    }
  }
  return hops;
}

// Dijkstra shortest-path latency from origin using binary min-heap.
export function dijkstraLatency(
  adjW: { to: number; w: number }[][],
  origin: number,
  n: number,
): Float64Array {
  const dist = new Float64Array(n).fill(Infinity);
  const start = origin >= 0 ? origin : 0;
  dist[start] = 0;

  const heap = new MinHeap(n);
  heap.push(start, 0);

  while (!heap.isEmpty()) {
    const u = heap.pop();
    for (const { to, w } of adjW[u]) {
      const d = dist[u] + w;
      if (d < dist[to]) {
        const wasInf = dist[to] === Infinity;
        dist[to] = d;
        if (wasInf) {
          heap.push(to, d);
        } else {
          heap.decreaseKey(to, d);
        }
      }
    }
  }

  return dist;
}
