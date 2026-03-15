// Binary min-heap keyed by priority (float64). Supports decrease-key
// via a position lookup array, giving O(log n) push/pop/decreaseKey.

export class MinHeap {
  private heap: number[];       // node indices stored in heap order
  private prio: Float64Array;   // priority[node] (shared, mutated externally via decreaseKey)
  private pos: Int32Array;      // pos[node] = index in heap, or -1 if not present
  private _size: number;

  constructor(capacity: number) {
    this.heap = [];
    this.prio = new Float64Array(capacity).fill(Infinity);
    this.pos = new Int32Array(capacity).fill(-1);
    this._size = 0;
  }

  get size(): number { return this._size; }

  isEmpty(): boolean { return this._size === 0; }

  push(node: number, priority: number): void {
    this.prio[node] = priority;
    const idx = this._size++;
    this.heap[idx] = node;
    this.pos[node] = idx;
    this.siftUp(idx);
  }

  pop(): number {
    const top = this.heap[0];
    this.pos[top] = -1;
    this._size--;
    if (this._size > 0) {
      const last = this.heap[this._size];
      this.heap[0] = last;
      this.pos[last] = 0;
      this.siftDown(0);
    }
    return top;
  }

  decreaseKey(node: number, priority: number): void {
    if (priority >= this.prio[node]) return;
    this.prio[node] = priority;
    const idx = this.pos[node];
    if (idx >= 0) {
      this.siftUp(idx);
    }
  }

  private siftUp(idx: number): void {
    const h = this.heap;
    const p = this.prio;
    const ps = this.pos;
    const node = h[idx];
    const nodePrio = p[node];
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      const parentNode = h[parent];
      if (p[parentNode] <= nodePrio) break;
      h[idx] = parentNode;
      ps[parentNode] = idx;
      idx = parent;
    }
    h[idx] = node;
    ps[node] = idx;
  }

  private siftDown(idx: number): void {
    const h = this.heap;
    const p = this.prio;
    const ps = this.pos;
    const size = this._size;
    const node = h[idx];
    const nodePrio = p[node];
    while (true) {
      let smallest = idx;
      let smallestPrio = nodePrio;
      const left = 2 * idx + 1;
      const right = left + 1;
      if (left < size && p[h[left]] < smallestPrio) {
        smallest = left;
        smallestPrio = p[h[left]];
      }
      if (right < size && p[h[right]] < smallestPrio) {
        smallest = right;
      }
      if (smallest === idx) break;
      const swap = h[smallest];
      h[idx] = swap;
      ps[swap] = idx;
      idx = smallest;
    }
    h[idx] = node;
    ps[node] = idx;
  }
}
