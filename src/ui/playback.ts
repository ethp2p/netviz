import type { AppStore } from '../store';
import type { EventLogState } from './events-panel';
import { resetIncrementalState } from '../state';
import { getEl } from './dom';

interface PlaybackControls {
  togglePlay: () => void;
}

export function initPlayback(deps: {
  store: AppStore;
  eventLogState: EventLogState;
  updateAll: () => void;
}): PlaybackControls {
  const { store, eventLogState, updateAll } = deps;
  const btnPlay = getEl<HTMLButtonElement>('btn-play');
  const btnReset = getEl<HTMLButtonElement>('btn-reset');
  const speedSelect = getEl<HTMLSelectElement>('speed-select');
  const timeline = getEl<HTMLInputElement>('timeline');
  let lastFrameTs = 0;

  function togglePlay() {
    if (!store.decoderOutput || !store.incState) return;
    const minTime = parseInt(timeline.min, 10);
    const maxTime = parseInt(timeline.max, 10);
    if (!store.playing && store.currentTime >= maxTime) {
      store.currentTime = minTime;
      const nodeCount = store.decoderOutput.header.nodes.length;
      const metricCount = store.decoderOutput.metrics.length;
      const arcLayerCount = store.decoderOutput.arcLayers.length;
      resetIncrementalState(store.incState, nodeCount, metricCount, arcLayerCount);
      eventLogState.lastRenderedIdx = -1;
      eventLogState.list.replaceChildren();
    }
    store.playing = !store.playing;
    btnPlay.textContent = store.playing ? 'Pause' : 'Play';
    btnPlay.classList.toggle('active', store.playing);
    if (store.playing) {
      lastFrameTs = performance.now();
      requestAnimationFrame(tick);
    }
  }

  function resetPlayback() {
    if (!store.decoderOutput || !store.incState) return;
    store.playing = false;
    btnPlay.textContent = 'Play';
    btnPlay.classList.remove('active');
    store.currentTime = parseInt(timeline.min, 10);
    const nodeCount = store.decoderOutput.header.nodes.length;
    const metricCount = store.decoderOutput.metrics.length;
    const arcLayerCount = store.decoderOutput.arcLayers.length;
    resetIncrementalState(store.incState, nodeCount, metricCount, arcLayerCount);
    eventLogState.lastRenderedIdx = -1;
    eventLogState.list.replaceChildren();
    updateAll();
  }

  function tick(now: number) {
    if (!store.playing || !store.decoderOutput) return;

    const dt = now - lastFrameTs;
    lastFrameTs = now;

    store.currentTime += dt * 1000 * store.speed;

    const maxTime = parseInt(timeline.max, 10);
    if (store.currentTime >= maxTime) {
      store.currentTime = maxTime;
      store.playing = false;
      btnPlay.textContent = 'Play';
      btnPlay.classList.remove('active');
    }

    updateAll();

    if (store.playing) {
      requestAnimationFrame(tick);
    }
  }

  btnPlay.addEventListener('click', togglePlay);
  btnReset.addEventListener('click', resetPlayback);
  speedSelect.addEventListener('change', () => { store.speed = parseFloat(speedSelect.value); });
  timeline.addEventListener('input', () => { store.currentTime = parseInt(timeline.value, 10); updateAll(); });

  return { togglePlay };
}
