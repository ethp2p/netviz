import type { DecoderOutput } from '../decoder-sdk';
import { P } from '../types';
import { chrome } from '../theme';
import { getEl } from './dom';
import { formatDefinitionName, toCss } from '../format';
import { getOverlayMetricGroups } from './overlay-groups';

function appendSectionLabel(container: HTMLElement, text: string, marginTop = false): void {
  const label = document.createElement('div');
  label.className = 'nl-section-label';
  if (marginTop) label.style.marginTop = '4px';
  label.textContent = text;
  container.appendChild(label);
}

function appendLegendItem(container: HTMLElement, marker: HTMLElement, text: string): void {
  const item = document.createElement('div');
  item.className = 'nl-item';
  item.appendChild(marker);
  item.appendChild(document.createTextNode(text));
  container.appendChild(item);
}

export function rebuildLegend(output: DecoderOutput, originNode: number): void {
  const fills = getEl('legend-fills');
  const rings = getEl('legend-rings');
  fills.replaceChildren();
  rings.replaceChildren();

  appendSectionLabel(fills, 'Fill');

  if (originNode >= 0) {
    const originDot = document.createElement('span');
    originDot.className = 'nl-dot';
    originDot.style.background = P.origin.css;
    appendLegendItem(fills, originDot, 'Origin');
  }

  output.states.forEach((state, index) => {
    const dot = document.createElement('span');
    dot.className = 'nl-dot';
    dot.style.background = toCss(state.color) ?? '';
    if (state.initial ?? index === 0) {
      dot.style.border = '1px solid oklch(0.45 0 0)';
      dot.style.boxSizing = 'border-box';
    }
    appendLegendItem(fills, dot, state.label ?? formatDefinitionName(state.name));
  });

  const ringGroups = getOverlayMetricGroups(output.metrics);
  if (ringGroups.length === 0) return;

  appendSectionLabel(rings, 'Rings', true);
  for (const group of ringGroups) {
    const ring = document.createElement('span');
    ring.className = 'nl-ring';
    ring.style.borderColor = group.color ? (toCss(group.color) ?? '') : chrome.text2.css;
    appendLegendItem(rings, ring, group.label);
  }
}
