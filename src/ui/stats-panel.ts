import type { StateDef, MetricDef } from '../decoder-sdk';
import type { NodeData, GlobalStats } from '../types';
import { formatBytes, formatRate, formatTime, formatDefinitionName } from '../format';
export { formatBytes, formatRate, formatTime } from '../format';
export type { RateUnit } from '../format';
export { getEl } from './dom';

export interface StatElements {
  total: HTMLElement;
  nodeRows: Array<{ kind: 'state' | 'metric'; index: number; value: HTMLElement }>;
  metricGroups: Array<{ title: string; rows: Array<{ index: number; value: HTMLElement }> }>;
  progress: {
    group: HTMLElement;
    min: HTMLElement;
    max: HTMLElement;
    avg: HTMLElement;
    need: HTMLElement;
  };
}

function createValueRow(parent: HTMLElement, label: string, initial = '--'): HTMLElement {
  const row = document.createElement('div');
  row.className = 'stat-row';

  const labelEl = document.createElement('span');
  labelEl.className = 'label';
  labelEl.textContent = label;
  row.appendChild(labelEl);

  const valueEl = document.createElement('span');
  valueEl.className = 'value';
  valueEl.textContent = initial;
  row.appendChild(valueEl);

  parent.appendChild(row);
  return valueEl;
}

function createGroup(parent: HTMLElement, title: string): HTMLDivElement {
  const group = document.createElement('div');
  group.className = 'stat-group';

  const header = document.createElement('h3');
  header.textContent = title;
  group.appendChild(header);

  parent.appendChild(group);
  return group;
}

function stateLabel(state: StateDef): string {
  return state.label ?? formatDefinitionName(state.name);
}

function metricLabel(metric: MetricDef): string {
  return metric.label ?? formatDefinitionName(metric.name);
}

export function buildStatElements(
  container: HTMLElement,
  states: StateDef[],
  metrics: MetricDef[],
  showProgress: boolean,
): StatElements {
  container.replaceChildren();

  const nodesGroup = createGroup(container, 'Nodes');
  const total = createValueRow(nodesGroup, 'Total');
  const nodeRows: StatElements['nodeRows'] = [];

  const explicitNodeRows: Array<{ kind: 'state' | 'metric'; index: number; order: number; label: string }> = [];
  states.forEach((state, index) => {
    if (state.statsGroup === 'Nodes') {
      explicitNodeRows.push({
        kind: 'state',
        index,
        order: state.statsOrder ?? explicitNodeRows.length,
        label: stateLabel(state),
      });
    }
  });
  metrics.forEach((metric, index) => {
    if (metric.statsGroup === 'Nodes') {
      explicitNodeRows.push({
        kind: 'metric',
        index,
        order: metric.statsOrder ?? explicitNodeRows.length,
        label: metricLabel(metric),
      });
    }
  });

  if (explicitNodeRows.length > 0) {
    explicitNodeRows.sort((a, b) => a.order - b.order);
    explicitNodeRows.forEach((row) => {
      nodeRows.push({
        kind: row.kind,
        index: row.index,
        value: createValueRow(nodesGroup, row.label, '0'),
      });
    });
  } else {
    states.forEach((state, index) => {
      nodeRows.push({
        kind: 'state',
        index,
        value: createValueRow(nodesGroup, stateLabel(state), '0'),
      });
    });
  }

  const metricGroupOrder: string[] = [];
  const metricGroups = new Map<string, Array<{ index: number; order: number; label: string }>>();
  metrics.forEach((metric, index) => {
    if (metric.kind === 'nodeCount') return;
    const title = metric.statsGroup && metric.statsGroup !== 'Nodes' ? metric.statsGroup : 'Metrics';
    if (!metricGroups.has(title)) {
      metricGroups.set(title, []);
      metricGroupOrder.push(title);
    }
    metricGroups.get(title)!.push({
      index,
      order: metric.statsOrder ?? metricGroups.get(title)!.length,
      label: metricLabel(metric),
    });
  });

  const metricGroupEls: StatElements['metricGroups'] = [];
  metricGroupOrder.forEach((title) => {
    const rows = metricGroups.get(title);
    if (!rows || rows.length === 0) return;
    rows.sort((a, b) => a.order - b.order);
    const group = createGroup(container, title);
    metricGroupEls.push({
      title,
      rows: rows.map(row => ({
        index: row.index,
        value: createValueRow(
          group,
          row.label,
          metrics[row.index].format === 'bytes' ? '0 B' : '0',
        ),
      })),
    });
  });

  const progressGroup = createGroup(container, 'Strategy progress');
  progressGroup.style.display = showProgress ? '' : 'none';

  const progress = {
    group: progressGroup,
    min: createValueRow(progressGroup, 'Min have'),
    max: createValueRow(progressGroup, 'Max have'),
    avg: createValueRow(progressGroup, 'Avg have'),
    need: createValueRow(progressGroup, 'Need'),
  };

  return { total, nodeRows, metricGroups: metricGroupEls, progress };
}

function formatMetricValue(val: number, def: MetricDef): string {
  switch (def.format) {
    case 'bytes':
      return formatBytes(val);
    case 'rate':
      return formatRate(val, 'MBs');
    case 'count':
    default:
      return String(Math.round(val));
  }
}

export function updateStats(
  els: StatElements,
  nodeStates: NodeData[],
  globalStats: GlobalStats,
  states: StateDef[],
  metrics: MetricDef[],
): void {
  const n = nodeStates.length;
  const stateCounts = new Int32Array(states.length);
  let spMin = Infinity, spMax = -Infinity, spSum = 0, spCount = 0, spNeed = 0;
  for (let i = 0; i < n; i++) {
    const ns = nodeStates[i];
    if (ns.state >= 0 && ns.state < states.length) {
      stateCounts[ns.state]++;
    }
    if (ns.chunksNeed > 0) {
      spCount++;
      spSum += ns.chunksHave;
      if (ns.chunksHave < spMin) spMin = ns.chunksHave;
      if (ns.chunksHave > spMax) spMax = ns.chunksHave;
      spNeed = Math.max(spNeed, ns.chunksNeed);
    }
  }

  els.total.textContent = String(n);
  els.nodeRows.forEach((row) => {
    if (row.kind === 'state') {
      row.value.textContent = String(stateCounts[row.index] ?? 0);
      return;
    }
    const def = metrics[row.index];
    if (def?.kind === 'nodeCount') {
      let count = 0;
      for (let i = 0; i < n; i++) {
        if ((nodeStates[i].metrics[row.index] ?? 0) > 0) count++;
      }
      row.value.textContent = String(count);
      return;
    }
    row.value.textContent = formatMetricValue(globalStats.metrics[row.index] ?? 0, def);
  });
  els.metricGroups.forEach((group) => {
    group.rows.forEach((row) => {
      row.value.textContent = formatMetricValue(globalStats.metrics[row.index] ?? 0, metrics[row.index]);
    });
  });

  els.progress.group.style.display = spCount > 0 ? '' : 'none';
  els.progress.min.textContent = spCount > 0 ? String(spMin) : '--';
  els.progress.max.textContent = spCount > 0 ? String(spMax) : '--';
  els.progress.avg.textContent = spCount > 0 ? (spSum / spCount).toFixed(1) : '--';
  els.progress.need.textContent = spCount > 0 ? String(spNeed) : '--';
}

