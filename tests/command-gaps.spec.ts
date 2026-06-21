import { describe, it, expect } from 'vitest';
import { CommandRunner, type UndoCommand } from '../src/command';
import { TournamentController } from '../src/controller';
import { bracketPlayerMatchId } from '../src/model';

const TS = '2026-06-06T12:00:00.000Z';
const BO5_A = [
  { playerA: 11, playerB: 9 },
  { playerA: 11, playerB: 6 },
  { playerA: 11, playerB: 5 },
];

function exec(runner: CommandRunner, cmd: Omit<Parameters<CommandRunner['execute']>[0], 'timestamp'> & { timestamp?: string }) {
  return runner.execute({ ...cmd, timestamp: cmd.timestamp ?? TS } as Parameters<CommandRunner['execute']>[0]);
}

function undo(runner: CommandRunner, targetId: string, undoId: string) {
  const u: UndoCommand = {
    id: undoId,
    type: 'Undo',
    timestamp: TS,
    dependsOn: [targetId],
    payload: { targetCommandId: targetId },
  };
  return runner.execute(u);
}

describe('SetSeedings validation', () => {
  it('rejects empty seedings array', () => {
    const r = new CommandRunner();
    exec(r, { id: 'p1', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p1', name: 'A', handicap: 0 } });
    const res = exec(r, { id: 'seed', type: 'SetSeedings', dependsOn: ['p1'], payload: { playerIds: [] } });
    expect(res.success).toBe(false);
    expect(res.reason).toBe('command.seedingsMustBeNonEmpty');
  });

  it('rejects unknown player id in seedings', () => {
    const r = new CommandRunner();
    exec(r, { id: 'p1', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p1', name: 'A', handicap: 0 } });
    const res = exec(r, { id: 'seed', type: 'SetSeedings', dependsOn: ['p1'], payload: { playerIds: ['p1', 'ghost'] } });
    expect(res.success).toBe(false);
    expect(res.reason).toBe('command.unknownPlayerInSeedings');
  });
});

describe('TeamForfeit command', () => {
  it('rejects group-phase team forfeit', () => {
    const r = new CommandRunner();
    exec(r, { id: 'p1', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p1', name: 'A', handicap: 0 } });
    exec(r, { id: 'p2', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p2', name: 'B', handicap: 0 } });
    exec(r, { id: 't1', type: 'CreateTeam', dependsOn: ['p1'], payload: { teamId: 't1', name: 'A', memberIds: ['p1'] } });
    exec(r, { id: 't2', type: 'CreateTeam', dependsOn: ['p2'], payload: { teamId: 't2', name: 'B', memberIds: ['p2'] } });
    exec(r, { id: 'tm', type: 'CreateTeamMatch', dependsOn: ['t1', 't2'], payload: { matchId: 'tm1', teamA: 't1', teamB: 't2' } });
    const res = exec(r, { id: 'ff', type: 'TeamForfeit', dependsOn: ['tm'], payload: { teamId: 't1', phase: 'group' } });
    expect(res.success).toBe(false);
    expect(res.reason).toBe('command.teamGroupForfeitsNotSupported');
  });

  it('allows bracket-phase team forfeit on team match', () => {
    const r = new CommandRunner();
    exec(r, { id: 'p1', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p1', name: 'A', handicap: 0 } });
    exec(r, { id: 'p2', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p2', name: 'B', handicap: 0 } });
    exec(r, { id: 't1', type: 'CreateTeam', dependsOn: ['p1'], payload: { teamId: 't1', name: 'A', memberIds: ['p1'] } });
    exec(r, { id: 't2', type: 'CreateTeam', dependsOn: ['p2'], payload: { teamId: 't2', name: 'B', memberIds: ['p2'] } });
    exec(r, { id: 'tm', type: 'CreateTeamMatch', dependsOn: ['t1', 't2'], payload: { matchId: 'tm1', teamA: 't1', teamB: 't2' } });
    const res = exec(r, { id: 'ff', type: 'TeamForfeit', dependsOn: ['tm'], payload: { teamId: 't1', phase: 'bracket' } });
    expect(res.success).toBe(true);
    expect(r.getTournament().forfeits.teams.t1?.phase).toBe('bracket');
  });
});

describe('findLatestActiveCreateMatchCommandId', () => {
  it('returns latest active create-match id and respects undo suppression', () => {
    const r = new CommandRunner();
    exec(r, { id: 'p1', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p1', name: 'A', handicap: 0 } });
    exec(r, { id: 'p2', type: 'CreatePlayer', dependsOn: [], payload: { playerId: 'p2', name: 'B', handicap: 0 } });
    exec(r, { id: 'cm', type: 'CreateMatch', dependsOn: ['p1', 'p2'], payload: { matchId: 'm1', playerA: 'p1', playerB: 'p2' } });
    expect(r.findLatestActiveCreateMatchCommandId('m1')).toBe('cm');
    undo(r, 'cm', 'u-cm');
    expect(r.findLatestActiveCreateMatchCommandId('m1')).toBeUndefined();
    expect(r.getTournament().matches.m1).toBeUndefined();
  });
});

describe('EliminateLowestBracketRound command', () => {
  function setupGroupBracketRunner(): CommandRunner {
    const r = new CommandRunner();
    const pids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'] as const;
    for (const id of pids) {
      exec(r, { id, type: 'CreatePlayer', dependsOn: [], payload: { playerId: id, name: id, handicap: 0 } });
    }
    exec(r, { id: 'seed', type: 'SetSeedings', dependsOn: [...pids], payload: { playerIds: [...pids] } });
    exec(r, { id: 'sg', type: 'SetGroups', dependsOn: ['seed'], payload: { targetGroupSize: 4, playerIds: [...pids] } });
    const gms = Object.keys(r.getTournament().matches).filter((k) => k.startsWith('gm-'));
    let deps: string[] = ['sg', 'seed'];
    for (let i = 0; i < gms.length; i++) {
      exec(r, { id: `gs${i}`, type: 'EnterScore', dependsOn: ['sg'], payload: { matchId: gms[i]!, scores: BO5_A } });
      deps.push(`gs${i}`);
    }
    exec(r, {
      id: 'gen',
      type: 'GenerateBracket',
      dependsOn: deps,
      payload: { fillByes: true, cullToPowerOfTwo: false, bracketSeedingMode: 'closed_form' },
    });
    return r;
  }

  it('rejects empty tieBreakSalt', () => {
    const r = setupGroupBracketRunner();
    const res = exec(r, {
      id: 'elim',
      type: 'EliminateLowestBracketRound',
      dependsOn: ['gen'],
      payload: { round: 1, tieBreakSalt: '   ' },
    });
    expect(res.success).toBe(false);
    expect(res.reason).toBe('model.tieBreakSaltRequired');
  });

  it('rejects elimination on locked round', () => {
    const r = setupGroupBracketRunner();
    exec(r, { id: 'lock', type: 'SetRoundLock', dependsOn: ['gen'], payload: { bracketRound: 1, locked: true } });
    const res = exec(r, {
      id: 'elim',
      type: 'EliminateLowestBracketRound',
      dependsOn: ['gen', 'lock'],
      payload: { round: 1, tieBreakSalt: 'salt' },
    });
    expect(res.success).toBe(false);
    expect(res.reason).toBe('model.bracketRoundLockedWithPeriod');
  });

  it('eliminates lower-ranked player in open round-1 pairing without scores', () => {
    const r = setupGroupBracketRunner();
    const bm = r.getTournament().bracketMatches.find((m) => m.round === 1 && m.seedA && m.seedB)!;
    const res = exec(r, {
      id: 'elim',
      type: 'EliminateLowestBracketRound',
      dependsOn: ['gen'],
      payload: { round: 1, tieBreakSalt: 'review-salt' },
    });
    expect(res.success).toBe(true);
    const mid = bracketPlayerMatchId(bm.id);
    const m = r.getTournament().matches[mid];
    expect(m?.status).toBe('eliminated');
    expect(m?.winner).toBeTruthy();
    expect(m?.scores).toEqual([]);
  });
});

describe('Bracket match auto-materialization after first KO score', () => {
  it('creates sibling round-1 match rows and blocks duplicate CreateMatch', () => {
    const c = new TournamentController();
    for (const p of ['p1', 'p2', 'p3', 'p4'] as const) {
      c.createPlayer(p, p, 0, '', p);
    }
    c.setSeedings(['p1', 'p2', 'p3', 'p4'], ['p1', 'p2', 'p3', 'p4'], 'seed');
    c.generateBracket(false, false, ['seed'], 'gen');
    const bm1 = c.getTournament().bracketMatches.find((m) => m.id === 'm1')!;
    const mid1 = bracketPlayerMatchId('m1');
    c.createMatch(mid1, bm1.seedA!, bm1.seedB!, ['gen', 'p1', 'p2', 'p3', 'p4'], 'cm1');
    c.enterScore(mid1, BO5_A, ['cm1'], 'sc1');

    const t = c.getTournament();
    expect(Object.keys(t.matches).sort()).toEqual(['match-m1', 'match-m2']);
    expect(t.matches[bracketPlayerMatchId('m2')]?.status).toBe('scheduled');

    const bm2 = t.bracketMatches.find((m) => m.id === 'm2')!;
    const dup = c.createMatch(bracketPlayerMatchId('m2'), bm2.seedA!, bm2.seedB!, ['gen'], 'cm2');
    expect(dup.success).toBe(false);
    expect(dup.reason).toBe('command.matchAlreadyExists');
  });
});
