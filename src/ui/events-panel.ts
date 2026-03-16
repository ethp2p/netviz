import type { StateDef, ArcLayerDef, MetricDef, EventFilter, EventTypeDef, RGBA } from '../decoder-sdk';
import {
  EVENT_STRIDE, OP_STATE, OP_TRANSFER, OP_PROGRESS, OP_METRIC, OP_LINK, OP_LOG,
  oklch, hex,
} from '../decoder-sdk';
import type { EventIndex } from '../trace';
import { countBefore, upperBound } from '../trace';
import { formatTime, toCss } from '../format';
import { getEl } from './dom';
import type { AppStore } from '../store';

const OPCODE_LABELS = ['S', 'T', 'P', 'M', 'L', 'G'];
const OPCODE_NAMES = ['State', 'Transfer', 'Progress', 'Metric', 'Link', 'Log'];
const OPCODE_COLORS: RGBA[] = [
  oklch(0.75, 0.14, 155), // State (decoded green)
  oklch(0.72, 0.12, 230), // Transfer (receiving)
  oklch(0.65, 0.10, 280), // Progress (routing)
  oklch(0.72, 0.14, 60),  // Metric (useless)
  oklch(0.55, 0.03, 250), // Link (slate)
  hex('#a8a29e'),          // Log (text2)
];
const NUM_OPCODES = 6;

export interface EventLogState {
  list: HTMLElement;
  lastRenderedIdx: number;
}

export function createEventLogState(list: HTMLElement): EventLogState {
  return { list, lastRenderedIdx: -1 };
}

const MAX_VISIBLE = 500;

function passesFilter(
  buf: Float64Array,
  eventIdx: number,
  selectedNode: number,
  filter: EventFilter,
  clipStart: number,
  eventTypeIdxs?: Int16Array,
): boolean {
  const base = eventIdx * EVENT_STRIDE;
  if (buf[base] < clipStart) return false;
  if (selectedNode >= 0 && buf[base + 1] !== selectedNode) return false;
  if (eventTypeIdxs) {
    const eventTypeIdx = eventTypeIdxs[eventIdx];
    return eventTypeIdx >= 0 && filter.eventTypes.has(eventTypeIdx);
  }
  const op = buf[base + 2];
  if (!filter.opcodes.has(op)) return false;
  if (op === OP_TRANSFER && !filter.arcLayers.has(buf[base + 5])) return false;
  if (op === OP_METRIC && !filter.metrics.has(buf[base + 3])) return false;
  return true;
}

export function updateEventLog(
  state: EventLogState,
  buf: Float64Array,
  endIdx: number,
  selectedNode: number,
  filter: EventFilter,
  playing: boolean,
  index: EventIndex | null,
  logTexts: string[],
  states: StateDef[],
  arcLayers: ArcLayerDef[],
  metrics: MetricDef[],
  eventTypes?: EventTypeDef[],
  eventTypeIdxs?: Int16Array,
  peerNodeIdxs?: Int32Array,
  tOffset = 0,
): void {
  if (endIdx <= state.lastRenderedIdx + 1 && state.lastRenderedIdx >= 0) {
    if (playing) scrollToBottom(state.list);
    return;
  }

  if (endIdx < state.lastRenderedIdx) {
    rebuildEventLog(
      state, buf, endIdx, selectedNode, filter, index, logTexts, states, arcLayers, metrics,
      eventTypes, eventTypeIdxs, peerNodeIdxs, tOffset,
    );
    return;
  }

  // Cap the scan to the last MAX_VISIBLE raw events for performance at high
  // playback speeds. Events in the skipped range are already in the DOM from
  // prior frames.
  const startFrom = Math.max(state.lastRenderedIdx + 1, endIdx - MAX_VISIBLE);

  const frag = document.createDocumentFragment();
  for (let i = startFrom; i < endIdx; i++) {
    if (!passesFilter(buf, i, selectedNode, filter, tOffset, eventTypeIdxs)) continue;
    frag.appendChild(createEventEntry(
      buf, i, tOffset, logTexts, states, arcLayers, metrics,
      eventTypes, eventTypeIdxs, peerNodeIdxs,
    ));
  }
  state.list.appendChild(frag);

  while (state.list.childElementCount > MAX_VISIBLE) {
    state.list.removeChild(state.list.firstChild!);
  }

  state.lastRenderedIdx = endIdx - 1;

  if (playing) {
    scrollToBottom(state.list);
  }
}

