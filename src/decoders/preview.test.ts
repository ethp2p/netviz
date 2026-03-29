import { describe, it, expect } from 'vitest';
import { buildBundledDecoderPreview } from './preview';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validEthp2pHeader(): Record<string, unknown> {
  return {
    v: 1,
    t0: '2024-01-01T00:00:00Z',
    nodes: ['n0', 'n1'],
    topology: {
      nodes: [
        { num: 0, upload_bw_mbps: 10, download_bw_mbps: 10 },
        { num: 1, upload_bw_mbps: 10, download_bw_mbps: 10 },
      ],
      edges: [{ source: 0, target: 1, latency_ms: 20 }],
    },
    config: {},
  };
}

function validGossipsubHeader(): Record<string, unknown> {
  return {
    v: 1,
    t0: '2024-01-01T00:00:00Z',
    nodes: ['n0', 'n1'],
    peer_ids: ['peer-a', 'peer-b'],
    topology: {
      nodes: [
        { num: 0, upload_bw_mbps: 10, download_bw_mbps: 10 },
        { num: 1, upload_bw_mbps: 10, download_bw_mbps: 10 },
      ],
      edges: [{ source: 0, target: 1, latency_ms: 20 }],
    },
    config: {},
  };
}

// ---------------------------------------------------------------------------
// Unknown decoder
// ---------------------------------------------------------------------------

describe('buildBundledDecoderPreview — unknown decoder', () => {
  it('returns null for an unknown decoder name', () => {
    expect(buildBundledDecoderPreview('unknown', {})).toBeNull();
  });

  it('returns null for an empty string decoder name', () => {
    expect(buildBundledDecoderPreview('', {})).toBeNull();
  });

  it('returns null for a near-match name', () => {
    expect(buildBundledDecoderPreview('ETHP2P', {})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ethp2p — valid header
// ---------------------------------------------------------------------------

describe('buildBundledDecoderPreview — ethp2p', () => {
  it('returns non-null for a valid ethp2p header', () => {
    const result = buildBundledDecoderPreview('ethp2p', validEthp2pHeader());
    expect(result).not.toBeNull();
  });

  it('returns a DecoderOutput with all required top-level fields', () => {
    const result = buildBundledDecoderPreview('ethp2p', validEthp2pHeader());
    expect(result).toBeDefined();
    expect(result!.header).toBeDefined();
    expect(result!.events).toBeDefined();
    expect(result!.states).toBeDefined();
    expect(result!.arcLayers).toBeDefined();
    expect(result!.metrics).toBeDefined();
    expect(result!.milestones).toBeDefined();
    expect(result!.chartHints).toBeDefined();
  });

  it('produces nodes matching the header', () => {
    const result = buildBundledDecoderPreview('ethp2p', validEthp2pHeader());
    expect(result!.header.nodes).toHaveLength(2);
    expect(result!.header.nodes[0].name).toBe('n0');
    expect(result!.header.nodes[1].name).toBe('n1');
  });

  it('produces edges with latency converted from ms to µs', () => {
    const result = buildBundledDecoderPreview('ethp2p', validEthp2pHeader());
    expect(result!.header.edges).toHaveLength(1);
    expect(result!.header.edges[0].latency).toBe(20_000); // 20 ms → 20000 µs
  });

  it('returns zero events (preview has no event data)', () => {
    const result = buildBundledDecoderPreview('ethp2p', validEthp2pHeader());
    expect(result!.events.count).toBe(0);
    expect(result!.events.buf.byteLength).toBe(0);
  });

  it('returns an empty milestones array (no events to derive milestones from)', () => {
    const result = buildBundledDecoderPreview('ethp2p', validEthp2pHeader());
    expect(result!.milestones).toHaveLength(0);
  });

  it('returns an empty messages array', () => {
    const result = buildBundledDecoderPreview('ethp2p', validEthp2pHeader());
    expect(result!.messages).toHaveLength(0);
  });

  it('populates states with ethp2p-specific state names', () => {
    const result = buildBundledDecoderPreview('ethp2p', validEthp2pHeader());
    const names = result!.states.map(s => s.name);
    expect(names).toContain('idle');
    expect(names).toContain('decoded');
  });

  it('includes t0 in header.meta', () => {
    const result = buildBundledDecoderPreview('ethp2p', validEthp2pHeader());
    expect(result!.header.meta['t0']).toBe('2024-01-01T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// ethp2p — single-node header
// ---------------------------------------------------------------------------

describe('buildBundledDecoderPreview — ethp2p single node', () => {
  const singleNodeHeader: Record<string, unknown> = {
    v: 1,
    nodes: ['n0'],
    topology: {
      nodes: [{ num: 0, upload_bw_mbps: 0, download_bw_mbps: 0 }],
      edges: [],
    },
    config: {},
  };

  it('handles a single-node topology without throwing', () => {
    expect(() => buildBundledDecoderPreview('ethp2p', singleNodeHeader)).not.toThrow();
  });

  it('produces exactly 1 node and 0 edges', () => {
    const result = buildBundledDecoderPreview('ethp2p', singleNodeHeader);
    expect(result!.header.nodes).toHaveLength(1);
    expect(result!.header.edges).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ethp2p — legacy array-of-pairs topology
// ---------------------------------------------------------------------------

describe('buildBundledDecoderPreview — ethp2p legacy topology', () => {
  const legacyHeader: Record<string, unknown> = {
    v: 1,
    nodes: ['n0', 'n1'],
    topology: [[0, 1]],
    config: {},
  };

  it('handles legacy array-of-pairs topology without throwing', () => {
    expect(() => buildBundledDecoderPreview('ethp2p', legacyHeader)).not.toThrow();
  });

  it('normalizes legacy topology to produce edges', () => {
    const result = buildBundledDecoderPreview('ethp2p', legacyHeader);
    expect(result!.header.edges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ethp2p — unsupported version throws
// ---------------------------------------------------------------------------

describe('buildBundledDecoderPreview — ethp2p invalid version', () => {
  it('throws for an unsupported trace version', () => {
    const badHeader: Record<string, unknown> = {
      v: 99,
      nodes: [],
      topology: { nodes: [], edges: [] },
      config: {},
    };
    expect(() => buildBundledDecoderPreview('ethp2p', badHeader)).toThrow('Unsupported trace version');
  });
});

describe('buildBundledDecoderPreview — gossipsub', () => {
  it('returns non-null for a valid gossipsub header', () => {
    const result = buildBundledDecoderPreview('gossipsub', validGossipsubHeader());
    expect(result).not.toBeNull();
  });

  it('returns a preview with gossipsub-specific states', () => {
    const result = buildBundledDecoderPreview('gossipsub', validGossipsubHeader());
    const names = result!.states.map(s => s.name);
    expect(names).toContain('origin');
    expect(names).toContain('delivered');
  });
});
