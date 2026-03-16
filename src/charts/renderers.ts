import type { ChartData } from './data';
import { scale, svgEl, stepPath, stepAreaPath, addYLabels, nearestIdx, addSlackOverlays, UP_COLOR, DOWN_COLOR, chartLabelColor } from './helpers';
import { chrome } from '../theme';
import { finalizeScaffold, drawMirroredBase, drawMirroredAreas, computeMirroredScales, recreateRateOverlay } from './scaffold';
import type { ChartScaffold, RateChartSlots } from './scaffold';
import { drawPercentileBands, detectHoveredBand, bandTooltipHtml, wireMouseEvents } from './bands';
import { formatTime, formatBytes, formatRate } from '../format';
import type { RateUnit } from '../format';

export type BwSeries =
  | { kind: 'scalar'; data: ReadonlyArray<{ time: number; up: number; down: number }> }
  | { kind: 'percentile'; data: ReadonlyArray<{ time: number; up: number[]; down: number[] }> };

function seriesMaxes(series: BwSeries): [number, number] {
  let maxUp = 0, maxDown = 0;
  if (series.kind === 'scalar') {
    for (const s of series.data) {
      if (s.up > maxUp) maxUp = s.up;
      if (s.down > maxDown) maxDown = s.down;
    }
  } else {
    for (const s of series.data) {
      if (s.up[4] > maxUp) maxUp = s.up[4];
      if (s.down[4] > maxDown) maxDown = s.down[4];
    }
  }
  return [maxUp, maxDown];
}

export function renderCdfChart(
  scaffold: ChartScaffold,
  data: ChartData,
  xScale: (v: number) => number,
  xInv: (v: number) => number,
  chartWidth: number,
  focusRange: [number, number] | undefined,
  setCrosshair: (t: number | null, idx: number) => void,
  tooltipIdx: number,
  timeMarkers: SVGLineElement[],
  hoverLines: SVGLineElement[],
): void {
  const { svg, plotTop, plotBottom } = scaffold;
  const yScale = scale(0, 1, plotBottom, plotTop);

  addYLabels(svg, [0, 0.25, 0.5, 0.75, 1.0], yScale, v => Math.round(v * 100) + '%', scaffold.plotLeft, scaffold.plotRight);

  if (data.cdf.length > 0) {
    const xs = data.cdf.map(p => xScale(p.time));
    const ys = data.cdf.map(p => yScale(p.fraction));
    svg.appendChild(svgEl('path', {
      d: stepAreaPath(xs, ys, plotBottom),
      fill: chrome.green.css, 'fill-opacity': '0.15', stroke: 'none',
    }));
    svg.appendChild(svgEl('path', {
      d: stepPath(xs, ys),
      fill: 'none', stroke: chrome.green.css, 'stroke-width': '1.5',
    }));
  }

  if (focusRange) addSlackOverlays(svg, data.timeRange, focusRange, xScale, plotTop, plotBottom);
  finalizeScaffold(scaffold, timeMarkers, hoverLines);

  wireMouseEvents({
    svg, overlay: scaffold.overlay, tooltip: scaffold.tooltip,
    chartWidth, tooltipMaxOffset: 100, xInv, tooltipIdx, setCrosshair,
    onMove(t) {
      let frac = 0;
      for (const p of data.cdf) {
        if (p.time <= t) frac = p.fraction;
        else break;
      }
      return '<span class="tt-time">' + formatTime(Math.max(0, t)) + '</span><br>' +
        '<span style="color:' + chrome.green.css + '">' + Math.round(frac * 100) + '% decoded</span>';
    },
  });
}

export function renderCumulativeBwChart(
  scaffold: ChartScaffold,
  series: BwSeries,
  xScale: (v: number) => number,
  xInv: (v: number) => number,
  chartWidth: number,
  dataTimeRange: [number, number],
  focusRange: [number, number] | undefined,
  setCrosshair: (t: number | null, idx: number) => void,
  tooltipIdx: number,
  tooltipMaxOffset: number,
  timeMarkers: SVGLineElement[],
  hoverLines: SVGLineElement[],
): void {
  const { svg, plotLeft, plotRight, plotTop, plotBottom } = scaffold;
  const [maxUp, maxDown] = seriesMaxes(series);
  const ms = computeMirroredScales(plotTop, plotBottom, maxUp, maxDown);
  const xs = series.data.map(s => xScale(s.time));

  drawMirroredBase({ svg, plotLeft, plotRight, plotTop, plotBottom, ...ms, formatY: formatBytes });

  let bands: ReturnType<typeof drawPercentileBands> | null = null;
  if (series.kind === 'scalar') {
    drawMirroredAreas(svg, xs, series.data.map(s => ms.yUp(s.up)), series.data.map(s => ms.yDown(s.down)), ms.centerY);
  } else {
    bands = drawPercentileBands(svg, xs, series.data, ms.yUp, ms.yDown, ms.centerY);
  }

  if (focusRange) addSlackOverlays(svg, dataTimeRange, focusRange, xScale, plotTop, plotBottom);
  finalizeScaffold(scaffold, timeMarkers, hoverLines);

  const times = series.data.map(s => s.time);

  wireMouseEvents({
    svg, overlay: scaffold.overlay, tooltip: scaffold.tooltip,
    chartWidth, tooltipMaxOffset, xInv, tooltipIdx, setCrosshair,
    onMove(t, _mx, my) {
      const idx = nearestIdx(times, t);
      if (series.kind === 'scalar') {
        const s = series.data[idx];
        return '<span class="tt-time">' + formatTime(s.time) + '</span><br>' +
          '<span style="color:' + UP_COLOR + '">up: ' + formatBytes(s.up) + '</span><br>' +
          '<span style="color:' + DOWN_COLOR + '">down: ' + formatBytes(s.down) + '</span>';
      }
      const s = series.data[idx];
      const hoveredBand = detectHoveredBand(my, ms.centerY, s, ms.yUp, ms.yDown);
      bands!.highlight(hoveredBand);
      return bandTooltipHtml(s, hoveredBand, formatBytes);
    },
    onLeave: bands ? () => bands!.reset() : undefined,
  });
}

