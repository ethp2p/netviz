import { describe, it, expect } from 'vitest';
import { createLineSplitter } from './line-splitter';

async function collectLines(chunks: string[]): Promise<string[]> {
  const splitter = createLineSplitter();

  const lines: string[] = [];
  const readAll = (async () => {
    const reader = splitter.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lines.push(value);
    }
  })();

  const writer = splitter.writable.getWriter();
  for (const chunk of chunks) {
    await writer.write(chunk);
  }
  await writer.close();
  await readAll;

  return lines;
}

describe('createLineSplitter', () => {
  it('splits a single chunk on newlines', async () => {
    const lines = await collectLines(['aaa\nbbb\nccc']);
    expect(lines).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('handles chunk ending with newline', async () => {
    const lines = await collectLines(['aaa\nbbb\n']);
    expect(lines).toEqual(['aaa', 'bbb']);
  });

  it('buffers partial lines across chunks', async () => {
    const lines = await collectLines(['aa', 'a\nbbb\n']);
    expect(lines).toEqual(['aaa', 'bbb']);
  });

  it('handles many small chunks', async () => {
    const lines = await collectLines(['a', 'b', '\n', 'c', 'd', '\n']);
    expect(lines).toEqual(['ab', 'cd']);
  });

  it('flushes partial line at end of stream', async () => {
    const lines = await collectLines(['aaa\nbb']);
    expect(lines).toEqual(['aaa', 'bb']);
  });

  it('handles empty input', async () => {
    const lines = await collectLines([]);
    expect(lines).toEqual([]);
  });

  it('handles single line with no newline', async () => {
    const lines = await collectLines(['hello']);
    expect(lines).toEqual(['hello']);
  });

  it('handles multiple newlines producing empty lines', async () => {
    const lines = await collectLines(['a\n\nb\n']);
    expect(lines).toEqual(['a', '', 'b']);
  });
});
