import { describe, it, expect, beforeEach } from 'vitest';
import { getAllDecoders, saveDecoder, removeDecoder } from './decoder-db';
import 'fake-indexeddb/auto';

beforeEach(async () => {
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    if (db.name) indexedDB.deleteDatabase(db.name);
  }
});

describe('decoder-db', () => {
  it('returns empty array when no decoders saved', async () => {
    expect(await getAllDecoders()).toEqual([]);
  });

  it('saves and retrieves a decoder', async () => {
    await saveDecoder({ name: 'test', version: '1.0', source: 'const decoder = {}', savedAt: 1000 });
    const all = await getAllDecoders();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('test');
    expect(all[0].source).toBe('const decoder = {}');
  });

  it('overwrites decoder with same name', async () => {
    await saveDecoder({ name: 'test', version: '1.0', source: 'v1', savedAt: 1000 });
    await saveDecoder({ name: 'test', version: '2.0', source: 'v2', savedAt: 2000 });
    const all = await getAllDecoders();
    expect(all).toHaveLength(1);
    expect(all[0].version).toBe('2.0');
  });

  it('removes a decoder by name', async () => {
    await saveDecoder({ name: 'a', version: '1', source: 'a', savedAt: 1 });
    await saveDecoder({ name: 'b', version: '1', source: 'b', savedAt: 2 });
    await removeDecoder('a');
    const all = await getAllDecoders();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('b');
  });

  it('remove is a no-op for missing name', async () => {
    await removeDecoder('nonexistent');
    expect(await getAllDecoders()).toEqual([]);
  });
});
