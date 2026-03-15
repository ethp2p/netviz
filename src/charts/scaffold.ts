import { svgEl, scale, areaPath, linePath, addYLabels, MARGIN, UP_COLOR, DOWN_COLOR, cssFont } from './helpers';

export interface ChartScaffold {
  svg: SVGSVGElement;
  wrap: HTMLElement;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  plotW: number;
  plotH: number;
  timeMarker: SVGLineElement;
  hoverLine: SVGLineElement;
  tooltip: HTMLElement;
  overlay: SVGRectElement;
}

export interface ChartConfig {
  title: string;
  height: number;
  section: HTMLElement;
  chartWidth: number;
  unitToggle?: (heading: HTMLElement) => void;
}

export interface MirroredScales {
  centerY: number;
  maxUp: number;
  maxDown: number;
  yUp: (v: number) => number;
  yDown: (v: number) => number;
}

export interface RateChartSlots {
  tmSlot: number;
  hlSlot: number;
}

interface MirroredBaseOpts {
  svg: SVGSVGElement;
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
  centerY: number;
  maxUp: number;
  maxDown: number;
  yUp: (v: number) => number;
  yDown: (v: number) => number;
  formatY: (v: number) => string;
}

export function createChartScaffold(
  config: ChartConfig,
  tooltips: HTMLElement[],
): ChartScaffold {
  const h = config.height;
  const plotLeft = MARGIN.left;
  const plotRight = config.chartWidth - MARGIN.right;
  const plotTop = MARGIN.top;
  const plotBottom = h - MARGIN.bottom;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  wrap.style.position = 'relative';

  if (config.unitToggle) {
    const heading = document.createElement('h3');
    heading.textContent = config.title + ' ';
    wrap.appendChild(heading);
    config.unitToggle(heading);
  } else {
    const heading = document.createElement('h3');
    heading.textContent = config.title;
    wrap.appendChild(heading);
  }

  config.section.appendChild(wrap);

  const svg = svgEl('svg', { width: config.chartWidth, height: h }) as SVGSVGElement;
  wrap.appendChild(svg);

  const timeMarker = svgEl('line', {
    x1: plotLeft, y1: plotTop, x2: plotLeft, y2: plotBottom,
    stroke: '#ffffff', 'stroke-width': '1', 'stroke-dasharray': '3,3', opacity: '0.5',
  }) as SVGLineElement;

  const hoverLine = svgEl('line', {
    x1: 0, y1: plotTop, x2: 0, y2: plotBottom,
    stroke: '#fff', 'stroke-width': '1', opacity: '0.3', display: 'none',
  }) as SVGLineElement;

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  wrap.appendChild(tooltip);

  const overlay = svgEl('rect', {
    x: plotLeft, y: plotTop, width: plotW, height: plotH,
    fill: 'transparent', cursor: 'crosshair',
  }) as SVGRectElement;

  tooltips.push(tooltip);

  return { svg, wrap, plotLeft, plotRight, plotTop, plotBottom, plotW, plotH, timeMarker, hoverLine, tooltip, overlay };
}

// Append time marker, hover line, and overlay last so they sit on top of data paths,
// and register the marker/hover line in the shared arrays.
export function finalizeScaffold(
  s: ChartScaffold,
  timeMarkers: SVGLineElement[],
  hoverLines: SVGLineElement[],
): void {
  s.svg.appendChild(s.timeMarker);
  s.svg.appendChild(s.hoverLine);
  s.svg.appendChild(s.overlay);
  timeMarkers.push(s.timeMarker);
  hoverLines.push(s.hoverLine);
}

