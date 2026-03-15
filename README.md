# bctrace visualizer

A broadcast simulation produces thousands of chunk-send, chunk-receive, session, and routing events across hundreds of nodes in under a second. Reading that as a log is like reading a symphony as a list of frequencies. We need a spatial, temporal, interactive representation to understand what actually happened during propagation.

**The visualizer replays `.bctrace` files as an interactive, time-scrubable dashboard: a GPU-rendered network graph, live statistics, filtered event log, and synchronized bandwidth/CDF charts.**

## Getting started

```
npm install
npm run dev
```

Open the browser, click "Load .bctrace", and pick a trace file (`.bctrace` or `.bctrace.gz`). The simulator writes these when tracing is enabled (see `sim/trace_writer.go`). Sample traces are included in this directory.

Keyboard shortcuts: Space to play/pause, arrow keys to step (100ms per press), `f` to fit the viewport, Escape to clear the selected node.

## The trace format

A `.bctrace` file is NDJSON with three sections:

1. A **header line**: schema version, wall-clock start time, node names, full topology (nodes with bandwidth specs, edges with latencies), and the simulation config.
2. **Event lines**: compact JSON tuples `[timestamp_us, node_idx, event_code, ...fields]`. Timestamps are microseconds since t0. Event codes are two-letter mnemonics: `ss` (session started), `sd` (session decoded), `cs` (chunk sent), `cr` (chunk received), `ru` (routing update), and so on.
3. An optional **footer line**: marks the end, records total duration and a byte-offset index for seeking.

The Go side (`sim/trace_observer.go`) implements the `broadcast.Observer` interface and writes each callback as a tuple through a mutex-protected `TraceWriter`. The TypeScript side parses the NDJSON, sorts events by timestamp (defensive against concurrent goroutine emission order), and builds several precomputed indexes for fast playback.

## Four layout modes, four questions

Each layout mode answers a different question about the same propagation event.

**Force** uses a d3-force simulation with latency-weighted link distances. Nodes that are topologically close cluster together. This is the right view for understanding community structure and connectivity: which regions of the network are tightly coupled, which are loosely connected through high-latency links.

**Hops** runs BFS from the origin and groups nodes into hex grids by hop count, with regions sized proportionally to population. Within each region, nodes are sorted by decode time. This reveals the propagation frontier: how many hops does it take to reach the whole network, and where do stragglers concentrate.

**Latency** places nodes on the X-axis by Dijkstra shortest-path latency from the origin, with a force-spread Y to avoid overlap. This is the view for correlating physical network distance with propagation speed. Nodes at similar latency that decode at very different times point to coding strategy or bandwidth bottlenecks.

**Race** turns the visualization into a horizontal bar chart. Every node gets a lane; the bar extends rightward as chunks arrive, and nodes are ranked vertically by decode time. This is the purest performance comparison: who finishes first, who finishes last, and how far behind is the tail.

## What the dashboard shows

The **stats panel** (left) tracks live counters: node states (decoded, receiving, error), chunk verdicts (accepted, useless, not needed, duplicate), transfer volume, and strategy progress (min/max/avg chunks held vs. needed).

The **network graph** (center) renders nodes as colored dots whose fill reflects state (idle, session, receiving, decoded, error, origin). Chunk transfers appear as animated particles traveling along edges with trailing arcs. Routing updates get their own dimmer, smaller particles. Receiving nodes pulse briefly on each chunk arrival. Concentric rings around each node show chunk verdict breakdown (useful/useless/unused) against the final tally, so we can see efficiency building up in real time.

The **event log** (right) streams events filtered by node selection and event type. Click a node to filter; Alt+click an event type tag for "only this type." Hovering an event entry highlights the corresponding node and peer on the graph.

The **charts** (below stats) are computed once on file load, scoped to the propagation window:

- A reconstruction CDF showing what fraction of nodes have decoded over time.
- Origin cumulative traffic (mirrored: upload above, download below the baseline).
- Relayer cumulative traffic as percentile bands (p50 through p99), revealing how uniformly the network shares the load.
- Origin and relayer bandwidth rate charts (1-second buckets, switchable between MB/s and Mbit/s).

All charts share synchronized crosshairs and a time marker that tracks the playback cursor.

## Architecture notes

The rendering uses two layers: deck.gl (WebGL) for nodes, edges, and particle effects where we need GPU throughput for hundreds of simultaneous elements, and a Canvas 2D overlay for the ring glyphs, hop-region labels, and race-mode node names where we need pixel-precise text and arc rendering that deck.gl cannot provide.

State advances incrementally. On each frame, `advanceStateTo` processes only the events between the last computed index and the current time cursor. It never re-scans the full trace during forward playback. Backward seeks reset the state and replay from zero; this is the correct tradeoff because backward seeks are infrequent user actions while frame-to-frame advance is the hot path.

Precomputation happens once on file load: a parallel timestamp array for binary search, per-node event indexes using exact-sized `Int32Array` for O(log n) filtered lookups, per-node verdict maxes for ring rendering, topology metadata (BFS hops, Dijkstra latency, per-node bandwidth profiles), and all chart data. These one-time costs eliminate per-frame scanning entirely.

The event log uses dual strategies: forward playback appends new events incrementally (capped at 500 DOM elements), while backward seeks use the per-node index for binary search and walk backwards collecting matches. At extreme playback speeds, the scanning window is capped to accept that some filtered entries may not appear in the log, which is acceptable since the log is unreadable at those speeds anyway.

Colors are defined once in an OKLCH palette (`types.ts`), with every color specified as `[L, C, H]` coordinates and derived into both CSS strings and sRGB `[r, g, b, 255]` tuples. OKLCH gives perceptually uniform lightness, so the semantic colors (receiving, decoded, error, origin) maintain consistent visual weight across different contexts: node fills, ring arcs, chart lines, and event log highlights.
