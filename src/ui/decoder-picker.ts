import { getEl } from './dom';
import { listBundledDecoders } from '../decoders/registry';
import { getAllDecoders, saveDecoder, removeDecoder } from './decoder-db';
import { resolveDecoder } from './decoder-resolve';
import type { ResolvedDecoder } from './decoder-resolve';
import type { SavedDecoder } from './decoder-db';

export type { ResolvedDecoder } from './decoder-resolve';

export interface DecoderPicker {
  resolve(decoderName: string | undefined): Promise<ResolvedDecoder>;
  onSwitch: ((decoder: ResolvedDecoder) => void) | null;
}

export async function initDecoderPicker(): Promise<DecoderPicker> {
  const pickerEl = getEl('decoder-picker');
  const btnEl = getEl<HTMLButtonElement>('decoder-btn');
  const dropdownEl = getEl('decoder-dropdown');
  const bundledListEl = getEl('dd-bundled');
  const userListEl = getEl('dd-user');
  const loadInput = getEl<HTMLInputElement>('dd-load-input');
  const errorEl = getEl('dd-error');

  const bundledNames = listBundledDecoders();
  let userDecoders: SavedDecoder[] = [];
  let activeDecoder: ResolvedDecoder | null = null;
  let pendingResolve: ((decoder: ResolvedDecoder) => void) | null = null;

  const picker: DecoderPicker = {
    onSwitch: null,

    async resolve(decoderName) {
      await loadUserDecoders();
      const result = resolveDecoder(decoderName, bundledNames, userDecoders);
      if (result) {
        activeDecoder = result;
        hide();
        return result;
      }
      return showAndWait();
    },
  };

  async function loadUserDecoders() {
    try {
      userDecoders = await getAllDecoders();
    } catch {
      userDecoders = [];
    }
  }

  function showAndWait(): Promise<ResolvedDecoder> {
    return new Promise(resolve => {
      pendingResolve = resolve;
      show();
      pickerEl.classList.add('prompt');
      btnEl.textContent = 'Choose decoder';
      rebuildDropdown();
      dropdownEl.classList.add('open');
    });
  }

  function selectDecoder(decoder: ResolvedDecoder) {
    activeDecoder = decoder;
    pickerEl.classList.remove('prompt');
    updateButtonLabel();
    closeDropdown();

    if (pendingResolve) {
      const resolve = pendingResolve;
      pendingResolve = null;
      resolve(decoder);
    } else {
      picker.onSwitch?.(decoder);
    }
  }

  function show() {
    pickerEl.style.display = '';
  }

  function hide() {
    pickerEl.style.display = 'none';
    closeDropdown();
  }

  function updateButtonLabel() {
    if (!activeDecoder) {
      btnEl.textContent = 'Decoder';
      return;
    }
    btnEl.innerHTML = '';
    btnEl.appendChild(document.createTextNode(activeDecoder.name));
    if (activeDecoder.kind === 'user') {
      const badge = document.createElement('span');
      badge.className = 'dd-custom-badge';
      badge.textContent = 'custom';
      btnEl.appendChild(badge);
    }
  }

  function closeDropdown() {
    dropdownEl.classList.remove('open');
  }

  function toggleDropdown() {
    const isOpen = dropdownEl.classList.toggle('open');
    if (isOpen) rebuildDropdown();
  }

  function rebuildDropdown() {
    bundledListEl.replaceChildren();
    userListEl.replaceChildren();
    errorEl.classList.remove('visible');
    errorEl.textContent = '';

    if (bundledNames.length > 0) {
      const label = document.createElement('div');
      label.className = 'dd-section-label';
      label.textContent = 'Bundled';
      bundledListEl.appendChild(label);
      for (const name of bundledNames) {
        bundledListEl.appendChild(makeItem(name, 'bundled'));
      }
    }

    if (userDecoders.length > 0) {
      const label = document.createElement('div');
      label.className = 'dd-section-label';
      label.textContent = 'User';
      userListEl.appendChild(label);
      for (const ud of userDecoders) {
        userListEl.appendChild(makeItem(ud.name, 'user', ud.source));
      }
    }
  }

  function makeItem(name: string, kind: 'bundled' | 'user', source?: string): HTMLElement {
    const item = document.createElement('div');
    item.className = 'dd-item';
    if (activeDecoder?.name === name && activeDecoder?.kind === kind) {
      item.classList.add('active');
    }

    const label = document.createElement('span');
    label.textContent = name;
    item.appendChild(label);

    if (kind === 'user') {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'dd-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.title = 'Remove decoder';
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeDecoder(name);
        await loadUserDecoders();
        rebuildDropdown();
      });
      item.appendChild(removeBtn);
    }

    item.addEventListener('click', () => {
      if (kind === 'bundled') {
        selectDecoder({ kind: 'bundled', name });
      } else {
        selectDecoder({ kind: 'user', name, source: source! });
      }
    });

    return item;
  }

  async function handleDecoderFile(file: File) {
    errorEl.classList.remove('visible');
    const source = await file.text();

    try {
      const { name, version } = await validateInWorker(source);
      await saveDecoder({ name, version, source, savedAt: Date.now() });
      await loadUserDecoders();
      selectDecoder({ kind: 'user', name, source });
    } catch (err) {
      errorEl.textContent = err instanceof Error ? err.message : String(err);
      errorEl.classList.add('visible');
    }
  }

  function validateInWorker(source: string): Promise<{ name: string; version: string }> {
    return new Promise((resolve, reject) => {
      const w = new Worker(
        new URL('../worker/decode-worker.ts', import.meta.url),
        { type: 'module' },
      );
      w.onmessage = (e: MessageEvent) => {
        w.terminate();
        if (e.data.kind === 'decoder-validated') {
          resolve({ name: e.data.name, version: e.data.version });
        } else if (e.data.kind === 'error') {
          reject(new Error(e.data.message));
        } else {
          reject(new Error('Unexpected response from validation worker'));
        }
      };
      w.onerror = (err) => {
        w.terminate();
        reject(new Error(err.message));
      };
      w.postMessage({ kind: 'validate-decoder', source });
    });
  }

  btnEl.addEventListener('click', toggleDropdown);

  document.addEventListener('click', (e) => {
    if (!pickerEl.contains(e.target as Node)) closeDropdown();
  });

  loadInput.addEventListener('change', () => {
    const file = loadInput.files?.[0];
    if (file) handleDecoderFile(file);
    loadInput.value = '';
  });

  await loadUserDecoders();

  return picker;
}
