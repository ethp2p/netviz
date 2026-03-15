import { describe, it, expect } from 'vitest';
import { getOverlayMetricGroups } from './overlay-groups';
import type { MetricDef, RGBA } from '../decoder-sdk';

const ring = (overrides: Partial<MetricDef> & Pick<MetricDef, 'name'>): MetricDef => ({
  format: 'count',
  aggregate: 'sum',
  overlay: 'ring',
  ...overrides,
});

describe('getOverlayMetricGroups', () => {
  it('returns [] for empty metrics', () => {
    expect(getOverlayMetricGroups([])).toEqual([]);
  });

  it('returns one group for a single ring metric', () => {
    const metrics: MetricDef[] = [ring({ name: 'peer_count' })];
    const groups = getOverlayMetricGroups(metrics);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('metric:0');
    expect(groups[0].metricIndices).toEqual([0]);
  });

  it('excludes non-ring metrics', () => {
    const metrics: MetricDef[] = [
      { name: 'byte_count', format: 'bytes', aggregate: 'sum' },
      { name: 'msg_rate', format: 'rate', aggregate: 'last', overlay: undefined },
    ];
    expect(getOverlayMetricGroups(metrics)).toEqual([]);
  });

  it('merges two ring metrics sharing the same overlayGroup', () => {
    const metrics: MetricDef[] = [
      ring({ name: 'send_count', overlayGroup: 'traffic' }),
      ring({ name: 'recv_count', overlayGroup: 'traffic' }),
    ];
    const groups = getOverlayMetricGroups(metrics);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('traffic');
    expect(groups[0].metricIndices).toEqual([0, 1]);
  });

  it('creates two groups for ring metrics with different overlayGroup', () => {
    const metrics: MetricDef[] = [
      ring({ name: 'send_count', overlayGroup: 'outbound' }),
      ring({ name: 'recv_count', overlayGroup: 'inbound' }),
    ];
    const groups = getOverlayMetricGroups(metrics);
    expect(groups).toHaveLength(2);
    expect(groups.map(g => g.key)).toEqual(['outbound', 'inbound']);
  });

  it('prefers overlayLabel over label over formatDefinitionName(name)', () => {
    const allThree = ring({ name: 'my_metric', label: 'My Label', overlayLabel: 'Override' });
    expect(getOverlayMetricGroups([allThree])[0].label).toBe('Override');

    const labelOnly = ring({ name: 'my_metric', label: 'My Label' });
    expect(getOverlayMetricGroups([labelOnly])[0].label).toBe('My Label');

    // name only: snake_case → Title Case via formatDefinitionName
    const nameOnly = ring({ name: 'peer_count' });
    expect(getOverlayMetricGroups([nameOnly])[0].label).toBe('Peer Count');
  });

  it('populates metricIndices with the correct original indices', () => {
    // index 0 is non-ring; ring metrics are at indices 1 and 3
    const metrics: MetricDef[] = [
      { name: 'ignored', format: 'count', aggregate: 'sum' },
      ring({ name: 'alpha', overlayGroup: 'grp' }),
      { name: 'also_ignored', format: 'count', aggregate: 'sum' },
      ring({ name: 'beta', overlayGroup: 'grp' }),
    ];
    const groups = getOverlayMetricGroups(metrics);
    expect(groups).toHaveLength(1);
    expect(groups[0].metricIndices).toEqual([1, 3]);
  });

  it('carries color from the first metric in the group', () => {
    const color: RGBA = [255, 128, 0, 255];
    const metrics: MetricDef[] = [ring({ name: 'colored', color, overlayGroup: 'g' })];
    expect(getOverlayMetricGroups(metrics)[0].color).toEqual(color);
  });

  it('leaves color undefined when not provided', () => {
    const metrics: MetricDef[] = [ring({ name: 'no_color' })];
    expect(getOverlayMetricGroups(metrics)[0].color).toBeUndefined();
  });
});
