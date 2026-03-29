import { describe, it, expect } from 'vitest';
import { EVENT_STRIDE, OP_LINK, OP_TRANSFER } from '../decoder-sdk';
import { gossipsubDecoder } from './gossipsub';

function header(): string {
  return JSON.stringify({
    v: 1,
    decoderName: 'gossipsub',
    t0: '2026-03-28T00:00:00Z',
    nodes: ['n0', 'n1'],
    peer_ids: ['peer-a', 'peer-b'],
    topology: {
      nodes: [
        { num: 0, upload_bw_mbps: 10, download_bw_mbps: 10 },
        { num: 1, upload_bw_mbps: 10, download_bw_mbps: 10 },
      ],
      edges: [{ source: 0, target: 1, latency_ms: 20 }],
    },
    config: { name: 'gossipsub' },
  });
}

function headerWithoutPeerIds(): string {
  return JSON.stringify({
    v: 1,
    decoderName: 'gossipsub',
    t0: '2026-03-28T00:00:00Z',
    nodes: ['n0', 'n1'],
    topology: {
      nodes: [
        { num: 0, upload_bw_mbps: 10, download_bw_mbps: 10 },
        { num: 1, upload_bw_mbps: 10, download_bw_mbps: 10 },
      ],
      edges: [{ source: 0, target: 1, latency_ms: 20 }],
    },
    config: { name: 'gossipsub' },
  });
}

function event(row: unknown[]): string {
  return JSON.stringify(row);
}

function hasTransfer(out: ReturnType<typeof gossipsubDecoder.decode>, peerIdx: number, layer: number): boolean {
  for (let i = 0; i < out.events.count; i++) {
    const base = i * EVENT_STRIDE;
    if (out.events.buf[base + 2] !== OP_TRANSFER) continue;
    if (out.events.buf[base + 3] === peerIdx && out.events.buf[base + 5] === layer) return true;
  }
  return false;
}

function hasLink(out: ReturnType<typeof gossipsubDecoder.decode>, peerIdx: number, connected: number): boolean {
  for (let i = 0; i < out.events.count; i++) {
    const base = i * EVENT_STRIDE;
    if (out.events.buf[base + 2] !== OP_LINK) continue;
    if (out.events.buf[base + 3] === peerIdx && out.events.buf[base + 4] === connected) return true;
  }
  return false;
}

describe('gossipsubDecoder', () => {
  it('exposes the bundled decoder contract', () => {
    expect(gossipsubDecoder.name).toBe('gossipsub');
    expect(typeof gossipsubDecoder.version).toBe('string');
    expect(typeof gossipsubDecoder.decode).toBe('function');
  });

  it('decodes message, control, and mesh events using peer_ids', () => {
    const lines = [
      header(),
      event([0, 0, 'pb', 'broadcast-test', 'msg-0', 512]),
      event([5, 0, 'mg', 'peer-b', 'broadcast-test']),
      event([10, 0, 'hs', 'peer-b', 'broadcast-test', 'msg-0', 2]),
      event([20, 1, 'hr', 'peer-a', 'broadcast-test', 'msg-0', 2]),
      event([30, 1, 'ws', 'peer-a', 'broadcast-test', 'msg-0', 1]),
      event([40, 0, 'wr', 'peer-b', 'broadcast-test', 'msg-0', 1]),
      event([50, 0, 'ms', 'peer-b', 'broadcast-test', 'msg-0', 512]),
      event([60, 1, 'va', 'peer-a', 'broadcast-test', 'msg-0']),
      event([70, 1, 'dl', 'peer-a', 'broadcast-test', 'msg-0']),
      '',
    ];

    const out = gossipsubDecoder.decode(lines);

    expect(out.header.meta['config']).toEqual({ name: 'gossipsub' });
    expect(out.messages).toHaveLength(1);
    expect(out.messages?.[0].id).toBe('msg-0');
    expect(out.messages?.[0].label).toContain('deliveries');
    expect(hasTransfer(out, 1, 0)).toBe(true); // message
    expect(hasTransfer(out, 1, 1)).toBe(true); // IHAVE
    expect(hasTransfer(out, 0, 2)).toBe(true); // IWANT from node 1 -> node 0
    expect(hasLink(out, 1, 1)).toBe(true);     // mesh graft
    expect(out.events.logTexts.some(t => t.includes('peer=peer-b'))).toBe(true);
  });

  it('selects a specific message ID', () => {
    const lines = [
      header(),
      event([0, 0, 'pb', 'broadcast-test', 'msg-a', 100]),
      event([10, 1, 'dl', 'peer-a', 'broadcast-test', 'msg-a']),
      event([20, 0, 'pb', 'broadcast-test', 'msg-b', 100]),
      event([30, 1, 'dl', 'peer-a', 'broadcast-test', 'msg-b']),
      '',
    ];

    const out = gossipsubDecoder.decode(lines, { messageId: 'msg-b' });
    expect(out.messages?.map(m => m.id)).toEqual(['msg-a', 'msg-b']);
    expect(out.events.logTexts.some(t => t.includes('msg-a'))).toBe(false);
    expect(out.events.logTexts.some(t => t.includes('msg-b'))).toBe(true);
  });

  it('infers peer mapping from topology when peer_ids are missing', () => {
    const lines = [
      headerWithoutPeerIds(),
      event([0, 0, 'pb', 'broadcast-test', 'msg-0', 512]),
      event([10, 0, 'hs', '12D3KooWB', 'broadcast-test', 'msg-0', 1]),
      event([20, 0, 'ms', '12D3KooWB', 'broadcast-test', 'msg-0', 512]),
      event([30, 1, 'hr', '12D3KooWA', 'broadcast-test', 'msg-0', 1]),
      event([40, 1, 'dl', '12D3KooWA', 'broadcast-test', 'msg-0']),
      '',
    ];

    const out = gossipsubDecoder.decode(lines);

    expect(hasTransfer(out, 1, 0)).toBe(true);
    expect(hasTransfer(out, 1, 1)).toBe(true);
  });
});