export function rebuildEventLog(
  state: EventLogState,
  buf: Float64Array,
  endIdx: number,
  selectedNode: number,
  filter: EventFilter,
  index: EventIndex | null,
  logTexts: string[],
  states: StateDef[],
  arcLayers: ArcLayerDef[],
  metrics: MetricDef[],
  eventTypes?: EventTypeDef[],
  eventTypeIdxs?: Int16Array,
  peerNodeIdxs?: Int32Array,
  tOffset = 0,
): void {
  state.list.replaceChildren();

  const collected: number[] = [];

  if (selectedNode >= 0 && index) {
    const nodeEvents = index.byNode[selectedNode];
    if (nodeEvents) {
      let pos = countBefore(nodeEvents, endIdx) - 1;
      while (pos >= 0 && collected.length < MAX_VISIBLE) {
        const ei = nodeEvents[pos];
        const base = ei * EVENT_STRIDE;
        const ts = buf[base];
        if (ts >= tOffset && passesFilter(buf, ei, selectedNode, filter, tOffset, eventTypeIdxs)) {
          collected.push(ei);
        }
        pos--;
      }
    }
  } else {
    for (let i = endIdx - 1; i >= 0 && collected.length < MAX_VISIBLE; i--) {
      const base = i * EVENT_STRIDE;
      if (buf[base] < tOffset) break;
      if (!passesFilter(buf, i, selectedNode, filter, tOffset, eventTypeIdxs)) continue;
      collected.push(i);
    }
  }

  collected.reverse();

  const frag = document.createDocumentFragment();
  for (const ei of collected) {
    frag.appendChild(createEventEntry(
      buf, ei, tOffset, logTexts, states, arcLayers, metrics,
      eventTypes, eventTypeIdxs, peerNodeIdxs,
    ));
  }
  state.list.appendChild(frag);
  state.lastRenderedIdx = endIdx - 1;
  scrollToBottom(state.list);
}

function appendEventSpans(
  div: HTMLDivElement,
  ts: string,
  node: string,
  typeCode: string,
  typeColor: RGBA | undefined,
  detail: string,
): void {
  const tsEl = document.createElement('span');
  tsEl.className = 'ev-ts';
  tsEl.textContent = ts;

  const nodeEl = document.createElement('span');
  nodeEl.className = 'ev-node';
  nodeEl.textContent = node;

  const typeEl = document.createElement('span');
  typeEl.className = 'ev-type';
  typeEl.textContent = typeCode;
  const colorStr = toCss(typeColor);
  if (colorStr) typeEl.style.color = colorStr;

  const detailEl = document.createElement('span');
  detailEl.className = 'ev-detail';
  detailEl.textContent = detail;

  div.appendChild(tsEl);
  div.appendChild(nodeEl);
  div.appendChild(typeEl);
  div.appendChild(detailEl);
}

