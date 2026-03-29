import type { Decoder } from '../decoder-sdk';
import { ethp2pDecoder } from './ethp2p';
import { gossipsubDecoder } from './gossipsub';

const bundled = new Map<string, Decoder>();
bundled.set(ethp2pDecoder.name, ethp2pDecoder);
bundled.set(gossipsubDecoder.name, gossipsubDecoder);

export function getBundledDecoder(name: string): Decoder | undefined {
  return bundled.get(name);
}

export function listBundledDecoders(): string[] {
  return Array.from(bundled.keys());
}
