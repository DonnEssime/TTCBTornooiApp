/**
 * Build committed JSONL fixtures for E2E import tests.
 * Run: npm run e2e:fixtures -w web
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommandRunner } from '../../../src/command';
import { exportCommandsAsJsonLines } from '../../../src/storage';
import { bracketPlayerMatchId } from '../../../src/model';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '../fixtures');

const bo5 = [
  { playerA: 11, playerB: 9 },
  { playerA: 11, playerB: 6 },
  { playerA: 11, playerB: 5 },
];

function iso(n: number): string {
  return new Date(Date.parse('2026-01-01T00:00:00.000Z') + n).toISOString();
}

function write(name: string, runner: CommandRunner): void {
  const text = exportCommandsAsJsonLines(runner.getHistory());
  fs.writeFileSync(path.join(outDir, name), text, 'utf8');
  console.log('wrote', name);
}

function buildRoundLockedR1(): CommandRunner {
  const r = new CommandRunner();
  let t = 0;
  const ts = () => iso(t++);
  for (const [id, name] of [
    ['p1', 'A'],
    ['p2', 'B'],
  ] as const) {
    r.execute({
      id: `cmd-${id}`,
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: id, name, handicap: 0 },
      timestamp: ts(),
    });
  }
  r.execute({
    id: 'seed',
    type: 'SetSeedings',
    dependsOn: ['cmd-p1', 'cmd-p2'],
    payload: { playerIds: ['p1', 'p2'] },
    timestamp: ts(),
  });
  r.execute({
    id: 'gen',
    type: 'GenerateBracket',
    dependsOn: ['seed'],
    payload: { fillByes: true, cullToPowerOfTwo: false },
    timestamp: ts(),
  });
  r.execute({
    id: 'm1',
    type: 'CreateMatch',
    dependsOn: ['cmd-p1', 'cmd-p2'],
    payload: { matchId: 'match-1', playerA: 'p1', playerB: 'p2' },
    timestamp: ts(),
  });
  r.execute({
    id: 'lock1',
    type: 'SetRoundLock',
    dependsOn: ['m1'],
    payload: { bracketRound: 1, locked: true },
    timestamp: ts(),
  });
  return r;
}

function buildGroupPhaseComplete(): CommandRunner {
  const r = new CommandRunner();
  let t = 0;
  const ts = () => iso(t++);
  for (let i = 1; i <= 8; i++) {
    r.execute({
      id: `cp-p${i}`,
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: `p${i}`, name: `P${i}`, handicap: 0 },
      timestamp: ts(),
    });
  }
  const pids = Array.from({ length: 8 }, (_, i) => `p${i + 1}`);
  r.execute({
    id: 'seed',
    type: 'SetSeedings',
    dependsOn: pids.map((p) => `cp-${p}`),
    payload: { playerIds: pids },
    timestamp: ts(),
  });
  r.execute({
    id: 'sg',
    type: 'SetGroups',
    dependsOn: ['seed', ...pids.map((p) => `cp-${p}`)],
    payload: { targetGroupSize: 4, playerIds: pids },
    timestamp: ts(),
  });
  const matches = Object.keys(r.getTournament().matches).filter((k) => k.startsWith('gm-'));
  let deps: string[] = ['sg'];
  matches.forEach((mid, i) => {
    const id = `sc-${i}`;
    r.execute({
      id,
      type: 'EnterScore',
      dependsOn: deps,
      payload: { matchId: mid, scores: bo5 },
      timestamp: ts(),
    });
    deps = [...deps, id];
  });
  return r;
}

function buildDoubles8(): CommandRunner {
  const r = new CommandRunner();
  let t = 0;
  const ts = () => iso(t++);
  for (let i = 1; i <= 8; i++) {
    r.execute({
      id: `cp-p${i}`,
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: `p${i}`, name: `P${i}`, handicap: 0 },
      timestamp: ts(),
    });
  }
  const pids = Array.from({ length: 8 }, (_, i) => `p${i + 1}`);
  r.execute({
    id: 'seed',
    type: 'SetSeedings',
    dependsOn: pids.map((p) => `cp-${p}`),
    payload: { playerIds: pids },
    timestamp: ts(),
  });
  r.execute({
    id: 'sg',
    type: 'SetGroups',
    dependsOn: ['seed', ...pids.map((p) => `cp-${p}`)],
    payload: { targetGroupSize: 4, playerIds: pids, format: 'doubles-random-partners' },
    timestamp: ts(),
  });
  return r;
}

function buildTwoClassMidBracket(): CommandRunner {
  const r = new CommandRunner();
  let t = 0;
  const ts = () => iso(t++);
  r.execute({
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
    r.execute({
      id: `cmd-${pid}`,
      type: 'CreatePlayer',
      dependsOn: ['tc'],
      payload: { playerId: pid, name, handicap: 0 },
      timestamp: ts(),
    });
  }
  r.execute({
    id: 'seed',
    type: 'SetSeedings',
    dependsOn: ['cmd-p1', 'cmd-p2', 'cmd-p3', 'cmd-p4', 'cmd-p5', 'cmd-p6', 'cmd-p7', 'cmd-p8'],
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
    r.execute({
      id: `f-${pid}`,
      type: 'SetPlayerClassFlags',
      dependsOn: ['seed'],
      payload: { playerId: pid, flags },
      timestamp: ts(),
    });
  }
  for (const classId of ['jun', 'sen'] as const) {
    const players = classId === 'jun' ? ['p1', 'p2', 'p3', 'p4'] : ['p5', 'p6', 'p7', 'p8'];
    r.execute({
      id: `sg-${classId}`,
      type: 'SetClassGroups',
      dependsOn: ['seed', ...players.map((p) => `f-${p}`)],
      payload: { classId, targetGroupSize: 4, playerIds: players },
      timestamp: ts(),
    });
    r.execute({
      id: `gen-${classId}`,
      type: 'GenerateBracket',
      dependsOn: [`sg-${classId}`],
      payload: { fillByes: true, cullToPowerOfTwo: false, classId },
      timestamp: ts(),
    });
  }
  return r;
}

fs.mkdirSync(path.join(outDir, 'corrupt'), { recursive: true });
write('round-locked-r1.jsonl', buildRoundLockedR1());
write('group-phase-complete.jsonl', buildGroupPhaseComplete());
write('doubles-8-players.jsonl', buildDoubles8());
write('two-class-mid-bracket.jsonl', buildTwoClassMidBracket());
fs.writeFileSync(path.join(outDir, 'corrupt', 'invalid-format.jsonl'), 'not jsonl\n', 'utf8');
