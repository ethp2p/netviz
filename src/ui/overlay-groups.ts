import type { MetricDef, RGBA } from '../decoder-sdk';
import { formatDefinitionName } from '../format';

interface OverlayMetricGroup {
  key: string;
  label: string;
  color?: RGBA;
  metricIndices: number[];
}

export function getOverlayMetricGroups(metrics: MetricDef[]): OverlayMetricGroup[] {
  const groups = new Map<string, OverlayMetricGroup>();

  metrics.forEach((metric, index) => {
    if (metric.overlay !== 'ring') return;
    const key = metric.overlayGroup ?? `metric:${index}`;
    const existing = groups.get(key);
    if (existing) {
      existing.metricIndices.push(index);
      return;
    }
    groups.set(key, {
      key,
      label: metric.overlayLabel ?? metric.label ?? formatDefinitionName(metric.name),
      color: metric.color,
      metricIndices: [index],
    });
  });

  return Array.from(groups.values());
}
