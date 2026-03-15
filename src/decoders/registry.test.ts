import { describe, it, expect } from 'vitest';
import { getBundledDecoder } from './registry';

describe('getBundledDecoder', () => {
  it('returns a Decoder for the bundled ethp2p decoder', () => {
    const decoder = getBundledDecoder('ethp2p');
    expect(decoder).toBeDefined();
    expect(decoder?.name).toBe('ethp2p');
    expect(typeof decoder?.decode).toBe('function');
  });

  it('returns undefined for an unknown decoder name', () => {
    expect(getBundledDecoder('nonexistent')).toBeUndefined();
  });
});
