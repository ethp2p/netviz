/**
 * A TransformStream that splits a text stream on newline boundaries.
 * Buffers partial lines across chunks and emits complete lines.
 * Empty trailing lines (from a terminal '\n') are not emitted.
 */
export function createLineSplitter(): TransformStream<string, string> {
  let partial = '';
  return new TransformStream<string, string>({
    transform(chunk, controller) {
      const text = partial + chunk;
      const lines = text.split('\n');
      // Last element is either '' (chunk ended on \n) or a partial line
      partial = lines.pop()!;
      for (const line of lines) {
        controller.enqueue(line);
      }
    },
    flush(controller) {
      if (partial.length > 0) {
        controller.enqueue(partial);
        partial = '';
      }
    },
  });
}
