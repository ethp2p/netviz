import type { CanonicalHeader } from '../decoder-sdk';
import { getEl } from './dom';

const COUNTRY_CODES: Record<string, string> = {
  'albania': 'AL', 'algeria': 'DZ', 'argentina': 'AR', 'australia': 'AU',
  'austria': 'AT', 'belgium': 'BE', 'brazil': 'BR', 'bulgaria': 'BG',
  'canada': 'CA', 'chile': 'CL', 'china': 'CN', 'colombia': 'CO',
  'croatia': 'HR', 'czech republic': 'CZ', 'denmark': 'DK', 'egypt': 'EG',
  'estonia': 'EE', 'finland': 'FI', 'france': 'FR', 'germany': 'DE',
  'greece': 'GR', 'hong kong': 'HK', 'hungary': 'HU', 'iceland': 'IS',
  'india': 'IN', 'indonesia': 'ID', 'ireland': 'IE', 'israel': 'IL',
  'italy': 'IT', 'japan': 'JP', 'latvia': 'LV', 'lithuania': 'LT',
  'luxembourg': 'LU', 'malaysia': 'MY', 'mexico': 'MX', 'netherlands': 'NL',
  'new zealand': 'NZ', 'nigeria': 'NG', 'norway': 'NO', 'pakistan': 'PK',
  'peru': 'PE', 'philippines': 'PH', 'poland': 'PL', 'portugal': 'PT',
  'romania': 'RO', 'russia': 'RU', 'saudi arabia': 'SA', 'serbia': 'RS',
  'singapore': 'SG', 'slovakia': 'SK', 'slovenia': 'SI', 'south africa': 'ZA',
  'south korea': 'KR', 'spain': 'ES', 'sweden': 'SE', 'switzerland': 'CH',
  'taiwan': 'TW', 'thailand': 'TH', 'turkey': 'TR', 'ukraine': 'UA',
  'united arab emirates': 'AE', 'united kingdom': 'GB', 'united states': 'US',
  'vietnam': 'VN',
};

function countryCode(name: string): string {
  return COUNTRY_CODES[name.toLowerCase()] ?? name.slice(0, 2).toUpperCase();
}

export function renderCountryDistribution(header: CanonicalHeader): void {
  const container = getEl('country-dist');
  container.replaceChildren();

  const nodes = header.nodes;
  if (!nodes.length || !nodes[0].props.country) return;

  const counts = new Map<string, number>();
  for (const n of nodes) {
    const c = (n.props.country as string | undefined) ?? 'unknown';
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const maxCount = sorted[0][1];

  const title = document.createElement('h3');
  title.textContent = 'Country distribution';
  container.appendChild(title);

  for (const [country, count] of sorted) {
    const row = document.createElement('div');
    row.className = 'cd-row';

    const label = document.createElement('span');
    label.className = 'cd-label';
    label.textContent = countryCode(country);

    const barBg = document.createElement('div');
    barBg.className = 'cd-bar-bg';
    const bar = document.createElement('div');
    bar.className = 'cd-bar';
    bar.style.width = (count / maxCount * 100) + '%';
    barBg.appendChild(bar);

    const countEl = document.createElement('span');
    countEl.className = 'cd-count';
    countEl.textContent = String(count);

    row.appendChild(label);
    row.appendChild(barBg);
    row.appendChild(countEl);
    container.appendChild(row);
  }
}

export function renderBandwidthDistribution(header: CanonicalHeader): void {
  const container = getEl('bw-dist');
  container.replaceChildren();

  const nodes = header.nodes;
  if (!nodes.length) return;

  const first = nodes[0].props;
  if (first.download_bw_mbps === undefined || first.upload_bw_mbps === undefined) return;

  const counts = new Map<string, number>();
  for (const n of nodes) {
    const key = n.props.download_bw_mbps + '/' + n.props.upload_bw_mbps;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = nodes.length;
  const maxCount = sorted[0][1];

  const title = document.createElement('h3');
  title.textContent = 'Bandwidth (down/up)';
  container.appendChild(title);

  for (const [bw, count] of sorted) {
    const pct = (count / total * 100).toFixed(1);
    const row = document.createElement('div');
    row.className = 'cd-row';

    const label = document.createElement('span');
    label.className = 'cd-label';
    label.style.width = 'auto';
    label.style.minWidth = '60px';
    label.textContent = bw;

    const barBg = document.createElement('div');
    barBg.className = 'cd-bar-bg';
    const bar = document.createElement('div');
    bar.className = 'cd-bar';
    bar.style.width = (count / maxCount * 100) + '%';
    barBg.appendChild(bar);

    const countEl = document.createElement('span');
    countEl.className = 'cd-count';
    countEl.textContent = pct + '%';

    row.appendChild(label);
    row.appendChild(barBg);
    row.appendChild(countEl);
    container.appendChild(row);
  }
}
