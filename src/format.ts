export type RateUnit = 'MBs' | 'Mbits';

export function formatBytes(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(2) + ' MB';
}

export function formatRate(bytesPerSec: number, unit: RateUnit): string {
  if (unit === 'Mbits') {
    const mbits = (bytesPerSec * 8) / 1_000_000;
    if (mbits < 1) return mbits.toFixed(2) + ' Mbit/s';
    if (mbits < 100) return mbits.toFixed(1) + ' Mbit/s';
    return Math.round(mbits) + ' Mbit/s';
  }
  const mbs = bytesPerSec / (1024 * 1024);
  if (mbs < 1) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
  if (mbs < 100) return mbs.toFixed(1) + ' MB/s';
  return Math.round(mbs) + ' MB/s';
}

export function formatTime(us: number): string {
  const sign = us < 0 ? '-' : '';
  return sign + (Math.abs(us) / 1000).toFixed(3) + 'ms';
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatDefinitionName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function toCss(color?: [number, number, number, number]): string | null {
  if (!color) return null;
  return `rgb(${color[0]},${color[1]},${color[2]})`;
}
