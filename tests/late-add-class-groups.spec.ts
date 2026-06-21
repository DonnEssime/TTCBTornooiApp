import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import { TournamentController, tournamentControllerFromCommandLog } from '../src/controller';
import {
  bracketMatchRound,
  bracketPlayerMatchId,
  bracketSlotAwaitingPlay,
  type Tournament,
} from '../src/model';
import { exportCommandsAsJsonLines } from '../src/storage';

/** Keep in sync with web/e2e/17-late-add-class-groups.spec.ts (seed 0x4c417e). */
const SUBSET_SEED = 0x4c417e;
const POOL_PLAYER_IDS = Array.from({ length: 12 }, (_, i) => `p${i + 9}`);
export const LATE_ADD_SUBSET_PLAYER_IDS = pickDeterministicSubset(POOL_PLAYER_IDS, 10, SUBSET_SEED);

const bo5 = [
  { playerA: 11, playerB: 9 },
  { playerA: 11, playerB: 6 },
  { playerA: 11, playerB: 5 },
];

function iso(offsetMs: number): string {
  return new Date(Date.parse('2026-01-01T00:00:00.000Z') + offsetMs).toISOString();
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickDeterministicSubset(ids: string[], n: number, seed: number): string[] {
  const arr = ids.slice();
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, n).sort((a, b) => a.localeCompare(b));
}

function junTrackSnapshot(t: Tournament): string {
  const slice = t.classTournaments.jun!;
  const prefix = 'match-jun-';
  const classMatches = Object.fromEntries(
    Object.entries(t.matches).filter(([id, m]) => id.startsWith(prefix) || m.classId === 'jun'),
  );
  return JSON.stringify({
    bracketMatches: slice.bracketMatches,
    matches: classMatches,
    tableAssignments: t.tableAssignments.filter((a) => classMatches[a.matchId]),
  });
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

/** Multi-class tournament: Junior fully played, Senior idle, p9–p20 unassigned. */
function seedJunFinishedPool(): CommandRunner {
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

  for (let i = 1; i <= 20; i++) {
    const pid = `p${i}`;
    runner.execute({
      id: `cmd-${pid}`,
      type: 'CreatePlayer',
      dependsOn: ['tc'],
      payload: { playerId: pid, name: i <= 4 ? `J${i}` : i <= 8 ? `S${i - 4}` : `P${i}`, handicap: 0 },
      timestamp: ts(),
    });
  }

  const allPids = Array.from({ length: 20 }, (_, i) => `p${i + 1}`);
  runner.execute({
    id: 'seed',
    type: 'SetSeedings',
    dependsOn: allPids.map((p) => `cmd-${p}`),
    payload: { playerIds: allPids },
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

  runner.execute({
    id: 'sg-jun',
    type: 'SetClassGroups',
    dependsOn: ['seed', 'f-p1', 'f-p2', 'f-p3', 'f-p4'],
    payload: { classId: 'jun', targetGroupSize: 4, playerIds: ['p1', 'p2', 'p3', 'p4'] },
    timestamp: ts(),
  });

  const junGroupMatches = Object.keys(runner.getTournament().matches).filter((k) => k.startsWith('gm-jun-'));
  let deps: string[] = ['sg-jun'];
  junGroupMatches.forEach((mid, i) => {
    const id = `jun-gsc-${i}`;
    runner.execute({
      id,
      type: 'EnterScore',
      dependsOn: deps,
      payload: { matchId: mid, scores: bo5 },
      timestamp: ts(),
    });
    deps = [...deps, id];
  });

  runner.execute({
    id: 'gen-jun',
    type: 'GenerateBracket',
    dependsOn: deps,
    payload: { fillByes: true, cullToPowerOfTwo: false, classId: 'jun' },
    timestamp: ts(),
  });

  playOutClassBracket(runner, 'jun', 'gen-jun');
  return runner;
}

function controllerFromRunner(runner: CommandRunner): TournamentController {
  const text = exportCommandsAsJsonLines(runner.getHistory());
  const { controller } = tournamentControllerFromCommandLog(text);
  return controller;
}

describe('late-add class with groups', () => {
  it('adds Veteran class, groups 10+ players, and assigns latecomer to existing group', () => {
    const runner = seedJunFinishedPool();
    const junBefore = junTrackSnapshot(runner.getTournament());
    const c = controllerFromRunner(runner);

    expect(c.addTournamentClass('Veteran', [], 'cmd-add-vet', 'vet')).toEqual({ success: true });

    const subset = LATE_ADD_SUBSET_PLAYER_IDS;
    expect(subset.length).toBeGreaterThan(8);

    for (const pid of subset) {
      expect(
        c.setPlayerClassFlags(pid, { vet: true }, [`cmd-${pid}`], `cmd-pcf-${pid}-vet`),
      ).toEqual({ success: true });
    }

    const flagDeps = subset.map((pid) => `cmd-pcf-${pid}-vet`);
    expect(
      c.setClassGroups(
        'vet',
        { targetGroupSize: 4, playerIds: subset },
        flagDeps,
        'cmd-scg-vet',
      ),
    ).toEqual({ success: true });

    expect(c.createPlayer('p21', 'Latecomer', 0, '', 'cmd-p21')).toEqual({ success: true });
    expect(c.setSeedings([...Array.from({ length: 20 }, (_, i) => `p${i + 1}`), 'p21'], [], 'cmd-seed-p21')).toEqual({
      success: true,
    });
    expect(
      c.setPlayerClassFlags('p21', { vet: true }, ['cmd-p21'], 'cmd-pcf-p21-vet'),
    ).toEqual({ success: true });

    const vetGroupsAfterCreate = c.getTournament().classTournaments.vet!.groups;
    expect(Object.keys(vetGroupsAfterCreate)).toHaveLength(2);
    const targetGroupId = '1';
    const groupBefore = vetGroupsAfterCreate[targetGroupId]!.playerIds.slice();
    expect(groupBefore.length).toBe(5);

    expect(
      c.setPlayerGroup('p21', targetGroupId, ['cmd-scg-vet'], 'cmd-spg-p21', 'vet'),
    ).toEqual({ success: true });

    const t = c.getTournament();
    expect(t.classDefinitions.some((d) => d.id === 'vet')).toBe(true);
    expect(t.classTournaments.vet).toBeDefined();

    const vetSeedings = t.classTournaments.vet!.seedings.slice().sort();
    expect(vetSeedings).toEqual([...subset, 'p21'].sort());

    expect(t.playerClassFlags.p21).toEqual({ jun: false, sen: false, vet: true });

    const vetGroups = t.classTournaments.vet!.groups;
    expect(Object.keys(vetGroups)).toHaveLength(2);
    const group1 = vetGroups[targetGroupId]!;
    expect(group1.playerIds).toContain('p21');
    expect(group1.playerIds).toHaveLength(6);

    for (const x of groupBefore) {
      const sorted = ['p21', x].sort();
      const mid = `gm-vet-${targetGroupId}-${sorted[0]}-${sorted[1]}`;
      const m = t.matches[mid];
      expect(m, mid).toBeDefined();
      expect(m!.status).toBe('scheduled');
      expect(m!.classId).toBe('vet');
    }

    expect(junTrackSnapshot(t)).toBe(junBefore);
    expect(Object.keys(t.classTournaments.sen!.groups)).toHaveLength(0);
  });
});
