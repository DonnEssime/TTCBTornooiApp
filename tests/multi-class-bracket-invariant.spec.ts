import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import {
  assignMatchToTable,
  bracketMatchRound,
  bracketPhaseCountsIncludingFutureRounds,
  bracketPlayerMatchId,
  bracketSlotAwaitingPlay,
  singleEliminationPlacementRows,
  type Tournament,
} from '../src/model';

const bo5 = [
  { playerA: 11, playerB: 9 },
  { playerA: 11, playerB: 6 },
  { playerA: 11, playerB: 5 },
];

function iso(offsetMs: number): string {
  return new Date(Date.parse('2026-01-01T00:00:00.000Z') + offsetMs).toISOString();
}

/** Two-class tournament with independent 4-player brackets on jun and sen. */
function setupTwoClassBracketRunner(): CommandRunner {
  const runner = new CommandRunner();
  let t = 0;
  const ts = () => iso(t++);

  runner.execute({
    id: 'tc',
    type: 'SetTournamentClasses',
    dependsOn: [],
    payload: { classes: [{ id: 'jun', name: 'Junior' }, { id: 'sen', name: 'Senior' }] },
    timestamp: ts(),
  });
  for (const [pid, name] of [
    ['p1', 'J1'],
    ['p2', 'J2'],
    ['p3', 'J3'],
    ['p4', 'J4'],
    ['p5', 'S1'],
    ['p6', 'S2'],
    ['p7', 'S3'],
    ['p8', 'S4'],
  ] as const) {
    runner.execute({
      id: pid,
      type: 'CreatePlayer',
      dependsOn: ['tc'],
      payload: { playerId: pid, name, handicap: 0 },
      timestamp: ts(),
    });
  }
  runner.execute({
    id: 'seed',
    type: 'SetSeedings',
    dependsOn: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
    payload: { playerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'] },
    timestamp: ts(),
  });
  for (const [pid, flags] of [
    ['p1', { jun: true, sen: false }],
    ['p2', { jun: true, sen: false }],
    ['p3', { jun: true, sen: false }],
    ['p4', { jun: true, sen: false }],
    ['p5', { jun: false, sen: true }],
    ['p6', { jun: false, sen: true }],
    ['p7', { jun: false, sen: true }],
    ['p8', { jun: false, sen: true }],
  ] as const) {
    runner.execute({
      id: `f-${pid}`,
      type: 'SetPlayerClassFlags',
      dependsOn: ['seed'],
      payload: { playerId: pid, flags },
      timestamp: ts(),
    });
  }
  for (const classId of ['jun', 'sen'] as const) {
    const players = classId === 'jun' ? ['p1', 'p2', 'p3', 'p4'] : ['p5', 'p6', 'p7', 'p8'];
    runner.execute({
      id: `scg-${classId}`,
      type: 'SetClassGroups',
      dependsOn: ['seed'],
      payload: { classId, groups: [{ id: '1', playerIds: players }] },
      timestamp: ts(),
    });
    runner.execute({
      id: `gen-${classId}`,
      type: 'GenerateBracket',
      dependsOn: [`scg-${classId}`],
      payload: {
        fillByes: false,
        cullToPowerOfTwo: false,
        classId,
        tieBreakSalt: `salt-${classId}`,
      },
      timestamp: ts(),
    });
  }

  const tourn = runner.getTournament();
  for (const classId of ['jun', 'sen'] as const) {
    const r1 = tourn.classTournaments[classId]!.bracketMatches.filter((m) => bracketMatchRound(m) === 1);
    expect(r1).toHaveLength(2);
    for (const bm of r1) {
      if (!bm.seedA || !bm.seedB) continue;
      expect(tourn.players[bm.seedA], `${classId} missing ${bm.seedA}`).toBeDefined();
      expect(tourn.players[bm.seedB], `${classId} missing ${bm.seedB}`).toBeDefined();
    }
  }
  return runner;
}

function roundOneMatches(runner: CommandRunner, classId: string) {
  return runner
    .getTournament()
    .classTournaments[classId]!.bracketMatches.filter((m) => bracketMatchRound(m) === 1);
}

function createBracketMatchRows(
  runner: CommandRunner,
  classId: string,
  dep: string,
): string {
  let lastDep = dep;
  let tick = 100;
  for (const bm of roundOneMatches(runner, classId)) {
    if (!bm.seedA || !bm.seedB) continue;
    const mid = bracketPlayerMatchId(bm.id, classId);
    const pairId = `pair-${classId}-${bm.id}`;
    const result = runner.execute({
      id: pairId,
      type: 'CreateMatch',
      dependsOn: [lastDep],
      payload: { matchId: mid, playerA: bm.seedA, playerB: bm.seedB, classId },
      timestamp: iso(tick++),
    });
    expect(result).toEqual({ success: true });
    lastDep = pairId;
  }
  return lastDep;
}

function bracketTrackSnapshot(t: Tournament, classId: string) {
  const slice = t.classTournaments[classId]!;
  const prefix = `match-${classId}-`;
  const classMatches = Object.fromEntries(
    Object.entries(t.matches).filter(([id, m]) => id.startsWith(prefix) || m.classId === classId),
  );
  return JSON.stringify({
    bracketMatches: slice.bracketMatches,
    matches: classMatches,
    tableAssignments: t.tableAssignments.filter((a) => classMatches[a.matchId]),
  });
}

function scoreBracketMatch(
  runner: CommandRunner,
  classId: string,
  bm: { id: string; seedA?: string; seedB?: string },
  dep: string,
): string {
  const mid = bracketPlayerMatchId(bm.id, classId);
  const cmdId = `score-${classId}-${bm.id}`;
  expect(
    runner.execute({
      id: cmdId,
      type: 'EnterScore',
      dependsOn: [dep],
      payload: { matchId: mid, scores: bo5 },
      timestamp: iso(500),
    }),
  ).toEqual({ success: true });
  return cmdId;
}

function playOutClassBracket(runner: CommandRunner, classId: string, dep: string): void {
  let lastDep = createBracketMatchRows(runner, classId, dep);
  const t = () => runner.getTournament();
  for (;;) {
    const open = t()
      .classTournaments[classId]!.bracketMatches.filter(
        (bm) => bm.seedA && bm.seedB && bracketSlotAwaitingPlay(t(), bm, classId),
      );
    if (open.length === 0) break;
    open.sort((a, b) => bracketMatchRound(a) - bracketMatchRound(b) || a.id.localeCompare(b.id));
    lastDep = scoreBracketMatch(runner, classId, open[0]!, lastDep);
  }
}

describe('multi-class bracket other-class invariants', () => {
  it('round-1 player rows must use class-scoped match ids for overview lookup', () => {
    const runner = setupTwoClassBracketRunner();
    for (const classId of ['jun', 'sen'] as const) {
      createBracketMatchRows(runner, classId, `gen-${classId}`);
    }
    const t = runner.getTournament();
    for (const classId of ['jun', 'sen'] as const) {
      for (const bm of roundOneMatches(runner, classId)) {
        if (!bm.seedA || !bm.seedB) continue;
        const mid = bracketPlayerMatchId(bm.id, classId);
        const m = t.matches[mid];
        expect(m, `${classId} missing ${mid}`).toBeDefined();
        expect(m!.classId).toBe(classId);
        expect(bracketSlotAwaitingPlay(t, bm, classId)).toBe(true);
        expect(t.matches[`match-${bm.id}`]).toBeUndefined();
      }
    }
  });

  it('scoring one class round-1 bracket match does not change the other class bracket', () => {
    const runner = setupTwoClassBracketRunner();
    const senBefore = bracketTrackSnapshot(runner.getTournament(), 'sen');

    const lastDep = createBracketMatchRows(runner, 'jun', 'gen-jun');
    const bm = roundOneMatches(runner, 'jun').find((m) => m.seedA && m.seedB)!;
    const mid = bracketPlayerMatchId(bm.id, 'jun');
    expect(
      runner.execute({
        id: 'score-jun-r1',
        type: 'EnterScore',
        dependsOn: [lastDep],
        payload: { matchId: mid, scores: bo5 },
        timestamp: iso(200),
      }),
    ).toEqual({ success: true });

    expect(bracketTrackSnapshot(runner.getTournament(), 'sen')).toEqual(senBefore);
    expect(runner.getTournament().classTournaments.jun!.bracketMatches.find((m) => m.id === bm.id)?.winner).toBeDefined();
  });

  it('assigning a bracket match to a table in one class does not remove the other class bracket row', () => {
    const runner = setupTwoClassBracketRunner();
    createBracketMatchRows(runner, 'jun', 'gen-jun');
    createBracketMatchRows(runner, 'sen', 'gen-sen');

    const t0 = runner.getTournament();
    t0.tables = ['1', '2'];
    const junBm = roundOneMatches(runner, 'jun').find((m) => m.seedA && m.seedB)!;
    const junMid = bracketPlayerMatchId(junBm.id, 'jun');
    const senBefore = bracketTrackSnapshot(t0, 'sen');

    assignMatchToTable(t0, junMid, '1');

    expect(bracketTrackSnapshot(t0, 'sen')).toEqual(senBefore);
    expect(t0.matches[bracketPlayerMatchId(roundOneMatches(runner, 'sen')[0]!.id, 'sen')]).toBeDefined();
    expect(t0.matches[bracketPlayerMatchId(roundOneMatches(runner, 'sen')[1]!.id, 'sen')]).toBeDefined();
    expect(t0.matches[junMid]?.status).toBe('in-progress');
  });

  it('simulating table match scores in one class does not move the other class bracket', () => {
    const runner = setupTwoClassBracketRunner();
    createBracketMatchRows(runner, 'jun', 'gen-jun');
    const senDep = createBracketMatchRows(runner, 'sen', 'gen-sen');

    const t = runner.getTournament();
    t.tables = ['1'];
    const junBm = roundOneMatches(runner, 'jun').find((m) => m.seedA && m.seedB)!;
    const junMid = bracketPlayerMatchId(junBm.id, 'jun');
    assignMatchToTable(t, junMid, '1');
    const senBefore = bracketTrackSnapshot(t, 'sen');

    expect(
      runner.execute({
        id: 'score-jun-table',
        type: 'EnterScore',
        dependsOn: [senDep],
        payload: { matchId: junMid, scores: bo5 },
        timestamp: iso(200),
      }),
    ).toEqual({ success: true });

    expect(bracketTrackSnapshot(runner.getTournament(), 'sen')).toEqual(senBefore);
  });

  it('reports class bracket completion and placement rows after the final', () => {
    const runner = setupTwoClassBracketRunner();
    playOutClassBracket(runner, 'jun', 'gen-jun');

    const t = runner.getTournament();
    const junBracket = t.classTournaments.jun!.bracketMatches;
    expect(bracketPhaseCountsIncludingFutureRounds(junBracket)).toEqual({ total: 3, done: 3 });
    expect(singleEliminationPlacementRows(junBracket, t)).toBeNull();
    const placements = singleEliminationPlacementRows(junBracket, t, 'jun');
    expect(placements?.map((r) => [r.place, r.playerId])).toEqual([
      [1, 'p1'],
      [2, 'p2'],
      [3, 'p4'],
      [4, 'p3'],
    ]);
  });
});
