import { describe, it, expect } from 'vitest';
import type { Match } from '../src/model';
import {
  groupCompletionStaggeredOrder,
  estimateScheduleWaves,
  minWavesAvoidBackToBackOrder,
} from '../src/match-ordering';

function mkMatch(
  id: string,
  playerA: string,
  playerB: string,
  groupId: string,
  done = false,
): Match {
  return {
    id,
    playerA,
    playerB,
    groupId,
    classId: undefined,
    status: done ? 'finished' : 'scheduled',
    winner: done ? playerA : undefined,
    scores: done ? [{ playerA: 11, playerB: 0 }] : [],
  };
}


describe('match ordering penalties', () => {
  it('groupCompletionStaggeredOrder picks the least-complete group first', () => {
    const g1a = mkMatch('g1-a', 'a', 'b', '1');
    const g1b = mkMatch('g1-b', 'c', 'd', '1');
    const g2a = mkMatch('g2-a', 'e', 'f', '2');
    const progress = (m: Match) => (m.groupId === '1' ? { total: 4, done: 2 } : { total: 4, done: 0 });
    const order = groupCompletionStaggeredOrder([g1a, g1b, g2a], progress);
    expect(order[0]?.groupId).toBe('2');
  });

  it('estimateScheduleWaves counts parallel table-limited waves in display order', () => {
    const slot = (a: string, b: string) => ({ playerA: a, playerB: b });
    expect(estimateScheduleWaves([], 4)).toBe(0);
    expect(estimateScheduleWaves([slot('a', 'b')], 0)).toBe(0);
    expect(estimateScheduleWaves([slot('a', 'b'), slot('c', 'd')], 2)).toBe(1);
    expect(estimateScheduleWaves([slot('a', 'b'), slot('c', 'd'), slot('e', 'f')], 2)).toBe(2);
    expect(estimateScheduleWaves([slot('a', 'b'), slot('a', 'c'), slot('d', 'e')], 3)).toBe(2);
  });

  it('minWavesAvoidBackToBackOrder reduces wave count when display order is bad', () => {
    // 2 tables. In the given order, wave1 assigns m1 (a-b) and m4 (a-c) can't fit (a busy),
    // so it pushes work into extra waves. The optimizer should reorder to pack better.
    const m1 = mkMatch('m1', 'a', 'b', '1');
    const m2 = mkMatch('m2', 'c', 'd', '1');
    const m3 = mkMatch('m3', 'e', 'f', '1');
    const m4 = mkMatch('m4', 'a', 'c', '1');

    const inOrder = [m1, m4, m2, m3];
    const optimized = minWavesAvoidBackToBackOrder(inOrder, {
      tableCount: 2,
      pastFinishedInOrder: [],
      inProgressInAssignmentOrder: [],
    });

    const slots = (ms: Match[]) => ms.map((m) => ({ playerA: m.playerA, playerB: m.playerB }));
    const wavesBefore = estimateScheduleWaves(slots(inOrder), 2);
    const wavesAfter = estimateScheduleWaves(slots(optimized), 2);
    expect(wavesAfter).toBeLessThanOrEqual(wavesBefore);
    expect(wavesAfter).toBe(2);
  });

  it('minWavesAvoidBackToBackOrder uses past/in-progress to avoid immediate repeats when waves tie', () => {
    // Both orders can fit in 1 wave (2 tables, 2 matches), but we should avoid scheduling a player
    // who just played (or is currently playing).
    const r1 = mkMatch('r1', 'a', 'b', '1');
    const r2 = mkMatch('r2', 'c', 'd', '1');
    const ready = [r1, r2];

    const optimized = minWavesAvoidBackToBackOrder(ready, {
      tableCount: 2,
      pastFinishedInOrder: [mkMatch('p1', 'a', 'x', '1', true)],
      inProgressInAssignmentOrder: [],
    });

    // Prefer the match that does NOT include 'a' first when possible.
    expect(optimized[0]?.id).toBe('r2');
  });

  it('minWavesAvoidBackToBackOrder can warm-start from current order to avoid reshuffles', () => {
    // When objectives tie, the optimizer should preserve the given preferred order.
    const a = mkMatch('a', 'p1', 'p2', '1');
    const b = mkMatch('b', 'p3', 'p4', '1');
    const c = mkMatch('c', 'p5', 'p6', '1');
    const d = mkMatch('d', 'p7', 'p8', '1');
    const ready = [a, b, c, d];

    const preferred = ['c', 'a', 'd', 'b'];
    const optimized = minWavesAvoidBackToBackOrder(ready, {
      tableCount: 2,
      pastFinishedInOrder: [],
      inProgressInAssignmentOrder: [],
      preferredReadyOrderIds: preferred,
    });

    expect(optimized.map((m) => m.id)).toEqual(preferred);
  });
});
