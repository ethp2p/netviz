import { svgEl, areaPath, linePath, BAND_OPACITIES, HIGHLIGHT_BOOST, PCT_LABELS, UP_COLOR, DOWN_COLOR } from './helpers';
import { formatTime } from '../format';

interface BandState {
  upBands: SVGPathElement[];
  downBands: SVGPathElement[];
  reset(): void;
  highlight(bandIdx: number): void;
}

interface MouseOpts {
  svg: SVGSVGElement;
  overlay: SVGRectElement;
  tooltip: HTMLElement;
  chartWidth: number;
  tooltipMaxOffset: number;
  xInv: (v: number) => number;
  tooltipIdx: number;
  setCrosshair: (t: number | null, idx: number) => void;
  onMove: (t: number, mx: number, my: number) => string;
  onLeave?: () => void;
}

export function drawPercentileBands(
  svg: SVGSVGElement,
  xs: number[],
  samples: ReadonlyArray<{ up: number[]; down: number[] }>,
  yUp: (v: number) => number,
  yDown: (v: number) => number,
  centerY: number,
): BandState {
  const centerYs = new Array(xs.length).fill(centerY);
  const upBands: SVGPathElement[] = [];
  const downBands: SVGPathElement[] = [];

  for (let bi = 4; bi >= 0; bi--) {
    const upperUp = samples.map(s => yUp(s.up[bi]));
    const lowerUp = bi > 0 ? samples.map(s => yUp(s.up[bi - 1])) : centerYs;
    const upperDown = samples.map(s => yDown(s.down[bi]));
    const lowerDown = bi > 0 ? samples.map(s => yDown(s.down[bi - 1])) : centerYs;

    const opacity = BAND_OPACITIES[bi];

    const upBand = svgEl('path', {
      d: areaPath(xs, upperUp, lowerUp),
      fill: UP_COLOR, 'fill-opacity': String(opacity), stroke: 'none',
    }) as SVGPathElement;
    upBand.dataset.band = String(bi);
    svg.appendChild(upBand);
    upBands.push(upBand);

    const downBand = svgEl('path', {
      d: areaPath(xs, lowerDown, upperDown),
      fill: DOWN_COLOR, 'fill-opacity': String(opacity), stroke: 'none',
    }) as SVGPathElement;
    downBand.dataset.band = String(bi);
    svg.appendChild(downBand);
    downBands.push(downBand);
  }

  // Percentile lines (upload side, faint)
  for (let pi = 0; pi < 5; pi++) {
    const ys = samples.map(s => yUp(s.up[pi]));
    svg.appendChild(svgEl('path', {
      d: linePath(xs, ys),
      fill: 'none', stroke: UP_COLOR, 'stroke-width': '0.5', opacity: '0.3',
    }));
  }

  function reset() {
    for (let i = 0; i < upBands.length; i++) {
      const bi = 4 - i;
      upBands[i].setAttribute('fill-opacity', String(BAND_OPACITIES[bi]));
      downBands[i].setAttribute('fill-opacity', String(BAND_OPACITIES[bi]));
    }
  }

  function highlight(bandIdx: number) {
    for (let i = 0; i < upBands.length; i++) {
      const bi = 4 - i;
      const baseOp = BAND_OPACITIES[bi];
      const op = bi === bandIdx ? Math.min(1, baseOp + HIGHLIGHT_BOOST) : baseOp * 0.5;
      upBands[i].setAttribute('fill-opacity', String(op));
      downBands[i].setAttribute('fill-opacity', String(op));
    }
  }

  return { upBands, downBands, reset, highlight };
}

// Detect which percentile band the mouse is hovering over.
export function detectHoveredBand(
  my: number,
  centerY: number,
  sample: { up: number[]; down: number[] },
  yUp: (v: number) => number,
  yDown: (v: number) => number,
): number {
  if (my < centerY) {
    for (let bi = 0; bi < 5; bi++) {
      if (my >= yUp(sample.up[bi])) return bi;
    }
    return 4;
  }
  for (let bi = 0; bi < 5; bi++) {
    if (my <= yDown(sample.down[bi])) return bi;
  }
  return 4;
}

// Build the HTML for a percentile band tooltip.
export function bandTooltipHtml(
  sample: { time: number; up: number[]; down: number[] },
  hoveredBand: number,
  formatVal: (v: number) => string,
): string {
  let html = '<span class="tt-time">' + formatTime(sample.time) + '</span>';
  for (let pi = 4; pi >= 0; pi--) {
    const active = pi === hoveredBand;
    const weight = active ? 'font-weight:600;' : 'opacity:0.6;';
    const arrow = active ? ' \u25C0' : '';
    html += '<div style="' + weight + 'display:flex;gap:6px;justify-content:space-between">' +
      '<span>' + PCT_LABELS[pi] + '</span>' +
      '<span style="color:' + UP_COLOR + '">' + formatVal(sample.up[pi]) + '</span>' +
      '<span style="color:' + DOWN_COLOR + '">' + formatVal(sample.down[pi]) + '</span>' +
      arrow + '</div>';
  }
  return html;
}

export function wireMouseEvents(opts: MouseOpts): void {
  opts.overlay.addEventListener('mousemove', (e: Event) => {
    const me = e as MouseEvent;
    const rect = opts.svg.getBoundingClientRect();
    const mx = me.clientX - rect.left;
    const my = me.clientY - rect.top;
    const t = opts.xInv(mx);

    opts.setCrosshair(t, opts.tooltipIdx);

    opts.tooltip.style.display = 'block';
    opts.tooltip.style.left = Math.min(mx + 8, opts.chartWidth - opts.tooltipMaxOffset) + 'px';
    opts.tooltip.style.top = '4px';
    // safe: onMove returns HTML built from formatTime/formatBytes/formatRate (numeric) and static strings only
    opts.tooltip.innerHTML = opts.onMove(t, mx, my);
  });

  opts.overlay.addEventListener('mouseleave', () => {
    opts.setCrosshair(null, opts.tooltipIdx);
    opts.tooltip.style.display = 'none';
    opts.onLeave?.();
  });
}
