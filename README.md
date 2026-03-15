# netviz

Interactive visualization engine for network protocol simulations. Feed it a topology and a stream of events (state transitions, transfers, metrics, link changes) and netviz renders them as a GPU-accelerated network graph with time-scrubable playback, synchronized charts, live statistics, and a filtered event log.

The network graph renders through deck.gl, which targets WebGL 2 and falls back to WebGL 1. deck.gl was chosen over raw WebGL or Three.js because it provides a declarative layer system designed for data visualization: scatter plots, line layers, and custom particle effects compose naturally, and its internal diffing means only changed layers trigger GPU uploads on each frame. This matters here because the graph redraws on every animation frame during playback, with hundreds of nodes, edges, and in-flight transfer particles updating simultaneously. Canvas 2D handles the overlay layer (ring glyphs, text labels, hop separators) where pixel-precise rendering and native font support are needed.

The engine is protocol-agnostic. A pluggable decoder SDK defines how raw trace data maps to the canonical event model. Bundled decoders are auto-detected from the trace file header; user-supplied decoders can be loaded as `.js` files and are persisted in IndexedDB across sessions. Adding support for a new protocol means implementing one function: `decode(lines) → DecoderOutput`.

## Getting started

```bash
bun install
bun dev
```

Open the browser and load a trace file. If the file header contains a `decoderName` field matching a bundled or saved decoder, it is used automatically. Otherwise, a decoder picker appears for manual selection.

The bundled ethp2p decoder accepts `.bctrace` and `.bctrace.gz` files produced by the ethp2p simulator. To use a custom decoder, click the decoder button in the toolbar and load a `.js` file that exports a `Decoder` object.

Keyboard shortcuts: Space to play/pause, arrow keys to step (100ms per press), `f` to fit the viewport, Escape to clear the selected node.

## Decoder SDK

The decoder SDK defines the contract between trace formats and the visualization engine. A decoder receives raw lines and produces a `DecoderOutput`:

- **CanonicalHeader**: node specs (name, properties), edges (source, target, latency), and arbitrary metadata.
- **PackedEvents**: a strided `Float64Array` (6 floats per event: timestamp, node, opcode, field1, field2, field3) plus optional log texts and peer indexes.
- **StateDef[]**: named node states with colors, terminal flags, and stats grouping.
- **ArcLayerDef[]**: animated transfer layers (color, lifetime, travel time, radius).
- **MetricDef[]**: per-node metrics (count, bytes, or rate) with optional ring overlays.
- **Milestones**: labeled time markers on the playback timeline.
- **ChartHints**: tells the engine which state is the CDF target, which arc layer drives bandwidth charts, and which node is the origin.

Six opcodes cover the event vocabulary: `OP_STATE` (node enters a state), `OP_TRANSFER` (data moves between nodes), `OP_PROGRESS` (chunks held vs. needed), `OP_METRIC` (arbitrary numeric), `OP_LINK` (connection up/down), `OP_LOG` (free-text entry). Every protocol-specific event maps to one of these.

Decoding runs in a Web Worker so user-supplied decoders cannot block the UI. User decoder `.js` files are validated in a temporary worker before being saved to IndexedDB. Output is validated at runtime against the schema.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         app.ts                                  │
│           (main loop: decode → precompute → render)             │
└─────────────────────────────────────────────────────────────────┘
        │              │              │              │
        ▼              ▼              ▼              ▼
┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
│  decoder  │  │   state   │  │    map    │  │  charts   │
│    sdk    │  │  machine  │  │ (deck.gl) │  │   (SVG)   │
└───────────┘  └───────────┘  └───────────┘  └───────────┘
        │              │              │
        ▼              ▼              ▼
