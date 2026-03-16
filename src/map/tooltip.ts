import type { NodeData, Position3D } from '../types';
import { P } from '../types';
import { chrome } from '../theme';
import type { StateDef, MetricDef, CanonicalHeader } from '../decoder-sdk';
import type { NodeMetadata } from '../graph/node-metadata';
import { escapeHtml, formatDefinitionName } from '../format';
import { getOverlayMetricGroups } from '../ui/overlay-groups';

export interface NodeLayerDatum {
  index: number;
  position: Position3D;
  color: [number, number, number, number];
  radius: number;
  state: number;
  name: string;
  chunksHave: number;
  chunksNeed: number;
}

function renderSparkline(
  meta: NodeMetadata,
  nodeIdx: number,
  currentTime: number,
): string {
  const up = meta.bwUp[nodeIdx];
  const down = meta.bwDown[nodeIdx];
  const samples = meta.bwSamples;

  let maxVal = 0;
  for (let i = 0; i < samples; i++) {
    if (up[i] > maxVal) maxVal = up[i];
    if (down[i] > maxVal) maxVal = down[i];
  }
  if (maxVal === 0) return '';

  const w = 160;
  const h = 28;
  const cy = h / 2;
  const dx = w / samples;
  const half = cy - 1;

  let upD = `M0,${cy}`;
  for (let i = 0; i < samples; i++) {
    upD += `L${(i * dx).toFixed(1)},${(cy - (up[i] / maxVal) * half).toFixed(1)}`;
  }
  upD += `L${w},${cy}Z`;

  let downD = `M0,${cy}`;
  for (let i = 0; i < samples; i++) {
    downD += `L${(i * dx).toFixed(1)},${(cy + (down[i] / maxVal) * half).toFixed(1)}`;
  }
  downD += `L${w},${cy}Z`;

  const range = meta.bwTimeMax - meta.bwTimeMin;
  const crossX = range > 0
    ? Math.max(0, Math.min(w, ((currentTime - meta.bwTimeMin) / range) * w))
    : 0;

  return `<svg width="${w}" height="${h}" style="display:block;margin:3px 0">` +
    `<path d="${upD}" fill="${P.receiving.css}" opacity="0.4"/>` +
    `<path d="${downD}" fill="${P.useless.css}" opacity="0.4"/>` +
    `<line x1="0" y1="${cy}" x2="${w}" y2="${cy}" stroke="${P.idle.css}" stroke-width="0.5"/>` +
    `<line x1="${crossX.toFixed(1)}" y1="0" x2="${crossX.toFixed(1)}" y2="${h}" stroke="${chrome.text.css}" stroke-width="1" opacity="0.5" stroke-dasharray="2,2"/>` +
    `</svg>`;
}

export function renderNodeTooltip(
  d: NodeLayerDatum,
  ns: NodeData,
  header: CanonicalHeader,
  states: StateDef[],
  metrics: MetricDef[],
  meta: NodeMetadata | null,
  currentTime: number,
): string {
  const nodeSpec = header.nodes[d.index];
  const props = nodeSpec?.props;
  const countryVal = props?.country;
  const countryLabel = countryVal ? ' <span style="color:' + chrome.text3.css + '">' + escapeHtml(String(countryVal)) + '</span>' : '';
  const stateName = states[ns.state]?.label ?? formatDefinitionName(states[ns.state]?.name ?? 'unknown');
  let html = '<b>' + escapeHtml(d.name) + '</b>' + countryLabel + ' <span style="color:' + chrome.text2.css + '">[' + escapeHtml(stateName) + ']</span>';

  // Topology metadata: hops, latency, bandwidth
  if (meta) {
    const h = meta.hops[d.index];
    const lat = meta.latencyMs[d.index];
    const parts: string[] = [];
    if (h >= 0) parts.push(h === 0 ? 'origin' : h + (h === 1 ? ' hop' : ' hops'));
    if (lat < Infinity && lat > 0) parts.push(Math.round(lat) + 'ms');
    if (props) {
      const dlBw = props.download_bw_mbps;
      const ulBw = props.upload_bw_mbps;
      if (dlBw !== undefined && ulBw !== undefined) {
        parts.push(
          '<span style="color:' + P.useless.css + '">\u2193' + dlBw + '</span>' +
          '/<span style="color:' + P.receiving.css + '">\u2191' + ulBw + '</span> Mbps',
        );
      }
    }
    if (parts.length > 0) {
      html += '<br><span style="color:' + P.slate.css + ';font-size:10px">' + parts.join(' \u00b7 ') + '</span>';
    }
  }

  // Bandwidth sparkline
  if (meta && meta.bwSamples > 0) {
    html += renderSparkline(meta, d.index, currentTime);
  }

  // Progress
  if (d.chunksNeed > 0) {
    const pct = Math.round((d.chunksHave / d.chunksNeed) * 100);
    html += '<br>' + d.chunksHave + '/' + d.chunksNeed + ' chunks <span style="color:' + chrome.text2.css + '">(' + pct + '%)</span>';
  }

  const overlayMetrics: Array<{ label: string; color: string; value: number }> = [];
  getOverlayMetricGroups(metrics).forEach((group) => {
    const value = group.metricIndices.reduce((sum, index) => sum + (ns.metrics[index] ?? 0), 0);
    if (value <= 0) return;
    overlayMetrics.push({
      label: group.label,
      color: group.color ? `rgb(${group.color[0]},${group.color[1]},${group.color[2]})` : chrome.text2.css,
      value,
    });
  });

  if (overlayMetrics.length > 0) {
    html += '<div style="display:flex;height:3px;width:140px;margin:3px 0 2px;overflow:hidden;background:' + chrome.borderSubtle.css + '">';
    for (const metric of overlayMetrics) {
      html += '<div style="flex:' + metric.value + ';background:' + metric.color + '"></div>';
    }
    html += '</div>';
    html += overlayMetrics.map(metric =>
      '<span style="color:' + metric.color + '">' + metric.value + ' ' + escapeHtml(metric.label.toLowerCase()) + '</span>'
    ).join(' \u00b7 ');
  } else {
    const metricParts: string[] = [];
    for (let i = 0; i < metrics.length; i++) {
      if (metrics[i].kind === 'nodeCount') continue;
      const val = ns.metrics[i];
      if (val > 0) {
        metricParts.push((metrics[i].label ?? formatDefinitionName(metrics[i].name)) + ': ' + val);
      }
    }
    if (metricParts.length > 0) {
      html += '<br>' + metricParts.join(' \u00b7 ');
    }
  }

  return html;
}
