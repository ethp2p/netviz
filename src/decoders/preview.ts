import type { DecoderOutput } from '../decoder-sdk';
import { buildEthp2pPreview } from './ethp2p';
import { buildGossipsubPreview } from './gossipsub';

export function buildBundledDecoderPreview(
  decoderName: string,
  rawHeader: Record<string, unknown>,
): DecoderOutput | null {
  switch (decoderName) {
    case 'ethp2p':
      return buildEthp2pPreview(rawHeader);
    case 'gossipsub':
      return buildGossipsubPreview(rawHeader);
    default:
      return null;
  }
}
