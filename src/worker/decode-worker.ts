import type { DecoderOutput, DecodeOptions, Decoder } from '../decoder-sdk';
import * as SDK from '../decoder-sdk';
import { getBundledDecoder } from '../decoders/registry';

const SDK_API = Object.freeze({ ...SDK });

// Expose SDK globally for user decoders that reference it directly.
(self as unknown as Record<string, unknown>).SDK = SDK_API;

interface DecodeRequest {
  lines: string[];
  decoderSrc: string | null;
  decoderName?: string;
  options?: DecodeOptions;
}

interface DecodeProgressMessage {
  kind: 'progress';
  label: string;
  percent?: number;
  indeterminate?: boolean;
}

interface DecodeResultMessage {
  kind: 'result';
  output: DecoderOutput;
}

// safe: new Function() is intentional — this worker executes user-supplied decoder scripts
// that cannot be bundled at build time. The worker sandbox isolates execution from the main
// thread; SDK_API is a frozen object to prevent mutation by the decoder.
function loadDecoderFromSource(decoderSrc: string): Decoder {
  const factory = new Function(
    'SDK',
    '"use strict";\n'
      + decoderSrc
      + '\n//# sourceURL=viz-user-decoder.js\n'
      + 'return decoder;',
  );
  const decoder = factory(SDK_API);
  SDK.assertDecoder(decoder);
  return decoder;
}

function resolveDecoder(decoderSrc: string | null, decoderName?: string): Decoder {
  let decoder: Decoder;

  if (decoderSrc) {
    decoder = loadDecoderFromSource(decoderSrc);
  } else if (decoderName) {
    const bundled = getBundledDecoder(decoderName);
    if (!bundled) throw new Error('Unknown bundled decoder: ' + decoderName);
    SDK.assertDecoder(bundled);
    decoder = bundled;
  } else {
    throw new Error('No decoder specified');
  }

  return decoder;
}

function decodeRequest(request: DecodeRequest): DecoderOutput {
  const { lines, decoderSrc, decoderName, options } = request;
  (self as unknown as Worker).postMessage({
    kind: 'progress',
    label: 'Resolving decoder...',
    percent: 0.58,
  } satisfies DecodeProgressMessage);
  const decoder = resolveDecoder(decoderSrc, decoderName);
  (self as unknown as Worker).postMessage({
    kind: 'progress',
    label: 'Scanning messages and decoding events...',
    indeterminate: true,
  } satisfies DecodeProgressMessage);
  const rawOutput = decoder.decode(lines, options);
  (self as unknown as Worker).postMessage({
    kind: 'progress',
    label: 'Normalizing decoder output...',
    percent: 0.86,
  } satisfies DecodeProgressMessage);
  const normalized = SDK.normalizeDecoderOutput(rawOutput);
  (self as unknown as Worker).postMessage({
    kind: 'progress',
    label: 'Validating decoded trace...',
    percent: 0.92,
  } satisfies DecodeProgressMessage);
  return SDK.validateDecoderOutput(normalized);
}

interface DecodeErrorMessage {
  kind: 'error';
  message: string;
}

self.addEventListener('message', (e: MessageEvent<DecodeRequest>) => {
  try {
    const output = decodeRequest(e.data);
    const transferables: Transferable[] = [output.events.buf.buffer];
    (self as unknown as Worker).postMessage({
      kind: 'result',
      output,
    } satisfies DecodeResultMessage, transferables);
  } catch (err) {
    (self as unknown as Worker).postMessage({
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies DecodeErrorMessage);
  }
});
