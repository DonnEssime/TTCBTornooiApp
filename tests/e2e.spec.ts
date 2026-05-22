import { describe, it, expect } from 'vitest';
import { TournamentController } from '../src/controller';
import { ConsoleTournamentView } from '../src/view';

describe('End-to-end tournament flow', () => {
  it('should run a player bracket tournament with scores and undo', () => {
    const controller = new TournamentController(undefined, { debug: true });
    controller.setView(new ConsoleTournamentView());

    expect(controller.createPlayer('p1', 'Alice', 0, 'cmd-p1')).toEqual({ success: true });
    expect(controller.createPlayer('p2', 'Bob', 0, 'cmd-p2')).toEqual({ success: true });
    expect(controller.createPlayer('p3', 'Charlie', 0, 'cmd-p3')).toEqual({ success: true });
    expect(controller.createPlayer('p4', 'Dana', 0, 'cmd-p4')).toEqual({ success: true });

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

    expect(controller.createPlayer('p1', 'Alice', 0, 'c-p1')).toEqual({ success: true });
    expect(controller.createPlayer('p2', 'Bob', 0, 'c-p2')).toEqual({ success: true });
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
});
