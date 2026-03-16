import type { AppStore } from '../store';
import type { LayoutMode } from '../types';
import { computeLayout } from '../map/layout';
import { fitViewToNodes, setOrbitMode, isOrbitMode } from '../map/renderer';
import { getEl } from './dom';

export function initModeSwitcher(deps: {
  store: AppStore;
  updateAll: () => void;
}): void {
  const { store, updateAll } = deps;
  const modeSwitcher = getEl('mode-switcher');
  const mapContainer = getEl('map-container');

  modeSwitcher.addEventListener('click', (e) => {
    const tab = (e.target as HTMLElement).closest('.mode-tab') as HTMLElement | null;
    if (!tab) return;

    // 3D toggle: switches camera only, keeps current layout
    if (tab.dataset.mode === '3d') {
      const enabling = !isOrbitMode();
      setOrbitMode(enabling);
      tab.classList.toggle('active', enabling);
      fitViewToNodes(mapContainer, store.nodePositions);
      updateAll();
      return;
    }

    const mode = tab.dataset.mode as LayoutMode;
    if (mode === store.layoutMode) return;

    store.layoutMode = mode;

    for (const t of modeSwitcher.querySelectorAll('.mode-tab')) {
      if (t === tab || (t as HTMLElement).dataset.mode === '3d') continue;
      t.classList.toggle('active', (t as HTMLElement).dataset.mode === mode);
    }

    if (store.previewingLoad) return;

    if (store.decoderOutput && store.eventBuf) {
      const aspect = mapContainer.clientWidth / (mapContainer.clientHeight || 1);
      store.nodePositions = computeLayout(
        store.decoderOutput.header,
        store.eventBuf,
        store.eventCount,
        store.decodedStateIdx,
        store.layoutMode,
        store.originNode,
        aspect,
        store.topoGraph ?? undefined,
      );
      fitViewToNodes(mapContainer, store.nodePositions);
      updateAll();
    }
  });
}
