import { EVENT_STRIDE } from '../decoder-sdk';

export interface EventIndex {
  byNode: Int32Array[];
}

export function buildTimeIndex(buf: Float64Array, count: number): number[] {
  const idx = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    idx[i] = buf[i * EVENT_STRIDE];
  }
  return idx;
}

export function buildEventIndex(buf: Float64Array, count: number, nodeCount: number): EventIndex {
  const counts = new Int32Array(nodeCount);
  for (let i = 0; i < count; i++) {
    const ni = buf[i * EVENT_STRIDE + 1];
    if (ni >= 0 && ni < nodeCount) counts[ni]++;
  }
  const byNode: Int32Array[] = new Array(nodeCount);
  const offsets = new Int32Array(nodeCount);
  for (let n = 0; n < nodeCount; n++) {
    byNode[n] = new Int32Array(counts[n]);
  }
  for (let i = 0; i < count; i++) {
    const ni = buf[i * EVENT_STRIDE + 1];
    if (ni >= 0 && ni < nodeCount) {
      byNode[ni][offsets[ni]++] = i;
    }
  }
  return { byNode };
}

export function upperBound(arr: number[], target: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Binary search: find the rightmost position in `arr` where arr[pos] < limit.
// Returns the count of elements strictly less than `limit`.
export function countBefore(arr: Int32Array, limit: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

