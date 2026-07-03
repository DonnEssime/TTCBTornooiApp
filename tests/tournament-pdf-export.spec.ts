import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import {
  listTournamentPdfTracks,
  prepareBracketMatchesForPdf,
  tournamentPdfPlacementRows,
} from '../src/tournament-pdf-export';
import {
  bracketMatchRound,
  bracketPlayerMatchId,
  bracketSlotAwaitingPlay,
  createTournament,
  generateBracket,
  recomputeClassTournamentSlices,
} from '../src/model';

const bo5 = [
  { playerA: 11, playerB: 9 },
  { playerA: 11, playerB: 6 },
  { playerA: 11, playerB: 5 },
];

function iso(offsetMs: number): string {
  return new Date(Date.parse('2026-01-01T00:00:00.000Z') + offsetMs).toISOString();
}

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
  return runner;
}

function roundOneMatches(runner: CommandRunner, classId: string) {
  return runner
    .getTournament()
    .classTournaments[classId]!.bracketMatches.filter((m) => bracketMatchRound(m) === 1);
}

function createBracketMatchRows(runner: CommandRunner, classId: string, dep: string): string {
  let lastDep = dep;
  let tick = 100;
  for (const bm of roundOneMatches(runner, classId)) {
    if (!bm.seedA || !bm.seedB) continue;
    const mid = bracketPlayerMatchId(bm.id, classId);
    const pairId = `pair-${classId}-${bm.id}`;
    if (!runner.getTournament().matches[mid]) {
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
  }
  return lastDep;
}

function scoresFavoringPlayer(matchPlayerA: string, winnerId: string) {
  const winnerIsA = matchPlayerA === winnerId;
  return winnerIsA
    ? bo5
    : bo5.map((s) => ({ playerA: s.playerB, playerB: s.playerA }));
}

function scoreBracketMatch(
  runner: CommandRunner,
  classId: string,
  bm: { id: string; seedA?: string; seedB?: string },
  dep: string,
): string {
  const mid = bracketPlayerMatchId(bm.id, classId);
  const match = runner.getTournament().matches[mid]!;
  const winner = bm.seedA! < bm.seedB! ? bm.seedA! : bm.seedB!;
  const cmdId = `score-${classId}-${bm.id}`;
  expect(
    runner.execute({
      id: cmdId,
      type: 'EnterScore',
      dependsOn: [dep],
      payload: { matchId: mid, scores: scoresFavoringPlayer(match.playerA, winner) },
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

describe('tournament-pdf-export', () => {
  it('lists all tracks for full-tournament export', () => {
    const t = createTournament();
    t.classDefinitions = [
      { id: 'jun', name: 'Junior' },
      { id: 'sen', name: 'Senior' },
    ];
    t.playerClassFlags = { p1: { jun: true, sen: false }, p2: { jun: false, sen: true } };
    recomputeClassTournamentSlices(t);
    t.classTournaments.jun!.groups = { '1': { id: '1', playerIds: ['p1'] } };
    t.classTournaments.sen!.bracketMatches = generateBracket(['p2'], {
      fillByes: false,
      cullToPowerOfTwo: false,
    });

    expect(listTournamentPdfTracks(t)).toHaveLength(2);
    expect(listTournamentPdfTracks(t, 'jun')).toHaveLength(1);
    expect(listTournamentPdfTracks(t, 'jun')[0]?.classId).toBe('jun');
    expect(listTournamentPdfTracks(t, 'sen')[0]?.bracketMatches.length).toBeGreaterThan(0);
    expect(listTournamentPdfTracks(t, 'missing')).toHaveLength(0);
  });

  it('resolves class bracket placements for per-class PDF export', () => {
    const runner = setupTwoClassBracketRunner();
    playOutClassBracket(runner, 'jun', 'gen-jun');

    const t = runner.getTournament();
    const track = listTournamentPdfTracks(t, 'jun')[0]!;
    expect(track.classId).toBe('jun');
    expect(tournamentPdfPlacementRows(t, track.bracketMatches, track.classId)?.map((r) => [r.place, r.playerId])).toEqual([
      [1, 'p1'],
      [2, 'p2'],
      [3, 'p3'],
      [4, 'p4'],
    ]);
    expect(tournamentPdfPlacementRows(t, track.bracketMatches)).toBeNull();
    expect(
      prepareBracketMatchesForPdf(t, track.bracketMatches, 'jun').every(
        (bm) => !bm.seedA || !bm.seedB || bm.winner !== undefined,
      ),
    ).toBe(true);
  });
});
