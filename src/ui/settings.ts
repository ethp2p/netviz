import type { ArcLayerDef, DecoderOutput, MetricDef } from '../decoder-sdk';
import type { AppStore } from '../store';
import { getEl } from './dom';
import { formatDefinitionName, toCss } from '../format';
import { getOverlayMetricGroups } from './overlay-groups';
import { loadExactColors, saveExactColors } from '../theme';

export function initSettings(deps: {
  store: AppStore;
  drawOverlayNow: () => void;
  renderLayers: () => void;
  onExactColorsChange?: (exact: boolean) => void;
}): { rebuild: (output: DecoderOutput) => void; exactColors: boolean } {
  const { store, drawOverlayNow, renderLayers } = deps;
  let exactColors = loadExactColors();
  const settingsBtn = getEl('settings-btn');
  const settingsPanel = getEl('settings-panel');
  const nodeLegend = getEl('node-legend');

  settingsBtn.addEventListener('click', () => {
    const open = settingsPanel.classList.toggle('open');
    settingsBtn.classList.toggle('active', open);
  });

  document.addEventListener('mousedown', (e) => {
    const target = e.target as HTMLElement;
    if (!nodeLegend.contains(target)) {
      settingsPanel.classList.remove('open');
      settingsBtn.classList.remove('active');
    }
  });

  function buildSectionHeader(title: string, actions?: HTMLElement): HTMLDivElement {
    const header = document.createElement('div');
    header.className = 'sp-header';

    const titleEl = document.createElement('span');
    titleEl.textContent = title;
    header.appendChild(titleEl);

    if (actions) header.appendChild(actions);
    return header;
  }

  function buildToggle(
    labelText: string,
    checked: boolean,
    color: string | null,
    onChange: (checked: boolean) => void,
  ): HTMLLabelElement {
    const label = document.createElement('label');
    label.className = 'sp-toggle';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => onChange(input.checked));

    label.appendChild(input);

    if (color) {
      const dot = document.createElement('span');
      dot.className = 'sp-dot';
      dot.style.background = color;
      label.appendChild(dot);
    }

    const text = document.createElement('span');
    text.className = 'sp-label';
    text.textContent = labelText;
    label.appendChild(text);

    return label;
  }

  function buildArcSection(content: HTMLElement, arcLayers: ArcLayerDef[]): void {
    if (arcLayers.length === 0) return;

    const section = document.createElement('div');
    section.className = 'sp-section';
    section.appendChild(buildSectionHeader('Particles'));

    arcLayers.forEach((arcLayer, index) => {
      section.appendChild(buildToggle(
        arcLayer.label ?? formatDefinitionName(arcLayer.name),
        store.enabledArcLayers[index] ?? true,
        toCss(arcLayer.color),
        (checked) => {
          store.enabledArcLayers[index] = checked;
          renderLayers();
        },
      ));
    });

    content.appendChild(section);
  }

  function buildRingSection(content: HTMLElement, metrics: MetricDef[]): void {
    const ringGroups = getOverlayMetricGroups(metrics);
    if (ringGroups.length === 0) return;

    const section = document.createElement('div');
    section.className = 'sp-section';

    const actions = document.createElement('span');
    actions.className = 'sp-actions';

    const ringInputs: HTMLInputElement[] = [];

    const allBtn = document.createElement('button');
    allBtn.className = 'sp-action';
    allBtn.textContent = 'All';
    allBtn.addEventListener('click', () => {
      ringInputs.forEach((input, index) => {
        input.checked = true;
        store.graphSettings.ringToggles[index] = true;
      });
      drawOverlayNow();
    });

    const noneBtn = document.createElement('button');
    noneBtn.className = 'sp-action';
    noneBtn.textContent = 'None';
    noneBtn.addEventListener('click', () => {
      ringInputs.forEach((input, index) => {
        input.checked = false;
        store.graphSettings.ringToggles[index] = false;
      });
      drawOverlayNow();
    });

    actions.appendChild(allBtn);
    actions.appendChild(noneBtn);
    section.appendChild(buildSectionHeader('Rings', actions));

    ringGroups.forEach((group, ringIndex) => {
      const toggle = buildToggle(
        group.label,
        store.graphSettings.ringToggles[ringIndex] ?? true,
        toCss(group.color),
        (checked) => {
          store.graphSettings.ringToggles[ringIndex] = checked;
          drawOverlayNow();
        },
      );
      ringInputs.push(toggle.querySelector('input') as HTMLInputElement);
      section.appendChild(toggle);
    });

    content.appendChild(section);
  }

  function buildColorSection(content: HTMLElement): void {
    const section = document.createElement('div');
    section.className = 'sp-section';
    section.appendChild(buildSectionHeader('Colors'));
    section.appendChild(buildToggle(
      'Use exact decoder colors',
      exactColors,
      null,
      (checked) => {
        exactColors = checked;
        saveExactColors(checked);
        deps.onExactColorsChange?.(checked);
      },
    ));
    content.appendChild(section);
  }

  function rebuild(output: DecoderOutput): void {
    settingsPanel.replaceChildren();
    const content = document.createElement('div');
    buildRingSection(content, output.metrics);
    buildArcSection(content, output.arcLayers);
    buildColorSection(content);
    settingsPanel.appendChild(content);
  }

  return { rebuild, get exactColors() { return exactColors; } };
}
