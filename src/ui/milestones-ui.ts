import type { Milestone } from '../decoder-sdk';
import { escapeHtml, formatTime } from '../format';
import { getEl } from './dom';

export function renderMilestones(
  milestones: Milestone[],
  minTime: number,
  maxTime: number,
  timeOffset: number,
  onSeek: (time: number) => void,
): void {
  const tlMarkers = getEl('tl-markers');
  const tlLegend = getEl('tl-legend');

  tlMarkers.replaceChildren();
  tlLegend.replaceChildren();

  const range = maxTime - minTime;
  if (range <= 0 || milestones.length === 0) return;

  const title = document.createElement('div');
  title.id = 'tl-legend-title';
  title.textContent = 'Milestones';
  tlLegend.appendChild(title);

  for (const ms of milestones) {
    const pct = ((ms.time - minTime) / range) * 100;

    // Marker tick on the timeline
    const marker = document.createElement('div');
    marker.className = 'tl-marker';
    marker.style.left = pct + '%';
    marker.style.backgroundColor = ms.color;
    marker.title = ms.label + ' @ ' + formatTime(ms.time - timeOffset);
    marker.addEventListener('click', () => {
      onSeek(ms.time);
    });
    tlMarkers.appendChild(marker);

    // Legend entry
    const item = document.createElement('span');
    item.className = 'tl-legend-item';

    const dot = document.createElement('span');
    dot.className = 'tl-legend-dot';
    dot.style.background = ms.color;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'tl-legend-label';
    labelSpan.textContent = ms.label;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'tl-legend-time';
    timeSpan.textContent = formatTime(ms.time - timeOffset);

    item.appendChild(dot);
    item.appendChild(labelSpan);
    item.appendChild(timeSpan);
    item.addEventListener('click', () => {
      onSeek(ms.time);
    });
    tlLegend.appendChild(item);
  }
}
