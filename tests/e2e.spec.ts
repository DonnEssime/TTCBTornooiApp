import { describe, it, expect } from 'vitest';
import { TournamentController } from '../src/controller';
import { ConsoleTournamentView } from '../src/view';
import { CommandRunner } from '../src/command';
import { bracketPlayerMatchId, singleEliminationPlacementRows, settleBracketWinners } from '../src/model';

const BO5_A = [
  { playerA: 11, playerB: 9 },
  { playerA: 11, playerB: 6 },
  { playerA: 11, playerB: 5 },
];
const BO5_B = [
  { playerA: 9, playerB: 11 },
  { playerA: 11, playerB: 7 },
  { playerA: 9, playerB: 11 },
  { playerA: 6, playerB: 11 },
];

describe('End-to-end tournament flow', () => {
  it('should run a player bracket tournament with scores and undo', () => {
    const controller = new TournamentController(undefined, { debug: true });
    controller.setView(new ConsoleTournamentView());

    expect(controller.createPlayer('p1', 'Alice', 0, '', 'cmd-p1')).toEqual({ success: true });
    expect(controller.createPlayer('p2', 'Bob', 0, '', 'cmd-p2')).toEqual({ success: true });
    expect(controller.createPlayer('p3', 'Charlie', 0, '', 'cmd-p3')).toEqual({ success: true });
    expect(controller.createPlayer('p4', 'Dana', 0, '', 'cmd-p4')).toEqual({ success: true });

    expect(controller.setSeedings(['p1', 'p2', 'p3', 'p4'], [], 'cmd-seed')).toEqual({ success: true });
    expect(controller.generateBracket(true, false, ['cmd-seed'], 'cmd-gen')).toEqual({ success: true });
    expect(controller.getTournament().bracketMatches.filter((m) => m.round === 1)).toHaveLength(2);

    expect(controller.createMatch('match-a', 'p1', 'p4', ['cmd-gen', 'cmd-p1', 'cmd-p4'], 'cmd-match-a')).toEqual({ success: true });
    expect(controller.createMatch('match-b', 'p2', 'p3', ['cmd-gen', 'cmd-p2', 'cmd-p3'], 'cmd-match-b')).toEqual({ success: true });

    expect(
      controller.enterScore(
        'match-a',
        [
          { playerA: 11, playerB: 9 },
          { playerA: 11, playerB: 6 },
          { playerA: 11, playerB: 5 },
        ],
        ['cmd-match-a'],
        'cmd-score-a',
      ),
    ).toEqual({ success: true });
    expect(
      controller.enterScore(
        'match-b',
        [
          { playerA: 11, playerB: 7 },
          { playerA: 3, playerB: 11 },
          { playerA: 11, playerB: 9 },
          { playerA: 11, playerB: 6 },
        ],
        ['cmd-match-b'],
        'cmd-score-b',
      ),
    ).toEqual({ success: true });

    const mid = controller.getTournament();
    expect(mid.bracketMatches.some((m) => m.round === 1 && m.winner)).toBe(true);
    expect(mid.bracketMatches.some((m) => m.round === 2)).toBe(true);

    expect(controller.assignTables(['Table1', 'Table2'], 2)).toEqual({ success: true });
    expect(controller.getTournament().tableAssignments[0]).toMatchObject({ tableId: 'Table1', round: 2 });

    const undoResult = controller.undo('cmd-score-b');
    expect(undoResult.success).toBe(true);
    expect(controller.getTournament().matches['match-b']?.status).toBe('scheduled');
    expect(controller.canUndo('cmd-match-b')).toBeTruthy();
  });

  it('should support only one team vs team match and block player brackets with it', () => {
    const controller = new TournamentController();
    controller.setView(new ConsoleTournamentView());

    expect(controller.createPlayer('p1', 'Alice', 0, '', 'c-p1')).toEqual({ success: true });
    expect(controller.createPlayer('p2', 'Bob', 0, '', 'c-p2')).toEqual({ success: true });
    expect(controller.createTeam('t1', 'Team Alpha', ['p1'], [], 'c-t1')).toEqual({ success: true });
    expect(controller.createTeam('t2', 'Team Beta', ['p2'], [], 'c-t2')).toEqual({ success: true });

    expect(controller.createTeamMatch('tm1', 't1', 't2', ['c-t1', 'c-t2'], 'c-tm1')).toEqual({ success: true });
    expect(controller.createTeamMatch('tm2', 't1', 't2', ['c-t1', 'c-t2'], 'c-tm2')).toEqual({
      success: false,
      reason: 'command.onlyOneTeamVsTeamMatch',
    });

    expect(
      controller.enterTeamScore(
        'tm1',
        [
          { playerA: 11, playerB: 9 },
          { playerA: 11, playerB: 6 },
          { playerA: 11, playerB: 8 },
        ],
        ['c-tm1'],
        'c-ts1',
      ),
    ).toEqual({ success: true });
    expect(controller.getTournament().teamMatches['tm1']?.status).toBe('finished');

    expect(controller.setSeedings(['p1', 'p2'], [], 'cmd-seed2')).toEqual({ success: true });
    expect(controller.generateBracket(true, false, ['cmd-seed2'], 'cmd-gen2')).toEqual({
      success: false,
      reason: 'command.cannotGenerateBracketWithTeamMatch',
    });
    expect(controller.getTournament().bracketMatches.length).toBe(0);

    expect(controller.createMatch('m1', 'p1', 'p2', ['c-p1', 'c-p2'], 'c-m1')).toEqual({
      success: false,
      reason: 'command.playerMatchesNotAllowedInTeamFixture',
    });
  });

  it('should run an 8-player bracket through to champion', () => {
    const controller = new TournamentController();
    const pids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'] as const;
    const winners: Record<string, string> = {
      'p1-p8': 'p1',
      'p4-p5': 'p4',
      'p2-p7': 'p2',
      'p3-p6': 'p3',
    };
    for (const p of pids) {
      expect(controller.createPlayer(p, p, 0, '', `cp-${p}`)).toEqual({ success: true });
    }
    expect(controller.setSeedings([...pids], pids.map((id) => `cp-${id}`), 'seed')).toEqual({ success: true });
    expect(controller.generateBracket(false, false, ['seed'], 'gen')).toEqual({ success: true });

    let deps = ['gen', ...pids.map((p) => `cp-${p}`)];
    let round = 1;
    let bootstrapped = false;
    while (round <= 4) {
      const t = controller.getTournament();
      const pending = t.bracketMatches.filter(
        (bm) =>
          bm.round === round &&
          bm.seedA &&
          bm.seedB &&
          t.matches[bracketPlayerMatchId(bm.id)]?.status !== 'finished',
      );
      if (pending.length === 0) {
        if (!t.bracketMatches.some((bm) => bm.round === round + 1)) break;
        round++;
        continue;
      }
      for (const bm of pending) {
        const mid = bracketPlayerMatchId(bm.id);
        const winner = winners[`${bm.seedA}-${bm.seedB}`] ?? bm.seedA!;
        const scores = winner === bm.seedA ? BO5_A : BO5_B;
        if (!bootstrapped) {
          expect(controller.createMatch(mid, bm.seedA!, bm.seedB!, deps, `cm-${bm.id}`)).toEqual({ success: true });
          bootstrapped = true;
          deps = [...deps, `cm-${bm.id}`];
        }
        expect(controller.enterScore(mid, scores, deps, `sc-${bm.id}`)).toEqual({ success: true });
        deps = [...deps, `sc-${bm.id}`];
      }
      settleBracketWinners(controller.getTournament());
      round++;
    }

    const placements = singleEliminationPlacementRows(controller.getTournament().bracketMatches, controller.getTournament());
    expect(placements?.[0]).toEqual({ place: 1, playerId: 'p1' });
    expect(placements?.[1]).toEqual({ place: 2, playerId: 'p2' });
  });

  it('should complete group round-robin and generate knockout bracket', () => {
    const runner = new CommandRunner();
    const ts = '2026-06-06T12:00:00.000Z';
    const exec = (cmd: Parameters<CommandRunner['execute']>[0]) => runner.execute({ ...cmd, timestamp: ts });
    const pids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'] as const;
    for (const id of pids) {
      exec({ id, type: 'CreatePlayer', dependsOn: [], payload: { playerId: id, name: id, handicap: 0 } });
    }
    exec({ id: 'seed', type: 'SetSeedings', dependsOn: [...pids], payload: { playerIds: [...pids] } });
    exec({ id: 'sg', type: 'SetGroups', dependsOn: ['seed'], payload: { targetGroupSize: 4, playerIds: [...pids] } });
    const groupMatches = Object.keys(runner.getTournament().matches).filter((k) => k.startsWith('gm-')).sort();
    expect(groupMatches).toHaveLength(12);
    let deps: string[] = ['sg', 'seed'];
    for (let i = 0; i < groupMatches.length; i++) {
      exec({ id: `gs${i}`, type: 'EnterScore', dependsOn: ['sg'], payload: { matchId: groupMatches[i]!, scores: BO5_A } });
      deps.push(`gs${i}`);
    }
    expect(
      exec({
        id: 'gen',
        type: 'GenerateBracket',
        dependsOn: deps,
        payload: { fillByes: true, cullToPowerOfTwo: false, bracketSeedingMode: 'closed_form' },
      }),
    ).toEqual({ success: true });
    expect(runner.getTournament().bracketMatches.filter((m) => m.round === 1).length).toBeGreaterThanOrEqual(4);
  });
});
