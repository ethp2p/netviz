import type { Milestone, RGBA } from './types';

export function milestone(time: number, label: string, color: RGBA): Milestone {
  return { time, label, color };
}

export function percentileMilestones(
  times: number[],
  label: string,
  color: RGBA,
  percentiles: number[] = [50, 80, 90, 95],
): Milestone[] {
  if (times.length === 0) return [];
  const sorted = times.slice().sort((a, b) => a - b);
  const out: Milestone[] = [];
  for (const pct of percentiles) {
    const idx = Math.min(Math.ceil(sorted.length * pct / 100) - 1, sorted.length - 1);
    out.push({ time: sorted[idx], label: 'p' + pct + ' ' + label, color });
  }
  return out;
}
