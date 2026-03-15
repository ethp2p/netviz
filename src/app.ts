import './style.css';
import { createStore } from './store';
import type { StatElements } from './ui/stats-panel';
import { updateStats } from './ui/stats-panel';
import { formatTime } from './format';
import { getEl } from './ui/dom';
import { createEventLogState, updateEventLog, rebuildEventLog, initEventsPanel } from './ui/events-panel';
import { initPlayback } from './ui/playback';
import { initFileLoader } from './ui/file-loader';
import { initKeyboard } from './ui/keyboard';
import { initSettings } from './ui/settings';
import { initModeSwitcher } from './ui/mode-switcher';
import { renderMilestones } from './ui/milestones-ui';
import { renderCountryDistribution, renderBandwidthDistribution } from './ui/distributions';
import { getOverlayMetricGroups } from './ui/overlay-groups';
import { getDeck, buildLayers, fitViewToNodes } from './map/renderer';
import { drawOverlay } from './map/overlay';
import { upperBound } from './trace';
import { advanceStateTo, restoreCheckpoint, resetIncrementalState } from './state';
import { P } from './types';

const mapContainer = getEl('map-container');
const timeDisplay = getEl('time-display');
const timeline = getEl<HTMLInputElement>('timeline');
const tlTime = getEl('tl-time');
const tooltipEl = getEl('tooltip');
const clearFilterBtn = getEl('clear-filter');
const ringCanvas = getEl<HTMLCanvasElement>('ring-canvas');
const ringCtx = ringCanvas.getContext('2d');
if (!ringCtx) throw new Error('Failed to get 2d context from ring-canvas');

const store = createStore();
let statEls: StatElements | null = null;
const eventLogState = createEventLogState(getEl('event-log-list'));

function renderLayers() {
  const dk = getDeck();
  const output = store.decoderOutput;
  if (!dk || !output || !store.incState) return;
  const renderMode = store.previewingLoad ? 'force' : store.layoutMode;
  dk.setProps({
    layers: buildLayers(
      output.header,
      store.nodePositions,
      store.incState.nodeStates,
      store.incState.arcBuckets,
      output.arcLayers,
      store.currentTime,
      store.selectedNode,
      store.originNode,
      store.nodeColors,
      P.origin.rgba,
      (idx) => {
        store.nodeClickHandled = true;
        store.selectedNode = (store.selectedNode === idx) ? -1 : idx;
        clearFilterBtn.style.display = store.selectedNode >= 0 ? 'inline' : 'none';
        eventLogState.lastRenderedIdx = -1;
        if (store.eventBuf) {
          const endIdx = upperBound(store.timeIndex, store.currentTime);
          rebuildEventLog(
            eventLogState, store.eventBuf, endIdx, store.selectedNode,
            store.eventFilter, store.eventIndex, store.logTexts,
            output.states, output.arcLayers, output.metrics,
            output.eventTypes, output.events.eventTypeIdxs, output.events.peerNodeIdxs,
            store.timeOffset,
          );
        }
        renderLayers();
      },
      (idx) => {
        if (store.hoveredNode !== idx) {
          store.hoveredNode = idx;
          renderLayers();
        }
      },
      tooltipEl,
      renderMode,
      store.nodeMeta,
      store.hoveredNode,
      output.states,
      output.metrics,
    ),
  });
}

function drawOverlayNow() {
  const output = store.decoderOutput;
  if (!output || !store.incState || !ringCtx) return;
  if (store.previewingLoad) {
    ringCtx.clearRect(0, 0, ringCtx.canvas.width, ringCtx.canvas.height);
    return;
  }

  const overlayMetricGroups = getOverlayMetricGroups(output.metrics);
  const overlayMetricColors = overlayMetricGroups.map(
    group => (group.color ?? [160, 160, 160, 255]) as [number, number, number, number],
  );

  const nodeNames = output.header.nodes.map(n => n.name);

  drawOverlay(
    ringCtx,
    store.nodePositions,
    store.incState.nodeStates,
    store.overlayMaxes,
    overlayMetricGroups.map(group => group.metricIndices),
    store.graphSettings.ringToggles,
    overlayMetricColors,
    output.header.nodes.length,
    store.hoverHighlight,
    store.previewingLoad ? 'force' : store.layoutMode,
    store.nodeColors,
    nodeNames,
  );
}