export function drawMirroredBase(opts: MirroredBaseOpts): void {
  const { svg, plotLeft, plotRight, plotTop, plotBottom, centerY, maxUp, maxDown, yUp, yDown, formatY } = opts;

  svg.appendChild(svgEl('line', {
    x1: plotLeft, y1: centerY, x2: plotRight, y2: centerY,
    stroke: '#3f3f46', 'stroke-width': '1',
  }));

  addYLabels(svg, [maxUp * 0.5, maxUp], yUp, formatY, plotLeft, plotRight);
  addYLabels(svg, [maxDown * 0.5, maxDown], yDown, formatY, plotLeft, plotRight);

  const upLabel = svgEl('text', {
    x: plotRight - 2, y: plotTop + 10,
    'text-anchor': 'end', fill: UP_COLOR, 'font-size': '9', opacity: '0.6',
    'font-family': cssFont(), 'font-weight': '400', 'letter-spacing': '0.06em',
  });
  upLabel.textContent = 'UPLOAD';
  svg.appendChild(upLabel);

  const downLabel = svgEl('text', {
    x: plotRight - 2, y: plotBottom - 4,
    'text-anchor': 'end', fill: DOWN_COLOR, 'font-size': '9', opacity: '0.6',
    'font-family': cssFont(), 'font-weight': '400', 'letter-spacing': '0.06em',
  });
  downLabel.textContent = 'DOWNLOAD';
  svg.appendChild(downLabel);
}

export function computeMirroredScales(
  plotTop: number,
  plotBottom: number,
  rawMaxUp: number,
  rawMaxDown: number,
): MirroredScales {
  const centerY = (plotTop + plotBottom) / 2;
  const maxUp = rawMaxUp || 1;
  const maxDown = rawMaxDown || 1;
  return {
    centerY,
    maxUp,
    maxDown,
    yUp: scale(0, maxUp, centerY, plotTop),
    yDown: scale(0, maxDown, centerY, plotBottom),
  };
}

export function replaceSlot<T>(arr: T[], slots: RateChartSlots, key: 'tmSlot' | 'hlSlot', value: T): void {
  if (slots[key] < 0) {
    slots[key] = arr.length;
    arr.push(value);
  } else {
    arr[slots[key]] = value;
  }
}

export function recreateRateOverlay(
  scaffold: ChartScaffold,
  timeMarkers: SVGLineElement[],
  hoverLines: SVGLineElement[],
  slots: RateChartSlots,
): SVGRectElement {
  const { svg, plotLeft, plotTop, plotBottom, plotW } = scaffold;

  const tm = svgEl('line', {
    x1: plotLeft, y1: plotTop, x2: plotLeft, y2: plotBottom,
    stroke: '#ffffff', 'stroke-width': '1', 'stroke-dasharray': '3,3', opacity: '0.5',
  }) as SVGLineElement;
  replaceSlot(timeMarkers, slots, 'tmSlot', tm);
  svg.appendChild(tm);

  const hl = svgEl('line', {
    x1: 0, y1: plotTop, x2: 0, y2: plotBottom,
    stroke: '#fff', 'stroke-width': '1', opacity: '0.3', display: 'none',
  }) as SVGLineElement;
  replaceSlot(hoverLines, slots, 'hlSlot', hl);
  svg.appendChild(hl);

  const overlay = svgEl('rect', {
    x: plotLeft, y: plotTop, width: plotW, height: plotBottom - plotTop,
    fill: 'transparent', cursor: 'crosshair',
  }) as SVGRectElement;
  svg.appendChild(overlay);

  return overlay;
}

export function drawMirroredAreas(
  svg: SVGSVGElement,
  xs: number[],
  upYs: number[],
  downYs: number[],
  centerY: number,
): void {
  const centerYs = new Array(xs.length).fill(centerY);

  svg.appendChild(svgEl('path', {
    d: areaPath(xs, upYs, centerYs),
    fill: UP_COLOR, 'fill-opacity': '0.3', stroke: 'none',
  }));
  svg.appendChild(svgEl('path', {
    d: linePath(xs, upYs),
    fill: 'none', stroke: UP_COLOR, 'stroke-width': '1.5',
  }));

  svg.appendChild(svgEl('path', {
    d: areaPath(xs, centerYs, downYs),
    fill: DOWN_COLOR, 'fill-opacity': '0.3', stroke: 'none',
  }));
  svg.appendChild(svgEl('path', {
    d: linePath(xs, downYs),
    fill: 'none', stroke: DOWN_COLOR, 'stroke-width': '1.5',
  }));
}
