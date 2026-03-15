import type { AppStore } from '../store';
import { getEl } from './dom';

export function initKeyboard(deps: {
  store: AppStore;
  updateAll: () => void;
  togglePlay: () => void;
  fitView: () => void;
  clearSelection: () => void;
}): void {
  const timeline = getEl<HTMLInputElement>('timeline');
  document.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
    switch (e.key) {
      case ' ':
        e.preventDefault();
        deps.togglePlay();
        break;
      case 'f':
        if (deps.store.decoderOutput) deps.fitView();
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (deps.store.decoderOutput && deps.store.incState) {
          deps.store.currentTime = Math.min(deps.store.currentTime + 100_000, parseInt(timeline.max, 10));
          deps.updateAll();
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (deps.store.decoderOutput && deps.store.incState) {
          deps.store.currentTime = Math.max(parseInt(timeline.min, 10), deps.store.currentTime - 100_000);
          deps.updateAll();
        }
        break;
      case 'Escape':
        if (deps.store.selectedNode >= 0) {
          deps.clearSelection();
        }
        break;
    }
  });
}
