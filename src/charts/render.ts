import type { ChartData } from './data';
import { scale, scaleInv, MARGIN, CDF_HEIGHT, BW_HEIGHT } from './helpers';
import { createChartScaffold } from './scaffold';
import type { ChartConfig } from './scaffold';
import type { RateUnit } from '../format';
import {
  renderCdfChart,
  renderCumulativeBwChart,
  renderRateBwChart,
  createUnitToggle,
} from './renderers';

export interface ChartControls {
  updateTime(currentTime: number): void;
}

export function renderCharts(
  container: HTMLElement,
  data: ChartData,
  focusRange?: [number, number],
): ChartControls {
  const existing = container.querySelector('#charts-section');
  if (existing) existing.remove();

  const section = document.createElement('div');
  section.id = 'charts-section';
  container.appendChild(section);

  const chartWidth = container.clientWidth - 24;
  const plotLeft = MARGIN.left;
  const plotRight = chartWidth - MARGIN.right;

  const [tMin, tMax] = data.timeRange;
  const xScale = scale(tMin, tMax, plotLeft, plotRight);
  const xInv = scaleInv(tMin, tMax, plotLeft, plotRight);

  const timeMarkers: SVGLineElement[] = [];
  const hoverLines: SVGLineElement[] = [];
  const tooltips: HTMLElement[] = [];

  function setCrosshair(t: number | null, sourceIdx: number) {
    if (t === null) {
      for (const hl of hoverLines) hl.setAttribute('display', 'none');
      for (let i = 0; i < tooltips.length; i++) {
        if (i !== sourceIdx) tooltips[i].style.display = 'none';
      }
      return;
    }
    const x = xScale(t);
    for (const hl of hoverLines) {
      hl.setAttribute('x1', String(x));
      hl.setAttribute('x2', String(x));
      hl.setAttribute('display', '');
    }
  }

  // Rate unit toggle state
  const rateUnit = { value: 'Mbits' as RateUnit };
  const rateRebuilders: (() => void)[] = [];

  const scaffoldCfg = (title: string, height: number, unitToggle?: (h: HTMLElement) => void): ChartConfig => ({
    title, height, section, chartWidth, unitToggle,
  });

  // ---- CDF chart ----
  {
    const s = createChartScaffold(scaffoldCfg('Reconstruction CDF', CDF_HEIGHT), tooltips);
    renderCdfChart(s, data, xScale, xInv, chartWidth, focusRange, setCrosshair, tooltips.length - 1, timeMarkers, hoverLines);
  }

  // ---- Origin cumulative traffic ----
  if (data.origin.length > 0) {
    const s = createChartScaffold(scaffoldCfg('Origin cumulative traffic', BW_HEIGHT), tooltips);
    renderCumulativeBwChart(
      s, { kind: 'scalar', data: data.origin }, xScale, xInv, chartWidth, data.timeRange,
      focusRange, setCrosshair, tooltips.length - 1, 120, timeMarkers, hoverLines,
    );
  }

  // ---- Relayer cumulative traffic ----
  if (data.relayer.length > 0) {
    const s = createChartScaffold(scaffoldCfg('Relayer cumulative traffic', BW_HEIGHT), tooltips);
    renderCumulativeBwChart(
      s, { kind: 'percentile', data: data.relayer }, xScale, xInv, chartWidth, data.timeRange,
      focusRange, setCrosshair, tooltips.length - 1, 140, timeMarkers, hoverLines,
    );
  }

  // ---- Origin bandwidth (rate) ----
  if (data.originRate.length > 0) {
    const s = createChartScaffold(
      scaffoldCfg('Origin bandwidth', BW_HEIGHT, (h) => createUnitToggle(h, rateUnit, section, rateRebuilders)),
      tooltips,
    );
    const rebuild = renderRateBwChart(
      s, { kind: 'scalar', data: data.originRate }, xScale, xInv, chartWidth, data.timeRange,
      focusRange, setCrosshair, tooltips.length - 1, 140, () => rateUnit.value, timeMarkers, hoverLines,
    );
    rateRebuilders.push(rebuild);
  }

  // ---- Relayer bandwidth (rate) ----
  if (data.relayerRate.length > 0) {
    const s = createChartScaffold(
      scaffoldCfg('Relayer bandwidth', BW_HEIGHT, (h) => createUnitToggle(h, rateUnit, section, rateRebuilders)),
      tooltips,
    );
    const rebuild = renderRateBwChart(
      s, { kind: 'percentile', data: data.relayerRate }, xScale, xInv, chartWidth, data.timeRange,
      focusRange, setCrosshair, tooltips.length - 1, 160, () => rateUnit.value, timeMarkers, hoverLines,
    );
    rateRebuilders.push(rebuild);
  }

  return {
    updateTime(currentTime: number) {
      const x = xScale(currentTime);
      for (const tm of timeMarkers) {
        tm.setAttribute('x1', String(x));
        tm.setAttribute('x2', String(x));
      }
    },
  };
}
