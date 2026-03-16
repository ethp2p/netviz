import type { Milestone } from '../decoder-sdk';
import { formatTime, toCss } from '../format';
import { getEl } from './dom';

export function renderMilestones(
  milestones: Milestone[],
  minTime: number,
  maxTime: number,
  timeOffset: number,
  onSeek: (time: number) => void,
): void {
  const tlMarkers = getEl('tl-markers');
  const statsPanel = getEl('stats-panel');

  tlMarkers.replaceChildren();

  // Remove previous milestones section from stats panel
  const prev = statsPanel.querySelector('#milestones-section');
  if (prev) prev.remove();

  const range = maxTime - minTime;
  if (range <= 0 || milestones.length === 0) return;

  // Milestones section in the stats panel
  const section = document.createElement('div');
  section.id = 'milestones-section';

  const title = document.createElement('h3');
  title.textContent = 'Milestones';
  section.appendChild(title);

  for (const ms of milestones) {
    const pct = ((ms.time - minTime) / range) * 100;

    // Marker tick on the timeline
    const marker = document.createElement('div');
    marker.className = 'tl-marker';
    marker.style.left = pct + '%';
    marker.style.backgroundColor = toCss(ms.color) ?? '';
    marker.title = ms.label + ' @ ' + formatTime(ms.time - timeOffset);
    marker.addEventListener('click', () => {
      onSeek(ms.time);
    });
    tlMarkers.appendChild(marker);

    // Legend entry in stats panel
    const item = document.createElement('div');
    item.className = 'ms-item';

    const dot = document.createElement('span');
    dot.className = 'ms-dot';
    dot.style.background = toCss(ms.color) ?? '';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'ms-label';
    labelSpan.textContent = ms.label;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'ms-time';
    timeSpan.textContent = formatTime(ms.time - timeOffset);

    item.appendChild(dot);
    item.appendChild(labelSpan);
    item.appendChild(timeSpan);
    item.addEventListener('click', () => {
      onSeek(ms.time);
    });
    section.appendChild(item);
  }

  const chartsSection = statsPanel.querySelector('#charts-section');
  if (chartsSection) {
    statsPanel.insertBefore(section, chartsSection);
  } else {
    statsPanel.appendChild(section);
  }
}