function updateAll() {
  const output = store.decoderOutput;
  if (!output || !store.incState || !store.eventBuf) return;

  const endIdx = upperBound(store.timeIndex, store.currentTime);

  if (endIdx <= store.incState.lastComputedIdx) {
    if (!restoreCheckpoint(store.incState, endIdx)) {
      resetIncrementalState(
        store.incState,
        output.header.nodes.length,
        output.metrics.length,
        output.arcLayers.length,
      );
    }
  }

  advanceStateTo(
    store.incState, store.currentTime, endIdx, store.eventBuf,
    output.arcLayers, store.enabledArcLayers, output.metrics, store.overlayMaxes,
  );
  renderLayers();
  if (statEls) {
    updateStats(statEls, store.incState.nodeStates, store.incState.globalStats, output.states, output.metrics);
  }
  updateEventLog(
    eventLogState, store.eventBuf, endIdx, store.selectedNode,
    store.eventFilter, store.playing, store.eventIndex, store.logTexts,
    output.states, output.arcLayers, output.metrics,
    output.eventTypes, output.events.eventTypeIdxs, output.events.peerNodeIdxs,
    store.timeOffset,
  );

  timeDisplay.textContent = 't = ' + formatTime(store.currentTime - store.timeOffset);
  timeline.value = String(store.currentTime);
  tlTime.textContent = 't = ' + formatTime(store.currentTime - store.timeOffset);

  if (store.chartControls) store.chartControls.updateTime(store.currentTime);
}

function clearSelection() {
  store.selectedNode = -1;
  clearFilterBtn.style.display = 'none';
  eventLogState.lastRenderedIdx = -1;
  if (store.eventBuf && store.decoderOutput) {
    const output = store.decoderOutput;
    const endIdx = upperBound(store.timeIndex, store.currentTime);
    rebuildEventLog(
      eventLogState, store.eventBuf, endIdx, store.selectedNode,
      store.eventFilter, store.eventIndex, store.logTexts,
      output.states, output.arcLayers, output.metrics,
      output.eventTypes, output.events.eventTypeIdxs, output.events.peerNodeIdxs,
      store.timeOffset,
    );
  }
  renderLayers();
}

// Init UI modules (one-time listener setup; content rebuilt on each decode)
const playback = initPlayback({ store, eventLogState, updateAll });
const eventsPanel = initEventsPanel({ store, eventLogState, drawOverlayNow, renderLayers });
const settings = initSettings({ store, drawOverlayNow, renderLayers });
initFileLoader({
  store,
  eventLogState,
  updateAll,
  renderCountryDist: renderCountryDistribution,
  renderBwDist: renderBandwidthDistribution,
  renderMilestones: (milestones, min, max) =>
    renderMilestones(milestones, min, max, store.timeOffset, (time) => { store.currentTime = time; updateAll(); }),
  drawOverlayNow,
  rebuildSettings: (output) => settings.rebuild(output),
  onStatEls: (els) => { statEls = els; },
  onLoad: () => { eventsPanel.rebuildFilter(); },
});
initKeyboard({
  store,
  updateAll,
  togglePlay: playback.togglePlay,
  fitView: () => fitViewToNodes(mapContainer, store.nodePositions),
  clearSelection,
});
initModeSwitcher({ store, updateAll });

// Background click on map clears node filter
const deckCanvas = getEl('deck-canvas');
deckCanvas.addEventListener('click', () => {
  if (store.nodeClickHandled) {
    store.nodeClickHandled = false;
    return;
  }
  if (!store.decoderOutput || store.selectedNode < 0) return;
  clearSelection();
});
