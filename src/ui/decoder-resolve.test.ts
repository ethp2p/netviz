import { describe, it, expect } from 'vitest';
import { resolveDecoder } from './decoder-resolve';

describe('resolveDecoder', () => {
  const bundled = ['ethp2p', 'libp2p'];
  const user = [{ name: 'custom', source: 'const decoder = ...' }];

  it('resolves bundled decoder by name', () => {
    const result = resolveDecoder('ethp2p', bundled, user);
    expect(result).toEqual({ kind: 'bundled', name: 'ethp2p' });
  });

  it('resolves user decoder by name', () => {
    const result = resolveDecoder('custom', bundled, user);
    expect(result).toEqual({ kind: 'user', name: 'custom', source: 'const decoder = ...' });
  });

  it('user decoder shadows bundled decoder with same name', () => {
    const shadowing = [{ name: 'ethp2p', source: 'custom source' }];
    const result = resolveDecoder('ethp2p', bundled, shadowing);
    expect(result).toEqual({ kind: 'user', name: 'ethp2p', source: 'custom source' });
  });

  it('returns null when no match', () => {
    expect(resolveDecoder('unknown', bundled, user)).toBeNull();
  });

  it('returns null when decoderName is undefined', () => {
    expect(resolveDecoder(undefined, bundled, user)).toBeNull();
  });
});
