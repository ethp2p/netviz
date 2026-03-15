// Layout constants
export const MARGIN = { top: 6, right: 6, bottom: 18, left: 40 };
export const CDF_HEIGHT = 110;
export const BW_HEIGHT = 150;

export const PCT_LABELS = ['p50', 'p80', 'p90', 'p95', 'p99'];

export function cssFont(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--font').trim();
}

// Colors
export const UP_COLOR = '#00ddff';
export const DOWN_COLOR = '#ff9944';

// Band opacities from inner (p50) to outer (p99)
export const BAND_OPACITIES = [0.55, 0.40, 0.30, 0.20, 0.12];
export const HIGHLIGHT_BOOST = 0.25;

// Linear scale: domain -> range
export function scale(d0: number, d1: number, r0: number, r1: number) {
  const dSpan = d1 - d0 || 1;
  return (v: number) => r0 + ((v - d0) / dSpan) * (r1 - r0);
}

export function scaleInv(d0: number, d1: number, r0: number, r1: number) {
  const rSpan = r1 - r0 || 1;
  return (v: number) => d0 + ((v - r0) / rSpan) * (d1 - d0);
}

export function svgEl(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v));
  }
  return el;
}

export function areaPath(
  xs: number[],
  yTop: number[],
  yBottom: number[],
): string {
  if (xs.length === 0) return '';
  let d = `M${xs[0]},${yTop[0]}`;
  for (let i = 1; i < xs.length; i++) {
    d += `L${xs[i]},${yTop[i]}`;
  }
  for (let i = xs.length - 1; i >= 0; i--) {
    d += `L${xs[i]},${yBottom[i]}`;
  }
  d += 'Z';
  return d;
}

export function stepPath(xs: number[], ys: number[]): string {
  if (xs.length === 0) return '';
  let d = `M${xs[0]},${ys[0]}`;
  for (let i = 1; i < xs.length; i++) {
    d += `H${xs[i]}V${ys[i]}`;
  }
  return d;
}

export function stepAreaPath(xs: number[], ys: number[], baseline: number): string {
  if (xs.length === 0) return '';
  let d = `M${xs[0]},${baseline}V${ys[0]}`;
  for (let i = 1; i < xs.length; i++) {
    d += `H${xs[i]}V${ys[i]}`;
  }
  d += `V${baseline}Z`;
  return d;
}

export function linePath(xs: number[], ys: number[]): string {
  if (xs.length === 0) return '';
  let d = `M${xs[0]},${ys[0]}`;
  for (let i = 1; i < xs.length; i++) {
    d += `L${xs[i]},${ys[i]}`;
  }
  return d;
}

export function addYLabels(
  svg: SVGElement,
  values: number[],
  yScale: (v: number) => number,
  formatter: (v: number) => string,
  plotLeft: number,
  plotRight: number,
) {
  for (const v of values) {
    const y = yScale(v);
    const text = svgEl('text', {
      x: plotLeft - 4,
      y: y + 3,
      'text-anchor': 'end',
      fill: '#71717a',
      'font-size': '9',
      'font-family': cssFont(),
    });
    text.textContent = formatter(v);
    svg.appendChild(text);

    svg.appendChild(svgEl('line', {
      x1: plotLeft, y1: y, x2: plotRight, y2: y,
      stroke: '#27272a', 'stroke-width': '1',
    }));
  }
}

export function nearestIdx(times: number[], target: number): number {
  let lo = 0, hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(times[lo - 1] - target) < Math.abs(times[lo] - target)) {
    return lo - 1;
  }
  return lo;
}

export function addSlackOverlays(
  svg: SVGElement,
  dataRange: [number, number],
  focusRange: [number, number],
  xScale: (v: number) => number,
  plotTop: number,
  plotBottom: number,
) {
  const [dMin, dMax] = dataRange;
  const [fMin, fMax] = focusRange;
  const slackColor = '#18181b';
  const slackOpacity = '0.7';

  if (fMin > dMin) {
    const x1 = xScale(dMin);
    const x2 = xScale(fMin);
    svg.appendChild(svgEl('rect', {
      x: x1, y: plotTop, width: x2 - x1, height: plotBottom - plotTop,
      fill: slackColor, opacity: slackOpacity,
    }));
  }
  if (fMax < dMax) {
    const x1 = xScale(fMax);
    const x2 = xScale(dMax);
    svg.appendChild(svgEl('rect', {
      x: x1, y: plotTop, width: x2 - x1, height: plotBottom - plotTop,
      fill: slackColor, opacity: slackOpacity,
    }));
  }
}