function createEventEntry(
  buf: Float64Array,
  eventIdx: number,
  tOffset: number,
  logTexts: string[],
  states: StateDef[],
  arcLayers: ArcLayerDef[],
  metrics: MetricDef[],
  eventTypes?: EventTypeDef[],
  eventTypeIdxs?: Int16Array,
  peerNodeIdxs?: Int32Array,
): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'ev-entry';

  const base = eventIdx * EVENT_STRIDE;
  const ts = buf[base];
  const nodeIdx = buf[base + 1] | 0;
  const op = buf[base + 2] | 0;

  div.dataset.node = String(nodeIdx);

  if (eventTypes && eventTypeIdxs) {
    const eventTypeIdx = eventTypeIdxs[eventIdx];
    const eventType = eventTypes[eventTypeIdx];
    const peerNodeIdx = peerNodeIdxs?.[eventIdx] ?? -1;
    if (peerNodeIdx >= 0) div.dataset.peer = String(peerNodeIdx);
    const detail = op === OP_LOG ? (logTexts[buf[base + 3] | 0] ?? '') : formatEventDetail(buf, base, states, arcLayers, metrics, logTexts);
    const typeCode = eventType?.code ?? String(eventTypeIdx);
    appendEventSpans(div, formatTime(ts - tOffset), 'n' + nodeIdx, typeCode, eventType?.color, detail);
    return div;
  }

  // OP_TRANSFER and OP_LINK have a peer index in field 3 in generic mode.
  if (op === OP_TRANSFER || op === OP_LINK) {
    div.dataset.peer = String(buf[base + 3] | 0);
  }

  const label = OPCODE_LABELS[op] ?? String(op);
  const detail = formatEventDetail(buf, base, states, arcLayers, metrics, logTexts);
  appendEventSpans(div, formatTime(ts - tOffset), 'n' + nodeIdx, label, OPCODE_COLORS[op], detail);

  return div;
}

function formatEventDetail(
  buf: Float64Array,
  base: number,
  states: StateDef[],
  arcLayers: ArcLayerDef[],
  metrics: MetricDef[],
  logTexts: string[],
): string {
  const op = buf[base + 2] | 0;
  const f0 = buf[base + 3] | 0;
  const f1 = buf[base + 4];
  const f2 = buf[base + 5] | 0;

  switch (op) {
    case OP_STATE: {
      const name = states[f0]?.name ?? String(f0);
      return '-> ' + name;
    }
    case OP_TRANSFER: {
      const layerName = arcLayers[f2]?.name ?? String(f2);
      return 'sent ' + Math.round(f1) + 'B to n' + f0 + ' (' + layerName + ')';
    }
    case OP_PROGRESS:
      return f0 + '/' + Math.round(f1) + ' chunks';
    case OP_METRIC: {
      const metricName = metrics[f0]?.name ?? String(f0);
      return metricName + ': ' + f1;
    }
    case OP_LINK:
      return 'link ' + (f1 ? 'up' : 'down') + ' n' + f0;
    case OP_LOG:
      return logTexts[f0] ?? '';
    default:
      return '';
  }
}

function scrollToBottom(el: HTMLElement): void {
  requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}

