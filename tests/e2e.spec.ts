import { describe, it, expect } from 'vitest';
import { TournamentController } from '../src/controller';
import { ConsoleTournamentView } from '../src/view';

describe('End-to-end tournament flow', () => {
  it('should create players, teams, bracket, enter scores, and support undo', () => {
    const controller = new TournamentController(undefined, { debug: true });
    controller.setView(new ConsoleTournamentView());

    expect(controller.createPlayer('p1', 'Alice')).toEqual({ success: true });
    expect(controller.createPlayer('p2', 'Bob')).toEqual({ success: true });
    expect(controller.createPlayer('p3', 'Charlie')).toEqual({ success: true });
    expect(controller.createPlayer('p4', 'Dana')).toEqual({ success: true });

    expect(controller.createTeam('t1', 'Team Alpha', ['p1', 'p2'])).toEqual({ success: true });
    expect(controller.createTeam('t2', 'Team Beta', ['p3', 'p4'])).toEqual({ success: true });

    controller.getTournament().seedings = ['t1', 't2'];
    controller.generateBracket(true, false);
    expect(controller.getTournament().bracketMatches.length).toBe(1);

    expect(controller.createTeamMatch('tm1', 't1', 't2', [], 'cmd-team-match')).toEqual({ success: true });

    expect(
      controller.enterTeamScore(
        'tm1',
        [
          { playerA: 11, playerB: 9 },
          { playerA: 11, playerB: 6 },
          { playerA: 11, playerB: 8 },
        ],
        ['cmd-team-match'],
        'cmd-team-score',
      ),
    ).toEqual({ success: true });

    expect(controller.getTournament().teamMatches['tm1']?.status).toBe('finished');

    // bracket winner should settle and round advance automatically
    expect(controller.getTournament().bracketMatches[0].winner).toBe('t1');
    expect(controller.getTournament().bracketMatches.some((m) => m.round === 2)).toBe(true);

    // assign tables to first (or second) round, then verify assignment placed
    controller.assignTables(['Table1', 'Table2'], 2);
    expect(controller.getTournament().tableAssignments[0]).toMatchObject({ tableId: 'Table1', round: 2 });

    // Undo score entry (dependent command should be undoable)
    const undoResult = controller.undo('cmd-team-score');
    expect(undoResult.success).toBe(true);
    expect(controller.getTournament().teamMatches['tm1']?.status).toBe('scheduled');

    // Undo team match (has no dependents now)
    expect(controller.canUndo('cmd-team-match')).toBeTruthy();
  });
});
