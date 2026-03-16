import type { AppStore } from '../store';
import type { EventLogState } from './events-panel';
import type { DecoderPicker, ResolvedDecoder } from './decoder-picker';
import type { DecoderOutput, CanonicalHeader, DecodeOptions } from '../decoder-sdk';
import { EVENT_STRIDE, OP_PROGRESS } from '../decoder-sdk';
import { buildTimeIndex, buildEventIndex } from '../trace';
import { buildTopologyGraph } from '../graph/topology';
import { computeLayout } from '../map/layout';
import { initDeckGL, getDeck, fitViewToNodes } from '../map/renderer';
import { computeNodeMetadata } from '../graph/node-metadata';
import { createIncrementalState } from '../state';
import { computeChartData } from '../charts/data';
import { renderCharts } from '../charts/render';
import type { StatElements } from './stats-panel';
import { buildStatElements } from './stats-panel';
import { getEl } from './dom';
import { rebuildLegend } from './legend';
import { getOverlayMetricGroups } from './overlay-groups';
import { buildBundledDecoderPreview } from '../decoders/preview';

export function initFileLoader(deps: {
  store: AppStore;
  eventLogState: EventLogState;
  updateAll: () => void;
  picker: DecoderPicker;
  renderCountryDist: (header: CanonicalHeader) => void;
  renderBwDist: (header: CanonicalHeader) => void;
  renderMilestones: (milestones: DecoderOutput['milestones'], min: number, max: number) => void;
  drawOverlayNow: () => void;
  rebuildSettings: (output: DecoderOutput) => void;
  onStatEls: (els: StatElements) => void;
  onLoad: () => void;
}): void {
  const { store, eventLogState, updateAll, drawOverlayNow } = deps;
  const fileInput = getEl<HTMLInputElement>('file-input');
  const fileName = getEl('file-name');
  const msgSelect = getEl<HTMLSelectElement>('msg-select');
  const btnPlay = getEl<HTMLButtonElement>('btn-play');
  const btnReset = getEl<HTMLButtonElement>('btn-reset');
  const speedSelect = getEl<HTMLSelectElement>('speed-select');
  const timeline = getEl<HTMLInputElement>('timeline');
  const mapContainer = getEl('map-container');
  const emptyState = getEl('empty-state');
  const nodeLegend = getEl('node-legend');
  const eventLogList = getEl('event-log-list');
  const clearFilterBtn = getEl('clear-filter');
  const statsPanel = getEl('stats-panel');
  const timelineLegend = getEl('tl-legend');
  const eventTypeFilter = getEl('event-type-filter');
  const countryDist = getEl('country-dist');
  const bwDist = getEl('bw-dist');
  const loadProgress = getEl('load-progress');
  const loadProgressStatus = getEl('lp-status');
  const loadProgressFill = getEl('lp-fill');

  let worker: Worker | null = null;
  let rawLines: string[] = [];
  let resolvedDecoder: ResolvedDecoder | null = null;
  let previewShown = false;
  let latestLoadToken = 0;

  function setLoadProgress(label: string, percent?: number, indeterminate = false): void {
    loadProgress.classList.add('visible');
    loadProgress.classList.toggle('indeterminate', indeterminate);
    loadProgressStatus.textContent = label;
    if (!indeterminate) {
      const clamped = Math.max(0, Math.min(1, percent ?? 0));
      loadProgressFill.style.width = `${Math.round(clamped * 100)}%`;
      loadProgressFill.style.transform = '';
    }
  }

  function hideLoadProgress(): void {
    loadProgress.classList.remove('visible', 'indeterminate');
    loadProgressFill.style.width = '0%';
    loadProgressFill.style.transform = '';
    loadProgressStatus.textContent = '';
  }

  function resetLoadingUi(): void {
    previewShown = false;
    store.previewingLoad = false;
    store.playing = false;
    store.selectedNode = -1;
    store.hoveredNode = -1;
    store.hoverHighlight = null;
    btnPlay.disabled = true;
    btnPlay.textContent = 'Play';
    btnPlay.classList.remove('active');
    btnReset.disabled = true;
    speedSelect.disabled = true;
    timeline.disabled = true;
    msgSelect.disabled = true;
    msgSelect.style.display = 'none';
    nodeLegend.classList.remove('visible');
    clearFilterBtn.style.display = 'none';
    eventLogState.lastRenderedIdx = -1;
    eventLogList.replaceChildren();
    eventTypeFilter.replaceChildren();
    timelineLegend.replaceChildren();
    countryDist.replaceChildren();
    bwDist.replaceChildren();
    const h2 = statsPanel.querySelector('h2');
    statsPanel.replaceChildren();
    if (h2) statsPanel.appendChild(h2);
    const existingCharts = statsPanel.querySelector('#charts-section');
    if (existingCharts) existingCharts.remove();
    store.chartControls = null;
  }

  function formatMs(us: number): string {
    return (us / 1000).toFixed(0) + 'ms';
  }

  function ensureWorker(): Worker {
    if (!worker) {
      worker = new Worker(
        new URL('../worker/decode-worker.ts', import.meta.url),
        { type: 'module' },
      );
    }
    return worker;
  }

  function extractDecoderName(lines: string[]): string | undefined {
    try {
      const parsed = JSON.parse(lines[0] ?? '');
      if (typeof parsed?.decoderName === 'string') return parsed.decoderName;
    } catch {
      // Not JSON or missing field
    }
    return undefined;
  }

  function runDecode(lines: string[], resolved: ResolvedDecoder, options?: DecodeOptions) {
    const w = ensureWorker();

    w.onmessage = (e: MessageEvent<{ kind: 'progress'; label: string; percent?: number; indeterminate?: boolean } | { kind: 'result'; output: DecoderOutput } | { kind: 'error'; message: string }>) => {
      const message = e.data;
      if (message.kind === 'progress') {
        setLoadProgress(message.label, message.percent, message.indeterminate ?? false);
        return;
      }
      if (message.kind === 'error') {
        console.error('Decode worker error:', message.message);
        alert('Decoder failed: ' + message.message);
        return;
      }

      const output = message.output;
      if (output.events.eventTypeIdxs && !(output.events.eventTypeIdxs instanceof Int16Array)) {
        output.events.eventTypeIdxs = new Int16Array(output.events.eventTypeIdxs);
      }
      if (output.events.peerNodeIdxs && !(output.events.peerNodeIdxs instanceof Int32Array)) {
        output.events.peerNodeIdxs = new Int32Array(output.events.peerNodeIdxs);
      }
      onDecodeComplete(output);
    };

    w.onerror = (err) => {
      console.error('Decode worker error:', err);
      alert('Decoder failed: ' + err.message);
    };

    w.postMessage({
      kind: 'decode',
      lines,
      decoderSrc: resolved.kind === 'user' ? resolved.source : null,
      decoderName: resolved.kind === 'bundled' ? resolved.name : undefined,
      options,
    });
  }

  function onDecodeComplete(output: DecoderOutput) {
    setLoadProgress('Finalizing view...', 0.97);
    populateStore(output);
    buildMessageDropdown(output);
    initVisualization(output);
    hideLoadProgress();
  }

  function populateStore(output: DecoderOutput) {
    const nodeCount = output.header.nodes.length;

    store.decoderOutput = output;
    store.eventBuf = output.events.buf;
    store.logTexts = output.events.logTexts;
    store.eventCount = output.events.count;
    store.nodeColors = output.states.map(s => s.color);
    store.decodedStateIdx = output.chartHints.race?.stateIdx
      ?? output.chartHints.cdf?.stateIdx
      ?? output.states.findIndex(s => s.terminal);
    store.timeIndex = buildTimeIndex(output.events.buf, output.events.count);
    store.eventIndex = buildEventIndex(output.events.buf, output.events.count, nodeCount);
    store.overlayMaxes = output.metrics.map(m =>
      m.overlay === 'ring' ? new Array<number>(nodeCount).fill(0) : [],
    );
    store.originNode = output.chartHints.bandwidth?.originNode ?? -1;
    store.graphSettings.ringToggles = getOverlayMetricGroups(output.metrics).map(() => true);
    store.enabledArcLayers = output.arcLayers.map(() => false);
    store.eventFilter = {
      opcodes: new Set([0, 1, 2, 3, 4, 5]),
      arcLayers: new Set(output.arcLayers.map((_, i) => i)),
      metrics: new Set(output.metrics.map((_, i) => i)),
      eventTypes: new Set((output.eventTypes ?? []).map((_, i) => i)),
    };
  }

  function initPreviewVisualization(output: DecoderOutput): void {
    if (previewShown) return;
    previewShown = true;
    store.previewingLoad = true;
    populateStore(output);
    store.timeOffset = 0;
    store.currentTime = 0;
    store.incState = createIncrementalState(
      output.header.nodes.length,
      output.metrics.length,
      output.arcLayers.length,
    );
    store.eventBuf = output.events.buf;
    store.eventCount = 0;
    store.timeIndex = [];
    store.eventIndex = buildEventIndex(output.events.buf, 0, output.header.nodes.length);
    store.originNode = -1;
    store.nodeMeta = null;

    if (!getDeck()) {
      const canvas = getEl<HTMLCanvasElement>('deck-canvas');
      initDeckGL(canvas);
    }
    getDeck()?.setProps({ onAfterRender: drawOverlayNow });

    emptyState.style.display = 'none';

    const aspect = mapContainer.clientWidth / (mapContainer.clientHeight || 1);
    store.topoGraph = buildTopologyGraph(output.header);
    store.nodePositions = computeLayout(
      output.header,
      output.events.buf,
      0,
      store.decodedStateIdx,
      'force',
      -1,
      aspect,
      store.topoGraph,
    );
    fitViewToNodes(mapContainer, store.nodePositions);
    updateAll();
  }

  function buildMessageDropdown(output: DecoderOutput) {
    const messages = output.messages ?? [];
    msgSelect.replaceChildren();
    for (const m of messages) {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.label || `${m.id} - ${formatMs(m.lastTs - m.firstTs)}`;
      msgSelect.appendChild(opt);
    }
    msgSelect.disabled = false;
    msgSelect.style.display = messages.length > 1 ? '' : 'none';
  }

  function initVisualization(output: DecoderOutput) {
    const nodeCount = output.header.nodes.length;
    const buf = output.events.buf;
    const count = output.events.count;

    if (!getDeck()) {
      const canvas = getEl<HTMLCanvasElement>('deck-canvas');
      initDeckGL(canvas);
    }
    getDeck()?.setProps({ onAfterRender: drawOverlayNow });

    emptyState.style.display = 'none';
    nodeLegend.classList.add('visible');
    store.previewingLoad = false;

    deps.renderCountryDist(output.header);
    deps.renderBwDist(output.header);
    rebuildLegend(output, store.originNode);

    // Timeline bounds: prefer milestone window, fall back to event range
    let tlMin: number;
    let tlMax: number;
    if (count > 0) {
      tlMin = buf[0];
      tlMax = buf[(count - 1) * EVENT_STRIDE];
    } else {
      tlMin = 0;
      tlMax = 0;
    }

    const milestones = output.milestones;
    const originMs = milestones.find(m => m.label.startsWith('Origin'));
    const lastDecodeMs = milestones.find(m => m.label.startsWith('Last'))
      ?? milestones.find(m => m.label.startsWith('1st'));
    if (originMs && lastDecodeMs) {
      tlMin = originMs.time;
      tlMax = lastDecodeMs.time;
    }

    store.timeOffset = tlMin;
    timeline.min = String(tlMin);
    timeline.max = String(tlMax);
    timeline.value = String(tlMin);
    timeline.disabled = false;
    btnPlay.disabled = false;
    btnReset.disabled = false;
    speedSelect.disabled = false;

    const aspect = mapContainer.clientWidth / (mapContainer.clientHeight || 1);
    store.topoGraph = buildTopologyGraph(output.header);
    store.nodePositions = computeLayout(
      output.header, buf, count, store.decodedStateIdx,
      store.layoutMode, store.originNode, aspect, store.topoGraph,
    );
    store.nodeMeta = computeNodeMetadata(
      output.header, buf, count, store.originNode, store.topoGraph,
    );

    store.currentTime = tlMin;
    store.playing = false;
    store.selectedNode = -1;
    btnPlay.textContent = 'Play';
    btnPlay.classList.remove('active');
    eventLogState.lastRenderedIdx = -1;
    eventLogList.replaceChildren();
    clearFilterBtn.style.display = 'none';

    store.incState = createIncrementalState(
      nodeCount, output.metrics.length, output.arcLayers.length,
    );

    deps.renderMilestones(milestones, tlMin, tlMax);

    const h2 = statsPanel.querySelector('h2');
    statsPanel.replaceChildren();
    if (h2) statsPanel.appendChild(h2);

    const statContent = document.createElement('div');
    statContent.id = 'stats-content';
    statsPanel.appendChild(statContent);
    const showProgress = output.events.count > 0 && (() => {
      for (let i = 0; i < output.events.count; i++) {
        if (buf[i * EVENT_STRIDE + 2] === OP_PROGRESS) return true;
      }
      return false;
    })();
    const statEls = buildStatElements(statContent, output.states, output.metrics, showProgress);
    deps.onStatEls(statEls);

    deps.rebuildSettings(output);

    const chartRange: [number, number] = [tlMin, tlMax];
    const chartData = computeChartData(
      buf, count, nodeCount, output.chartHints, chartRange,
    );
    store.chartControls = renderCharts(statsPanel, chartData);

    fitViewToNodes(mapContainer, store.nodePositions);
    deps.onLoad();
    updateAll();
  }

  getEl('load-example').addEventListener('click', async (e) => {
    e.preventDefault();
    latestLoadToken += 1;
    const loadToken = latestLoadToken;
    resetLoadingUi();
    fileName.textContent = 'example-trace.bctrace.gz';
    setLoadProgress('Downloading example trace...', 0);

    try {
      const resp = await fetch('/example-trace.bctrace.gz');
      if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`);
      const total = Number(resp.headers.get('content-length') || 0);
      const [progressStream, decompressStream] = resp.body.tee();

      // Track download progress on one branch
      const progressPromise = trackCompressedProgress(progressStream, total, loadToken);

      // Decompress and read text on the other
      const text = await readTextStream(
        decompressStream.pipeThrough(new DecompressionStream('gzip')),
        loadToken,
        (line) => {
          const preview = buildBundledDecoderPreview('ethp2p', JSON.parse(line) as Record<string, unknown>);
          if (preview) {
            setLoadProgress('Drawing initial graph...', 0.18);
            initPreviewVisualization(preview);
          }
        },
      );
      await progressPromise;
      if (loadToken !== latestLoadToken) return;

      rawLines = text.split('\n');
      resolvedDecoder = { kind: 'bundled', name: 'ethp2p' };
      setLoadProgress('Decoding...', 0.5);
      runDecode(rawLines, resolvedDecoder);
    } catch (err) {
      console.error('Failed to load example:', err);
      hideLoadProgress();
      alert('Failed to load example trace: ' + (err as Error).message);
    }
  });

  fileInput.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    fileName.textContent = file.name;
    latestLoadToken += 1;
    const loadToken = latestLoadToken;
    resetLoadingUi();
    setLoadProgress('Reading trace...', 0);

    try {
      const text = await readFileText(file, loadToken);
      if (loadToken !== latestLoadToken) return;
      setLoadProgress('Resolving decoder...', 0.48);
      rawLines = text.split('\n');
      const decoderName = extractDecoderName(rawLines);
      resolvedDecoder = await deps.picker.resolve(decoderName);
      if (loadToken !== latestLoadToken) return;
      runDecode(rawLines, resolvedDecoder);
    } catch (err) {
      console.error('Failed to load trace:', err);
      hideLoadProgress();
      alert('Failed to load trace file: ' + (err as Error).message);
    }
  });

  msgSelect.addEventListener('change', () => {
    if (!resolvedDecoder) return;
    store.playing = false;
    setLoadProgress('Decoding selected message...', undefined, true);
    runDecode(rawLines, resolvedDecoder, { messageId: msgSelect.value });
  });

  deps.picker.onSwitch = (decoder) => {
    if (rawLines.length === 0) return;
    resolvedDecoder = decoder;
    resetLoadingUi();
    setLoadProgress('Re-decoding with ' + decoder.name + '...', undefined, true);
    runDecode(rawLines, decoder);
  };

  async function readFileText(file: File, loadToken: number): Promise<string> {
    let headerParsed = false;

    const onHeaderLine = (line: string) => {
      if (headerParsed || loadToken !== latestLoadToken) return;
      headerParsed = true;
      let rawHeader: Record<string, unknown>;
      try {
        rawHeader = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      const decoderName = typeof rawHeader.decoderName === 'string' ? rawHeader.decoderName : undefined;
      if (!decoderName) return;
      const preview = buildBundledDecoderPreview(decoderName, rawHeader);
      if (!preview) return;
      setLoadProgress('Drawing initial graph...', 0.18);
      initPreviewVisualization(preview);
    };

    if (file.name.endsWith('.gz')) {
      const [progressStream, textStream] = file.stream().tee();
      const progressPromise = trackCompressedProgress(progressStream, file.size, loadToken);
      const text = await readTextStream(textStream.pipeThrough(new DecompressionStream('gzip')), loadToken, onHeaderLine);
      await progressPromise;
      return text;
    }

    return readTextStream(file.stream(), loadToken, onHeaderLine, file.size);
  }

  async function trackCompressedProgress(stream: ReadableStream<Uint8Array>, totalBytes: number, loadToken: number): Promise<void> {
    const reader = stream.getReader();
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done || value === undefined) break;
      loaded += value.byteLength;
      if (loadToken === latestLoadToken) {
        setLoadProgress('Decompressing trace...', 0.45 * (loaded / Math.max(1, totalBytes)));
      }
    }
  }

  async function readTextStream(
    stream: ReadableStream<Uint8Array>,
    loadToken: number,
    onHeaderLine: (line: string) => void,
    totalBytes?: number,
  ): Promise<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let loaded = 0;
    let headerBuffer = '';
    let headerDelivered = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done || value === undefined) break;
      loaded += value.byteLength;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk.length > 0) {
        parts.push(chunk);
        if (!headerDelivered) {
          headerBuffer += chunk;
          const newlineIdx = headerBuffer.indexOf('\n');
          if (newlineIdx >= 0) {
            headerDelivered = true;
            onHeaderLine(headerBuffer.slice(0, newlineIdx));
          }
        }
      }
      if (loadToken === latestLoadToken && totalBytes) {
        setLoadProgress('Reading trace...', 0.45 * (loaded / Math.max(1, totalBytes)));
      }
    }

    const tail = decoder.decode();
    if (tail.length > 0) {
      parts.push(tail);
      if (!headerDelivered) {
        headerBuffer += tail;
        const newlineIdx = headerBuffer.indexOf('\n');
        if (newlineIdx >= 0) {
          headerDelivered = true;
          onHeaderLine(headerBuffer.slice(0, newlineIdx));
        }
      }
    }

    return parts.join('');
  }
}