export function initEventsPanel(deps: {
  store: AppStore;
  eventLogState: EventLogState;
  drawOverlayNow: () => void;
  renderLayers: () => void;
}): { rebuildFilter: () => void } {
  const { store, eventLogState, drawOverlayNow, renderLayers } = deps;
  const eventTypeFilter = getEl('event-type-filter');
  const eventLogList = getEl('event-log-list');
  const clearFilterBtn = getEl('clear-filter');

  let hoveredEntry: HTMLElement | null = null;

  function getDecoderDefs() {
    const output = store.decoderOutput;
    return {
      states: output?.states ?? [],
      arcLayers: output?.arcLayers ?? [],
      metrics: output?.metrics ?? [],
      eventTypes: output?.eventTypes,
      eventTypeIdxs: output?.events.eventTypeIdxs,
      peerNodeIdxs: output?.events.peerNodeIdxs,
      logTexts: store.logTexts,
    };
  }

  function rebuildCurrentLog(): void {
    if (!store.eventBuf) return;
    const defs = getDecoderDefs();
    const endIdx = upperBound(store.timeIndex, store.currentTime);
    rebuildEventLog(
      eventLogState, store.eventBuf, endIdx, store.selectedNode,
      store.eventFilter, store.eventIndex, defs.logTexts,
      defs.states, defs.arcLayers, defs.metrics,
      defs.eventTypes, defs.eventTypeIdxs, defs.peerNodeIdxs,
      store.timeOffset,
    );
  }

  function buildEventTypeFilter() {
    eventTypeFilter.replaceChildren();

    const actions = document.createElement('span');
    actions.className = 'etf-actions';

    const allBtn = document.createElement('button');
    allBtn.className = 'etf-action';
    allBtn.textContent = 'All';

    const noneBtn = document.createElement('button');
    noneBtn.className = 'etf-action';
    noneBtn.textContent = 'None';

    actions.appendChild(allBtn);
    actions.appendChild(noneBtn);
    eventTypeFilter.appendChild(actions);

    const defs = getDecoderDefs();
    if (defs.eventTypes && defs.eventTypes.length > 0) {
      allBtn.addEventListener('click', () => {
        for (let i = 0; i < defs.eventTypes!.length; i++) store.eventFilter.eventTypes.add(i);
        applyFilterAndRebuildLog();
      });
      noneBtn.addEventListener('click', () => {
        store.eventFilter.eventTypes.clear();
        applyFilterAndRebuildLog();
      });

      defs.eventTypes.forEach((eventType, index) => {
        const tag = document.createElement('span');
        tag.className = 'etf-tag';
        tag.dataset.eventType = String(index);
        tag.textContent = eventType.code;
        tag.title = eventType.name;
        tag.style.color = toCss(eventType.color) ?? 'var(--text2)';
        tag.style.borderColor = toCss(eventType.color) ?? 'var(--border)';
        if (!store.eventFilter.eventTypes.has(index)) tag.classList.add('off');
        tag.addEventListener('click', (e) => {
          if (e.altKey || e.metaKey) {
            store.eventFilter.eventTypes.clear();
            store.eventFilter.eventTypes.add(index);
          } else if (store.eventFilter.eventTypes.has(index)) {
            store.eventFilter.eventTypes.delete(index);
          } else {
            store.eventFilter.eventTypes.add(index);
          }
          applyFilterAndRebuildLog();
        });
        eventTypeFilter.appendChild(tag);
      });
      return;
    }

    allBtn.addEventListener('click', () => {
      for (let i = 0; i < NUM_OPCODES; i++) store.eventFilter.opcodes.add(i);
      for (let i = 0; i < defs.arcLayers.length; i++) store.eventFilter.arcLayers.add(i);
      for (let i = 0; i < defs.metrics.length; i++) store.eventFilter.metrics.add(i);
      applyFilterAndRebuildLog();
    });
    noneBtn.addEventListener('click', () => {
      store.eventFilter.opcodes.clear();
      store.eventFilter.arcLayers.clear();
      store.eventFilter.metrics.clear();
      applyFilterAndRebuildLog();
    });

    for (let op = 0; op < NUM_OPCODES; op++) {
      const tag = document.createElement('span');
      tag.className = 'etf-tag';
      tag.dataset.opcode = String(op);
      tag.textContent = OPCODE_LABELS[op];
      tag.title = OPCODE_NAMES[op];
      tag.style.color = toCss(OPCODE_COLORS[op]) ?? 'var(--text2)';
      tag.style.borderColor = toCss(OPCODE_COLORS[op]) ?? 'var(--border)';

      if (!store.eventFilter.opcodes.has(op)) tag.classList.add('off');

      tag.addEventListener('click', (e) => {
        if (e.altKey || e.metaKey) {
          store.eventFilter.opcodes.clear();
          store.eventFilter.opcodes.add(op);
        } else {
          if (store.eventFilter.opcodes.has(op)) {
            store.eventFilter.opcodes.delete(op);
          } else {
            store.eventFilter.opcodes.add(op);
          }
        }
        applyFilterAndRebuildLog();
      });

      eventTypeFilter.appendChild(tag);

      // Sub-toggles for Transfer: per-arc-layer
      if (op === OP_TRANSFER && defs.arcLayers.length > 0) {
        for (let li = 0; li < defs.arcLayers.length; li++) {
          const sub = document.createElement('span');
          sub.className = 'etf-tag etf-sub';
          sub.dataset.arcLayer = String(li);
          sub.textContent = defs.arcLayers[li].name;
          sub.title = 'Arc layer: ' + defs.arcLayers[li].name;
          if (!store.eventFilter.arcLayers.has(li)) sub.classList.add('off');
          const layerIdx = li;
          sub.addEventListener('click', () => {
            if (store.eventFilter.arcLayers.has(layerIdx)) {
              store.eventFilter.arcLayers.delete(layerIdx);
            } else {
              store.eventFilter.arcLayers.add(layerIdx);
            }
            applyFilterAndRebuildLog();
          });
          eventTypeFilter.appendChild(sub);
        }
      }

      // Sub-toggles for Metric: per-metric
      if (op === OP_METRIC && defs.metrics.length > 0) {
        for (let mi = 0; mi < defs.metrics.length; mi++) {
          const sub = document.createElement('span');
          sub.className = 'etf-tag etf-sub';
          sub.dataset.metric = String(mi);
          sub.textContent = defs.metrics[mi].name;
          sub.title = 'Metric: ' + defs.metrics[mi].name;
          if (!store.eventFilter.metrics.has(mi)) sub.classList.add('off');
          const metricIdx = mi;
          sub.addEventListener('click', () => {
            if (store.eventFilter.metrics.has(metricIdx)) {
              store.eventFilter.metrics.delete(metricIdx);
            } else {
              store.eventFilter.metrics.add(metricIdx);
            }
            applyFilterAndRebuildLog();
          });
          eventTypeFilter.appendChild(sub);
        }
      }
    }
  }

  function applyFilterAndRebuildLog() {
    const eventTypeTags = eventTypeFilter.querySelectorAll('.etf-tag[data-event-type]');
    if (eventTypeTags.length > 0) {
      for (const tag of eventTypeTags) {
        const eventTypeIdx = parseInt((tag as HTMLElement).dataset.eventType!, 10);
        tag.classList.toggle('off', !store.eventFilter.eventTypes.has(eventTypeIdx));
      }
      eventLogState.lastRenderedIdx = -1;
      rebuildCurrentLog();
      return;
    }

    // Sync opcode tags
    const tags = eventTypeFilter.querySelectorAll('.etf-tag[data-opcode]');
    for (const tag of tags) {
      const op = parseInt((tag as HTMLElement).dataset.opcode!, 10);
      tag.classList.toggle('off', !store.eventFilter.opcodes.has(op));
    }
    // Sync arc layer sub-tags
    const arcTags = eventTypeFilter.querySelectorAll('.etf-tag[data-arc-layer]');
    for (const tag of arcTags) {
      const li = parseInt((tag as HTMLElement).dataset.arcLayer!, 10);
      tag.classList.toggle('off', !store.eventFilter.arcLayers.has(li));
    }
    // Sync metric sub-tags
    const metricTags = eventTypeFilter.querySelectorAll('.etf-tag[data-metric]');
    for (const tag of metricTags) {
      const mi = parseInt((tag as HTMLElement).dataset.metric!, 10);
      tag.classList.toggle('off', !store.eventFilter.metrics.has(mi));
    }

    eventLogState.lastRenderedIdx = -1;
    rebuildCurrentLog();
  }

  buildEventTypeFilter();

  clearFilterBtn.addEventListener('click', () => {
    store.selectedNode = -1;
    clearFilterBtn.style.display = 'none';
    eventLogState.lastRenderedIdx = -1;
    rebuildCurrentLog();
    renderLayers();
  });

  eventLogList.addEventListener('mouseover', (e) => {
    const entry = (e.target as HTMLElement).closest('.ev-entry') as HTMLElement | null;
    if (!entry || entry === hoveredEntry) return;
    hoveredEntry = entry;
    const nodeIdx = parseInt(entry.dataset.node!, 10);
    const peerStr = entry.dataset.peer;
    const peerIdx = peerStr !== undefined ? parseInt(peerStr, 10) : -1;
    store.hoverHighlight = { nodeIdx, peerIdx };
    drawOverlayNow();
  });
  eventLogList.addEventListener('mouseleave', () => {
    hoveredEntry = null;
    store.hoverHighlight = null;
    drawOverlayNow();
  });

  return { rebuildFilter: buildEventTypeFilter };
}
