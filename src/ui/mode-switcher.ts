import type { AppStore } from '../store';
import type { LayoutMode } from '../types';
import { computeLayout } from '../map/layout';
import { fitViewToNodes, setOrbitMode } from '../map/renderer';
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
    const mode = tab.dataset.mode as LayoutMode;
    if (mode === store.layoutMode) return;

    store.layoutMode = mode;
    setOrbitMode(mode === 'force3d');

    for (const t of modeSwitcher.querySelectorAll('.mode-tab')) {
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
      if (mode === 'force3d') {
        const zs = store.nodePositions.map(p => p[2]);
        console.log('3D positions z range:', Math.min(...zs), 'to', Math.max(...zs));
        console.log('sample positions:', store.nodePositions.slice(0, 3));
      }
      fitViewToNodes(mapContainer, store.nodePositions);
      updateAll();
    }
  });
}
