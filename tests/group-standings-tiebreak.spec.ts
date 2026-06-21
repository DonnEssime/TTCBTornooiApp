import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import { groupStandingsRowsForBracket } from '../src/model';

describe('group standings tie-break', () => {
  const ts = '2026-01-01T00:00:00.000Z';

  function seedPlayers(runner: CommandRunner, ids: readonly string[]): void {
    for (const id of ids) {
      runner.execute({
        id: `p-${id}`,
        type: 'CreatePlayer',
        dependsOn: [],
        payload: { playerId: id, name: id.toUpperCase(), handicap: 0 },
        timestamp: ts,
      });
    }
  }

  function setGroup(runner: CommandRunner, playerIds: readonly string[], dependsOn: string[]): void {
    runner.execute({
      id: 'sgz',
      type: 'SetGroups',
      dependsOn,
      payload: { targetGroupSize: playerIds.length, playerIds: [...playerIds] },
      timestamp: ts,
    });
  }

  function enterScore(
    runner: CommandRunner,
    matchId: string,
    scores: Array<{ playerA: number; playerB: number }>,
    dependsOn: string[],
  ): void {
    runner.execute({
      id: `sc-${matchId}`,
      type: 'EnterScore',
      dependsOn,
      payload: { matchId, scores },
      timestamp: ts,
    });
  }

  function sweep(): Array<{ playerA: number; playerB: number }> {
    return [
      { playerA: 11, playerB: 3 },
      { playerA: 11, playerB: 3 },
      { playerA: 11, playerB: 3 },
    ];
  }

  function tightWin(): Array<{ playerA: number; playerB: number }> {
    return [
      { playerA: 11, playerB: 9 },
      { playerA: 9, playerB: 11 },
      { playerA: 11, playerB: 9 },
      { playerA: 9, playerB: 11 },
      { playerA: 11, playerB: 8 },
    ];
  }

  function matchIdBetween(a: string, b: string): string {
    return a < b ? `gm-1-${a}-${b}` : `gm-1-${b}-${a}`;
  }

  function tightWinSideB(): Array<{ playerA: number; playerB: number }> {
    return tightWin().map(({ playerA, playerB }) => ({ playerA: playerB, playerB: playerA }));
  }

  it('breaks a two-way W/L tie by head-to-head', () => {
    const runner = new CommandRunner();
    seedPlayers(runner, ['p1', 'p2', 'p3', 'p4']);
    setGroup(runner, ['p1', 'p2', 'p3', 'p4'], ['p-p1', 'p-p2', 'p-p3', 'p-p4']);
    const g = runner.getTournament().groups['1']!;

    enterScore(runner, matchIdBetween('p1', 'p2'), sweep(), ['sgz']);
    enterScore(runner, matchIdBetween('p1', 'p3'), sweep(), ['sgz']);
    enterScore(runner, matchIdBetween('p1', 'p4'), [{ playerA: 5, playerB: 11 }, { playerA: 5, playerB: 11 }, { playerA: 5, playerB: 11 }], ['sgz']);
    enterScore(runner, matchIdBetween('p2', 'p3'), sweep(), ['sgz']);
    enterScore(runner, matchIdBetween('p2', 'p4'), sweep(), ['sgz']);
    enterScore(runner, matchIdBetween('p3', 'p4'), sweep(), ['sgz']);

    const rows = groupStandingsRowsForBracket(runner.getTournament(), g, undefined);
    expect(rows.slice(0, 2).map((r) => r.pid)).toEqual(['p1', 'p2']);
    expect(rows[0]).toMatchObject({ pid: 'p1', w: 2, l: 1 });
    expect(rows[1]).toMatchObject({ pid: 'p2', w: 2, l: 1 });
  });

  it('recursively applies head-to-head after sets split a three-way tie', () => {
    const runner = new CommandRunner();
    seedPlayers(runner, ['p1', 'p2', 'p3']);
    setGroup(runner, ['p1', 'p2', 'p3'], ['p-p1', 'p-p2', 'p-p3']);
    enterScore(runner, matchIdBetween('p1', 'p2'), sweep(), ['sgz']);
    enterScore(runner, matchIdBetween('p2', 'p3'), sweep(), ['sgz']);
    enterScore(runner, matchIdBetween('p1', 'p3'), tightWinSideB(), ['sgz']);

    const g = runner.getTournament().groups['1']!;
    const rows = groupStandingsRowsForBracket(runner.getTournament(), g, undefined);
    expect(rows.map((r) => r.pid)).toEqual(['p1', 'p2', 'p3']);
    for (const row of rows) {
      expect(row.w).toBe(1);
      expect(row.l).toBe(1);
    }
  });

  it('uses deterministic random order when all tie-breakers are equal', () => {
    const runner = new CommandRunner();
    seedPlayers(runner, ['x', 'y']);
    setGroup(runner, ['x', 'y'], ['p-x', 'p-y']);

    const g = runner.getTournament().groups['1']!;
    const t = runner.getTournament();
    const first = groupStandingsRowsForBracket(t, g, undefined).map((r) => r.pid);
    const second = groupStandingsRowsForBracket(t, g, undefined).map((r) => r.pid);
    expect(first).toEqual(second);
    expect(new Set(first)).toEqual(new Set(['x', 'y']));
  });
});
