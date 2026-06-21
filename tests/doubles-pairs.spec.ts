import { describe, expect, it } from 'vitest';
import {
  formRandomPairs,
  getTrackFormat,
  getTrackPairs,
  pairHandicapValue,
  pairDisplayLabel,
} from '../src/doubles-track';
import { createTournament, isHandicapActive, normalizeHandicapConfig } from '../src/model';

describe('formRandomPairs', () => {
  it('is deterministic for the same seed', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const a = formRandomPairs(ids, 'seed-a');
    const b = formRandomPairs(ids, 'seed-a');
    expect(a).toEqual(b);
    expect(a.length).toBe(3);
    const allPlayers = a.flatMap((p) => [...p.playerIds]).sort();
    expect(allPlayers).toEqual([...ids].sort());
  });

  it('differs for different seeds', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
    const a = formRandomPairs(ids, 'seed-a');
    const b = formRandomPairs(ids, 'seed-b');
    expect(a).not.toEqual(b);
  });
});

describe('pairHandicapValue', () => {
  it('averages handicaps rounded down', () => {
    const t = createTournament();
    t.handicapConfig = normalizeHandicapConfig({ system: 'numerical', minValue: 0, maxValue: 9 });
    t.players['a'] = { id: 'a', name: 'A', handicap: 5 };
    t.players['b'] = { id: 'b', name: 'B', handicap: 6 };
    expect(isHandicapActive(t)).toBe(true);
    expect(pairHandicapValue(t, { id: 'pair-a-b', playerIds: ['a', 'b'] })).toBe(5);
    t.players['c'] = { id: 'c', name: 'C', handicap: 7 };
    t.players['d'] = { id: 'd', name: 'D', handicap: 8 };
    expect(pairHandicapValue(t, { id: 'pair-c-d', playerIds: ['c', 'd'] })).toBe(7);
  });
});

describe('pairDisplayLabel', () => {
  it('shows compact names without handicap', () => {
    const t = createTournament();
    t.handicapConfig = normalizeHandicapConfig({ system: 'numerical', minValue: 0, maxValue: 9 });
    t.players['a'] = { id: 'a', name: 'Alice', handicap: 5 };
    t.players['b'] = { id: 'b', name: 'Bob', handicap: 3 };
    t.pairs = { 'pair-a-b': { id: 'pair-a-b', playerIds: ['a', 'b'] } };
    expect(pairDisplayLabel(t, 'pair-a-b', undefined)).toBe('Alice / Bob');
  });
});

describe('getTrackFormat / getTrackPairs', () => {
  it('defaults to singles with no pairs', () => {
    const t = createTournament();
    expect(getTrackFormat(t)).toBe('singles');
    expect(getTrackPairs(t)).toEqual({});
  });
});
