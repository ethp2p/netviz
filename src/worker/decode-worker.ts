import type { DecoderOutput, DecodeOptions, Decoder } from '../decoder-sdk';
import * as SDK from '../decoder-sdk';
import { getBundledDecoder } from '../decoders/registry';

const SDK_API = Object.freeze({ ...SDK });

// Expose SDK globally for user decoders that reference it directly.
(self as unknown as Record<string, unknown>).SDK = SDK_API;

interface DecodeStartRequest {
  kind: 'decode-start';
  decoderSrc: string | null;
  decoderName?: string;
  options?: DecodeOptions;
}

interface DecodeLinesRequest {
  kind: 'decode-lines';
  lines: string[];
}

interface DecodeEndRequest {
  kind: 'decode-end';
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

interface DecodeErrorMessage {
  kind: 'error';
  message: string;
}

interface ValidateRequest {
  kind: 'validate-decoder';
  source: string;
}

interface DecoderValidatedMessage {
  kind: 'decoder-validated';
  name: string;
  version: string;
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

function postProgress(msg: DecodeProgressMessage): void {
  (self as unknown as Worker).postMessage(msg);
}

function runDecode(lines: string[], decoderSrc: string | null, decoderName?: string, options?: DecodeOptions): DecoderOutput {
  postProgress({ kind: 'progress', label: 'Resolving decoder...', percent: 0.58 });
  const decoder = resolveDecoder(decoderSrc, decoderName);
  postProgress({ kind: 'progress', label: 'Scanning messages and decoding events...', indeterminate: true });
  const rawOutput = decoder.decode(lines, options);
  postProgress({ kind: 'progress', label: 'Normalizing decoder output...', percent: 0.86 });
  const normalized = SDK.normalizeDecoderOutput(rawOutput);
  postProgress({ kind: 'progress', label: 'Validating decoded trace...', percent: 0.92 });
  return SDK.validateDecoderOutput(normalized);
}

interface ReDecodeRequest {
  kind: 're-decode';
  decoderSrc: string | null;
  decoderName?: string;
  options?: DecodeOptions;
}

// Streaming decode state: accumulates lines across decode-lines messages.
let pendingLines: string[] = [];
let pendingDecoderSrc: string | null = null;
let pendingDecoderName: string | undefined;
let pendingOptions: DecodeOptions | undefined;
// Retained after decode for re-decode (message re-selection, decoder switch).
let retainedLines: string[] = [];

type WorkerRequest = DecodeStartRequest | DecodeLinesRequest | DecodeEndRequest | ReDecodeRequest | ValidateRequest;

self.addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;

  if (req.kind === 'validate-decoder') {
    try {
      const decoder = loadDecoderFromSource(req.source);
      (self as unknown as Worker).postMessage({
        kind: 'decoder-validated',
        name: decoder.name,
        version: decoder.version,
      } satisfies DecoderValidatedMessage);
    } catch (err) {
      (self as unknown as Worker).postMessage({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      } satisfies DecodeErrorMessage);
    }
    return;
  }

  if (req.kind === 'decode-start') {
    pendingLines = [];
    pendingDecoderSrc = req.decoderSrc;
    pendingDecoderName = req.decoderName;
    pendingOptions = req.options;
    return;
  }

  if (req.kind === 'decode-lines') {
    for (const line of req.lines) {
      pendingLines.push(line);
    }
    return;
  }

  if (req.kind === 'decode-end') {
    retainedLines = pendingLines;
    const decoderSrc = pendingDecoderSrc;
    const decoderName = pendingDecoderName;
    const options = pendingOptions;
    pendingLines = [];
    pendingDecoderSrc = null;
    pendingDecoderName = undefined;
    pendingOptions = undefined;

    try {
      const output = runDecode(retainedLines, decoderSrc, decoderName, options);
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
    return;
  }

  if (req.kind === 're-decode') {
    try {
      const output = runDecode(retainedLines, req.decoderSrc, req.decoderName, req.options);
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
    return;
  }
});
