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
  const speedInput = getEl<HTMLInputElement>('speed-input');
  const timeline = getEl<HTMLInputElement>('timeline');
  const iconPlay = getEl('icon-play');
  const iconPause = getEl('icon-pause');
  let lastFrameTs = 0;

  function updatePlayIcon() {
    iconPlay.style.display = store.playing ? 'none' : '';
    iconPause.style.display = store.playing ? '' : 'none';
  }

  function formatSpeed(value: number): string {
    if (value >= 100) return Math.round(value) + 'x';
    if (value >= 10) return value.toFixed(1) + 'x';
    if (value >= 1) return value.toFixed(1) + 'x';
    return value.toFixed(2) + 'x';
  }

  function setSpeed(speed: number) {
    speed = Math.max(0.01, speed);
    store.speed = speed;
    speedInput.value = formatSpeed(speed);
  }

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
    updatePlayIcon();
    btnPlay.classList.toggle('active', store.playing);
    if (store.playing) {
      lastFrameTs = performance.now();
      requestAnimationFrame(tick);
    }
  }

  function resetPlayback() {
    if (!store.decoderOutput || !store.incState) return;
    store.playing = false;
    updatePlayIcon();
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
      updatePlayIcon();
      btnPlay.classList.remove('active');
    }

    updateAll();

    if (store.playing) {
      requestAnimationFrame(tick);
    }
  }

  btnPlay.addEventListener('click', togglePlay);
  btnReset.addEventListener('click', resetPlayback);
  function applySpeedInput() {
    const parsed = parseFloat(speedInput.value.replace('x', ''));
    if (!isNaN(parsed) && parsed > 0) {
      setSpeed(parsed);
    } else {
      speedInput.value = formatSpeed(store.speed);
    }
  }
  speedInput.addEventListener('change', applySpeedInput);
  speedInput.addEventListener('input', () => {
    // Datalist selection fires input with a complete value
    if (speedInput.value.endsWith('x')) applySpeedInput();
  });
  speedInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { applySpeedInput(); speedInput.blur(); }
  });
  speedInput.addEventListener('focus', () => {
    speedInput.dataset.prev = speedInput.value;
    speedInput.value = '';
  });
  speedInput.addEventListener('blur', () => {
    if (speedInput.value === '') {
      speedInput.value = speedInput.dataset.prev ?? formatSpeed(store.speed);
    }
  });
  timeline.addEventListener('input', () => { store.currentTime = parseInt(timeline.value, 10); updateAll(); });

  return { togglePlay };
}
