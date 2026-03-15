import type { DecoderOutput } from '../decoder-sdk';
import { buildEthp2pPreview } from './ethp2p';

export function buildBundledDecoderPreview(
  decoderName: string,
  rawHeader: Record<string, unknown>,
): DecoderOutput | null {
  switch (decoderName) {
    case 'ethp2p':
      return buildEthp2pPreview(rawHeader);
    default:
      return null;
  }
}