┌───────────┐  ┌───────────┐  ┌───────────┐
│  worker/  │  │   graph/  │  │    ui/    │
│  decode   │  │ topology  │  │  panels   │
└───────────┘  └───────────┘  └───────────┘
```

**state.ts**: incremental state machine. On each frame, `advanceStateTo` processes only the events between the last computed index and the current time cursor. A checkpoint ring buffer (snapshot every 5000 events, 50 slots) makes backward seeks O(N/K) instead of replaying from zero.

**map/**: four layout modes (see below), deck.gl WebGL rendering for nodes/edges/particles, and a Canvas 2D overlay for ring glyphs and text that deck.gl cannot provide.

**charts/**: CDF, cumulative traffic, and bandwidth rate charts driven by `ChartHints`. All data is precomputed once on file load; charts share synchronized crosshairs and a time marker tracking the playback cursor.

**graph/**: topology analysis. BFS for hop counts, Dijkstra (binary min-heap) for latency, per-node bandwidth histograms.

**ui/**: one module per concern (file loading, playback, event log, stats, keyboard, settings). Each sets up listeners once; the main loop calls `updateAll()` on every frame.

## Four layout modes

Each answers a different question about the same propagation event.

**Force** uses a d3-force simulation with latency-weighted link distances. Nodes that are topologically close cluster together. This is the right view for understanding community structure: which regions are tightly coupled, which are loosely connected through high-latency links.

**Hops** runs BFS from the origin and groups nodes into hex grids by hop count, with regions sized proportionally to population. This reveals the propagation frontier: how many hops to reach the whole network, and where stragglers concentrate.

**Latency** places nodes on the X-axis by Dijkstra shortest-path distance from the origin, with a force-spread Y to avoid overlap. Nodes at similar latency that reach terminal state at very different times point to strategy or bandwidth bottlenecks.

**Race** turns the visualization into a horizontal bar chart. Every node gets a lane; the bar extends rightward as progress increases, and nodes are ranked vertically by completion time.

## What the dashboard shows

The **stats panel** (left) tracks live counters derived from the decoder's state and metric definitions: node state populations, per-metric aggregates, and transfer volume.

The **network graph** (center) renders nodes as colored dots whose fill reflects state. Transfers appear as animated particles traveling along edges, with separate arc layers for different transfer types. Nodes pulse on state transitions. Concentric ring overlays show per-node metric breakdowns when the decoder defines ring metrics.

The **event log** (right) streams events filtered by node selection and event type. Click a node to filter; Alt+click a type tag for "only this type." Hovering an entry highlights the corresponding node and peer on the graph.

The **charts** (below stats) are driven by `ChartHints` from the decoder:

- CDF: fraction of nodes reaching the terminal state over time.
- Origin cumulative traffic (mirrored: upload above, download below the baseline).
- Relayer cumulative traffic as percentile bands (p50 through p99).
- Origin and relayer bandwidth rate (50ms buckets, switchable between MB/s and Mbit/s).

All charts share synchronized crosshairs and a time marker that tracks the playback cursor.

## Implementation notes

**Packed binary events.** Events are stored as a `Float64Array` with stride 6 (timestamp, node, opcode, field1, field2, field3). This gives O(1) random access, efficient memory layout for the hot playback loop, and a clean base for binary search on timestamps.

**Precomputation on load.** Expensive work happens once: parallel timestamp array for binary search, per-node event indexes (`Int32Array`) for O(log n) filtered lookups, topology metadata (BFS hops, Dijkstra latency, bandwidth histograms), all chart data, and all layout positions. Per-frame scanning is eliminated entirely.

**Layered rendering.** deck.gl (WebGL) handles nodes, edges, and particle effects where GPU throughput matters for hundreds of simultaneous elements. Canvas 2D handles ring glyphs, hop-region labels, and race-mode node names where pixel-precise text and arc rendering are needed. DOM handles stats, controls, and the event log.

**OKLCH palette.** Colors are defined once as `[L, C, H]` coordinates in OKLCH space and derived into both CSS strings and sRGB `[r, g, b, 255]` tuples. OKLCH gives perceptually uniform lightness, so semantic colors maintain consistent visual weight across node fills, ring arcs, chart lines, and event log highlights.

## Testing

```bash
bun test          # 379 tests
bun test:watch
```

## License

MIT OR Apache-2.0