export function renderRateBwChart(
  scaffold: ChartScaffold,
  series: BwSeries,
  xScale: (v: number) => number,
  xInv: (v: number) => number,
  chartWidth: number,
  dataTimeRange: [number, number],
  focusRange: [number, number] | undefined,
  setCrosshair: (t: number | null, idx: number) => void,
  tooltipIdx: number,
  tooltipMaxOffset: number,
  getRateUnit: () => RateUnit,
  timeMarkers: SVGLineElement[],
  hoverLines: SVGLineElement[],
): () => void {
  const { svg, plotLeft, plotRight, plotTop, plotBottom } = scaffold;
  const times = series.data.map(s => s.time);
  const slots: RateChartSlots = { tmSlot: -1, hlSlot: -1 };

  function draw() {
    svg.replaceChildren();
    const rateUnit = getRateUnit();
    const fmtY = (v: number) => formatRate(v, rateUnit);

    const [maxUp, maxDown] = seriesMaxes(series);
    const ms = computeMirroredScales(plotTop, plotBottom, maxUp, maxDown);
    const xs = series.data.map(s => xScale(s.time));

    drawMirroredBase({ svg, plotLeft, plotRight, plotTop, plotBottom, ...ms, formatY: fmtY });

    let bands: ReturnType<typeof drawPercentileBands> | null = null;
    if (series.kind === 'scalar') {
      drawMirroredAreas(svg, xs, series.data.map(s => ms.yUp(s.up)), series.data.map(s => ms.yDown(s.down)), ms.centerY);
    } else {
      bands = drawPercentileBands(svg, xs, series.data, ms.yUp, ms.yDown, ms.centerY);
    }

    if (focusRange) addSlackOverlays(svg, dataTimeRange, focusRange, xScale, plotTop, plotBottom);

    const overlay = recreateRateOverlay(scaffold, timeMarkers, hoverLines, slots);

    wireMouseEvents({
      svg, overlay, tooltip: scaffold.tooltip,
      chartWidth, tooltipMaxOffset, xInv, tooltipIdx, setCrosshair,
      onMove(t, _mx, my) {
        const idx = nearestIdx(times, t);
        if (series.kind === 'scalar') {
          const s = series.data[idx];
          return '<span class="tt-time">' + formatTime(s.time) + '</span><br>' +
            '<span style="color:' + UP_COLOR + '">up: ' + formatRate(s.up, rateUnit) + '</span><br>' +
            '<span style="color:' + DOWN_COLOR + '">down: ' + formatRate(s.down, rateUnit) + '</span>';
        }
        const s = series.data[idx];
        const hoveredBand = detectHoveredBand(my, ms.centerY, s, ms.yUp, ms.yDown);
        bands!.highlight(hoveredBand);
        return bandTooltipHtml(s, hoveredBand, v => formatRate(v, rateUnit));
      },
      onLeave: bands ? () => bands!.reset() : undefined,
    });
  }

  draw();
  return draw;
}

export function createUnitToggle(
  parent: HTMLElement,
  rateUnit: { value: RateUnit },
  section: HTMLElement,
  rateRebuilders: (() => void)[],
): void {
  const toggle = document.createElement('span');
  toggle.className = 'rate-toggle';
  toggle.textContent = 'Mbit/s';
  toggle.title = 'Click to switch units';
  toggle.style.cssText = 'cursor:pointer;font-size:10px;opacity:0.6;margin-left:8px;border-bottom:1px dotted currentColor';
  toggle.addEventListener('click', () => {
    rateUnit.value = rateUnit.value === 'MBs' ? 'Mbits' : 'MBs';
    toggle.textContent = rateUnit.value === 'MBs' ? 'MB/s' : 'Mbit/s';
    for (const el of section.querySelectorAll('.rate-toggle')) {
      el.textContent = toggle.textContent;
    }
    for (const rb of rateRebuilders) rb();
  });
  parent.appendChild(toggle);
}
