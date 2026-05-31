import { describe, it, expect } from 'vitest';
import {
  collectMatchNoteSlipBatches,
  collectMatchNoteSlips,
  matchNotesPageCount,
  MATCH_NOTES_GAMES_PER_SLIP,
  MATCH_NOTES_SLIPS_PER_PAGE,
} from '../src/match-notes';
import { CommandRunner } from '../src/command';
import { createTournament, generateBracket } from '../src/model';

function setGroups4(runner: CommandRunner): void {
  const ts = '2026-01-01T00:00:00.000Z';
  for (const [id, name] of [
    ['p1', 'A'],
    ['p2', 'B'],
    ['p3', 'C'],
    ['p4', 'D'],
  ] as const) {
    runner.execute({
      id,
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: id, name, handicap: 0 },
      timestamp: ts,
    });
  }
  runner.execute({
    id: 'sg',
    type: 'SetGroups',
    dependsOn: ['p1', 'p2', 'p3', 'p4'],
    payload: { targetGroupSize: 2, playerIds: ['p1', 'p2', 'p3', 'p4'] },
    timestamp: ts,
  });
}

describe('match-notes', () => {
  it('matchNotesPageCount uses 6 slips per page and 5 games per slip', () => {
    expect(MATCH_NOTES_SLIPS_PER_PAGE).toBe(6);
    expect(MATCH_NOTES_GAMES_PER_SLIP).toBe(5);
    expect(matchNotesPageCount(0)).toBe(0);
    expect(matchNotesPageCount(1)).toBe(1);
    expect(matchNotesPageCount(6)).toBe(1);
    expect(matchNotesPageCount(7)).toBe(2);
  });

  it('collects unfinished group matches for group-overall', () => {
    const runner = new CommandRunner();
    setGroups4(runner);
    const t = runner.getTournament();
    const all = collectMatchNoteSlips(t, { kind: 'group-overall' }, 'en');
    expect(all.length).toBe(2);
    expect(all[0]!.playerA.name).toBe('A');
    const gm = Object.values(t.matches).find((m) => m.groupId === '1')!;
    const fin = runner.execute({
      id: 'fin',
      type: 'EnterScore',
      dependsOn: ['sg'],
      payload: {
        matchId: gm.id,
        scores: [
          { playerA: 11, playerB: 5 },
          { playerA: 11, playerB: 5 },
          { playerA: 11, playerB: 5 },
        ],
      },
      timestamp: '2026-01-01T00:01:00.000Z',
    });
    expect(fin.success).toBe(true);
    expect(runner.getTournament().matches[gm.id]!.status).toBe('finished');
    const after = collectMatchNoteSlips(runner.getTournament(), { kind: 'group-overall' }, 'en');
    expect(after.length).toBe(1);
  });

  it('group-overall returns one batch per group for page breaks', () => {
    const runner = new CommandRunner();
    setGroups4(runner);
    const batches = collectMatchNoteSlipBatches(runner.getTournament(), { kind: 'group-overall' }, 'en');
    expect(batches.length).toBe(2);
    expect(batches[0]!.length).toBe(1);
    expect(batches[1]!.length).toBe(1);
    expect(collectMatchNoteSlips(runner.getTournament(), { kind: 'group-overall' }, 'en').length).toBe(2);
  });

  it('collects only one group for group-pool segment', () => {
    const runner = new CommandRunner();
    setGroups4(runner);
    const slips = collectMatchNoteSlips(runner.getTournament(), { kind: 'group-pool', groupId: '1' }, 'en');
    expect(slips.length).toBe(1);
    expect(slips[0]!.contextLine).toContain('Group 1');
  });

  it('collects bracket round slips excluding bye walkovers and finished slots', () => {
    const t = createTournament();
    for (let i = 1; i <= 4; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    const r1 = generateBracket(['p1', 'p2', 'p3', 'p4'], { fillByes: false, cullToPowerOfTwo: false });
    t.bracketMatches = r1;
    const slips = collectMatchNoteSlips(t, { kind: 'bracket-round', round: 1 }, 'en');
    expect(slips.length).toBe(2);
    r1[0]!.winner = r1[0]!.seedA!;
    const afterWin = collectMatchNoteSlips(t, { kind: 'bracket-round', round: 1 }, 'en');
    expect(afterWin.length).toBe(1);
  });
});
