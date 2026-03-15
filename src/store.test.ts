import { describe, it, expect } from 'vitest';
import { createStore } from './store';

describe('createStore', () => {
  it('can be imported and called without error', () => {
    expect(() => createStore()).not.toThrow();
  });

  it('returns a fresh object on each call (no shared reference)', () => {
    const a = createStore();
    const b = createStore();
    expect(a).not.toBe(b);
  });

  // Nullable / absent fields start as null or empty
  it('initialises nullable decoder fields to null', () => {
    const s = createStore();
    expect(s.decoderOutput).toBeNull();
    expect(s.eventBuf).toBeNull();
    expect(s.topoGraph).toBeNull();
    expect(s.eventIndex).toBeNull();
    expect(s.incState).toBeNull();
    expect(s.nodeMeta).toBeNull();
    expect(s.hoverHighlight).toBeNull();
    expect(s.chartControls).toBeNull();
  });

  it('initialises numeric counters to their sentinel/zero values', () => {
    const s = createStore();
    expect(s.eventCount).toBe(0);
    expect(s.decodedStateIdx).toBe(-1);
    expect(s.originNode).toBe(-1);
    expect(s.selectedNode).toBe(-1);
    expect(s.hoveredNode).toBe(-1);
    expect(s.currentTime).toBe(0);
    expect(s.speed).toBe(1);
    expect(s.timeOffset).toBe(0);
  });

  it('initialises boolean flags correctly', () => {
    const s = createStore();
    expect(s.playing).toBe(false);
    expect(s.nodeClickHandled).toBe(false);
    expect(s.previewingLoad).toBe(false);
  });

  it('initialises array fields to empty arrays', () => {
    const s = createStore();
    expect(s.logTexts).toEqual([]);
    expect(s.overlayMaxes).toEqual([]);
    expect(s.nodeColors).toEqual([]);
    expect(s.timeIndex).toEqual([]);
    expect(s.nodePositions).toEqual([]);
    expect(s.enabledArcLayers).toEqual([]);
  });

  it('initialises layoutMode to "force"', () => {
    const s = createStore();
    expect(s.layoutMode).toBe('force');
  });

  it('initialises graphSettings with an empty ringToggles array', () => {
    const s = createStore();
    expect(s.graphSettings).toEqual({ ringToggles: [] });
  });

  it('initialises eventFilter with four empty Sets', () => {
    const s = createStore();
    expect(s.eventFilter.opcodes).toBeInstanceOf(Set);
    expect(s.eventFilter.arcLayers).toBeInstanceOf(Set);
    expect(s.eventFilter.metrics).toBeInstanceOf(Set);
    expect(s.eventFilter.eventTypes).toBeInstanceOf(Set);
    expect(s.eventFilter.opcodes.size).toBe(0);
    expect(s.eventFilter.arcLayers.size).toBe(0);
    expect(s.eventFilter.metrics.size).toBe(0);
    expect(s.eventFilter.eventTypes.size).toBe(0);
  });

  it('returns independent eventFilter Sets on each call', () => {
    const a = createStore();
    const b = createStore();
    a.eventFilter.opcodes.add(1);
    expect(b.eventFilter.opcodes.size).toBe(0);
  });

  it('returns independent graphSettings.ringToggles arrays on each call', () => {
    const a = createStore();
    const b = createStore();
    a.graphSettings.ringToggles.push(true);
    expect(b.graphSettings.ringToggles).toEqual([]);
  });

  it('allows direct state mutation (plain object, no proxy)', () => {
    const s = createStore();
    s.currentTime = 42_000;
    expect(s.currentTime).toBe(42_000);

    s.playing = true;
    expect(s.playing).toBe(true);

    s.selectedNode = 3;
    expect(s.selectedNode).toBe(3);
  });
});
