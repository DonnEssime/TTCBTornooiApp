import { describe, it, expect } from 'vitest';
import {
  collectMatchNoteSlipBatches,
  collectMatchNoteSlips,
  matchNotesPageCount,
  matchNotesSegmentHasSlips,
  MATCH_NOTES_GAMES_PER_SLIP,
  MATCH_NOTES_SLIPS_PER_PAGE,
} from '../src/match-notes';
import { CommandRunner } from '../src/command';
import { createTournament, generateBracket } from '../src/model';
import { catalog } from '../src/i18n/catalog';
import { messageText } from '../src/i18n/resolve';

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
    payload: {
      groups: [
        { id: '1', playerIds: ['p1', 'p2'] },
        { id: '2', playerIds: ['p3', 'p4'] },
      ],
      playerIds: [],
    },
    timestamp: ts,
  });
}

/** One poule of three players → three round-robin matches. */
function setGroupOfThree(runner: CommandRunner): void {
  const ts = '2026-01-01T00:00:00.000Z';
  for (const [id, name] of [
    ['p1', 'A'],
    ['p2', 'B'],
    ['p3', 'C'],
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
    dependsOn: ['p1', 'p2', 'p3'],
    payload: {
      groups: [{ id: '1', playerIds: ['p1', 'p2', 'p3'] }],
      playerIds: [],
    },
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

  it('group-overall packs all groups into one layout batch for compact printing', () => {
    const runner = new CommandRunner();
    setGroups4(runner);
    const batches = collectMatchNoteSlipBatches(runner.getTournament(), { kind: 'group-overall' }, 'en');
    expect(batches.length).toBe(1);
    expect(batches[0]!.length).toBe(2);
    expect(batches[0]![0]!.contextLine).toContain('Group 1');
    expect(batches[0]![1]!.contextLine).toContain('Group 2');
    expect(matchNotesPageCount(batches[0]!.length)).toBe(1);
  });

  it('collects only one group for group-pool segment', () => {
    const runner = new CommandRunner();
    setGroups4(runner);
    const slips = collectMatchNoteSlips(runner.getTournament(), { kind: 'group-pool', groupId: '1' }, 'en');
    expect(slips.length).toBe(1);
    expect(slips[0]!.contextLine).toContain('Group 1');
    expect(slips[0]!.contextLine).toMatch(/match 1/);
  });

  it('numbers group-pool slips 1..N by match id order', () => {
    const runner = new CommandRunner();
    setGroupOfThree(runner);
    const slips = collectMatchNoteSlips(runner.getTournament(), { kind: 'group-pool', groupId: '1' }, 'en');
    expect(slips.length).toBe(3);
    expect(slips.map((s) => s.contextLine)).toEqual([
      expect.stringMatching(/Group 1, match 1$/),
      expect.stringMatching(/Group 1, match 2$/),
      expect.stringMatching(/Group 1, match 3$/),
    ]);
    expect(slips[0]!.matchKey.localeCompare(slips[1]!.matchKey)).toBeLessThan(0);
    expect(slips[1]!.matchKey.localeCompare(slips[2]!.matchKey)).toBeLessThan(0);
  });

  it('keeps stable group match numbers after an earlier match finishes', () => {
    const runner = new CommandRunner();
    setGroupOfThree(runner);
    const t = runner.getTournament();
    const byId = Object.values(t.matches)
      .filter((m) => m.groupId === '1')
      .sort((a, b) => a.id.localeCompare(b.id));
    expect(byId.length).toBe(3);
    const first = byId[0]!;
    const fin = runner.execute({
      id: 'fin',
      type: 'EnterScore',
      dependsOn: ['sg'],
      payload: {
        matchId: first.id,
        scores: [
          { playerA: 11, playerB: 5 },
          { playerA: 11, playerB: 5 },
          { playerA: 11, playerB: 5 },
        ],
      },
      timestamp: '2026-01-01T00:01:00.000Z',
    });
    expect(fin.success).toBe(true);
    const slips = collectMatchNoteSlips(runner.getTournament(), { kind: 'group-pool', groupId: '1' }, 'en');
    expect(slips.length).toBe(2);
    expect(slips[0]!.matchKey).toBe(byId[1]!.id);
    expect(slips[0]!.contextLine).toMatch(/Group 1, match 2$/);
    expect(slips[1]!.matchKey).toBe(byId[2]!.id);
    expect(slips[1]!.contextLine).toMatch(/Group 1, match 3$/);
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
    expect(slips[0]!.contextLine).toMatch(/match 1/);
    expect(slips[1]!.contextLine).toMatch(/match 2/);
    r1[0]!.winner = r1[0]!.seedA!;
    const afterWin = collectMatchNoteSlips(t, { kind: 'bracket-round', round: 1 }, 'en');
    expect(afterWin.length).toBe(1);
    expect(afterWin[0]!.contextLine).toMatch(/match 2$/);
  });

  it('uses wedstrijd for Dutch match numbers on group and bracket slips', () => {
    const runner = new CommandRunner();
    setGroupOfThree(runner);
    const groupSlips = collectMatchNoteSlips(runner.getTournament(), { kind: 'group-pool', groupId: '1' }, 'nl');
    expect(groupSlips[0]!.contextLine).toMatch(/Poule 1, wedstrijd 1$/);

    const t = createTournament();
    for (let i = 1; i <= 4; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    t.bracketMatches = generateBracket(['p1', 'p2', 'p3', 'p4'], { fillByes: false, cullToPowerOfTwo: false });
    const bracketSlips = collectMatchNoteSlips(t, { kind: 'bracket-round', round: 1 }, 'nl');
    expect(bracketSlips.length).toBe(2);
    expect(bracketSlips[0]!.contextLine).toMatch(/wedstrijd 1$/);
    expect(bracketSlips[1]!.contextLine).toMatch(/wedstrijd 2$/);
  });

  it('blocks bracket-round printing when any pending match lacks both known players', () => {
    const t = createTournament();
    t.players = {
      p1: { id: 'p1', name: 'A', handicap: 0 },
      p2: { id: 'p2', name: 'B', handicap: 0 },
      p3: { id: 'p3', name: 'C', handicap: 0 },
      p4: { id: 'p4', name: 'D', handicap: 0 },
    };
    t.groups = {
      g1: { id: 'g1', label: 'Alpha', playerIds: ['p1', 'p2'] },
      g2: { id: 'g2', label: 'Beta', playerIds: ['p3', 'p4'] },
    };
    t.matches = {
      'gm-g1-p1-p2': {
        id: 'gm-g1-p1-p2',
        playerA: 'p1',
        playerB: 'p2',
        scores: [],
        status: 'scheduled',
        groupId: 'g1',
      },
      'gm-g2-p3-p4': {
        id: 'gm-g2-p3-p4',
        playerA: 'p3',
        playerB: 'p4',
        scores: [],
        status: 'scheduled',
        groupId: 'g2',
      },
    };
    t.bracketMatches = generateBracket(['p1', 'p2', 'p3', 'p4'], { fillByes: false, cullToPowerOfTwo: false });
    const segment = { kind: 'bracket-round' as const, round: 1 };
    expect(matchNotesSegmentHasSlips(t, segment, 'en')).toBe(false);
    expect(collectMatchNoteSlips(t, segment, 'en')).toEqual([]);

    t.matches['gm-g1-p1-p2']!.status = 'finished';
    t.matches['gm-g1-p1-p2']!.scores = [
      { playerA: 11, playerB: 0 },
      { playerA: 11, playerB: 0 },
      { playerA: 11, playerB: 0 },
    ];
    t.matches['gm-g1-p1-p2']!.winner = 'p1';
    expect(matchNotesSegmentHasSlips(t, segment, 'en')).toBe(false);

    t.matches['gm-g2-p3-p4']!.status = 'finished';
    t.matches['gm-g2-p3-p4']!.scores = [
      { playerA: 11, playerB: 0 },
      { playerA: 11, playerB: 0 },
      { playerA: 11, playerB: 0 },
    ];
    t.matches['gm-g2-p3-p4']!.winner = 'p3';
    expect(matchNotesSegmentHasSlips(t, segment, 'en')).toBe(true);
    expect(collectMatchNoteSlips(t, segment, 'en').length).toBe(2);
  });

  it('blocks bracket-round printing when a pending match is still waiting for an opponent', () => {
    const t = createTournament();
    for (let i = 1; i <= 4; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: `P${i}`, handicap: 0 };
    }
    const bracket = generateBracket(['p1', 'p2', 'p3', 'p4'], { fillByes: false, cullToPowerOfTwo: false });
    t.bracketMatches = bracket;
    bracket[0]!.winner = bracket[0]!.seedA!;
    const segment = { kind: 'bracket-round' as const, round: 2 };
    expect(matchNotesSegmentHasSlips(t, segment, 'en')).toBe(false);
    expect(collectMatchNoteSlips(t, segment, 'en')).toEqual([]);
  });

  it('collects class-scoped group-pool and bracket-round slips in multi-class tournaments', () => {
    const runner = new CommandRunner();
    runner.execute({
      id: 'tc',
      type: 'SetTournamentClasses',
      dependsOn: [],
      payload: { classes: [{ id: 'jun', name: 'Junior' }, { id: 'sen', name: 'Senior' }] },
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    for (const [pid, name] of [['p1', 'J1'], ['p2', 'J2'], ['p3', 'S1'], ['p4', 'S2']] as const) {
      runner.execute({
        id: pid,
        type: 'CreatePlayer',
        dependsOn: ['tc'],
        payload: { playerId: pid, name, handicap: 0 },
        timestamp: '2026-01-01T00:00:01.000Z',
      });
    }
    runner.execute({
      id: 'seed',
      type: 'SetSeedings',
      dependsOn: ['p1', 'p2', 'p3', 'p4'],
      payload: { playerIds: ['p1', 'p2', 'p3', 'p4'] },
      timestamp: '2026-01-01T00:00:02.000Z',
    });
    for (const [pid, flags] of [
      ['p1', { jun: true, sen: false }],
      ['p2', { jun: true, sen: false }],
      ['p3', { jun: false, sen: true }],
      ['p4', { jun: false, sen: true }],
    ] as const) {
      runner.execute({
        id: `f-${pid}`,
        type: 'SetPlayerClassFlags',
        dependsOn: ['seed'],
        payload: { playerId: pid, flags },
        timestamp: '2026-01-01T00:00:03.000Z',
      });
    }
    runner.execute({
      id: 'scg-jun',
      type: 'SetClassGroups',
      dependsOn: ['seed'],
      payload: { classId: 'jun', groups: [{ id: '1', playerIds: ['p1', 'p2'] }] },
      timestamp: '2026-01-01T00:00:04.000Z',
    });
    runner.execute({
      id: 'scg-sen',
      type: 'SetClassGroups',
      dependsOn: ['seed'],
      payload: { classId: 'sen', groups: [{ id: '1', playerIds: ['p3', 'p4'] }] },
      timestamp: '2026-01-01T00:00:05.000Z',
    });
    runner.execute({
      id: 'ggrr-jun',
      type: 'GenerateGroupRoundRobin',
      dependsOn: ['scg-jun'],
      payload: { classId: 'jun' },
      timestamp: '2026-01-01T00:00:06.000Z',
    });
    runner.execute({
      id: 'ggrr-sen',
      type: 'GenerateGroupRoundRobin',
      dependsOn: ['scg-sen'],
      payload: { classId: 'sen' },
      timestamp: '2026-01-01T00:00:07.000Z',
    });
    runner.execute({
      id: 'gen-jun',
      type: 'GenerateBracket',
      dependsOn: ['scg-jun'],
      payload: { fillByes: false, cullToPowerOfTwo: false, classId: 'jun' },
      timestamp: '2026-01-01T00:00:08.000Z',
    });
    const gm = Object.values(runner.getTournament().matches).find(
      (m) => m.classId === 'jun' && m.groupId === '1',
    )!;
    runner.execute({
      id: 'fin-jun',
      type: 'EnterScore',
      dependsOn: ['ggrr-jun'],
      payload: {
        matchId: gm.id,
        scores: [
          { playerA: 11, playerB: 5 },
          { playerA: 11, playerB: 5 },
          { playerA: 11, playerB: 5 },
        ],
      },
      timestamp: '2026-01-01T00:00:08.500Z',
    });
    const t = runner.getTournament();
    const junBm = t.classTournaments.jun!.bracketMatches.find((m) => m.round === 1 && m.seedA && m.seedB)!;
    runner.execute({
      id: 'pair-jun',
      type: 'CreateMatch',
      dependsOn: ['gen-jun'],
      payload: {
        matchId: `match-jun-${junBm.id}`,
        playerA: junBm.seedA,
        playerB: junBm.seedB,
        classId: 'jun',
      },
      timestamp: '2026-01-01T00:00:08.750Z',
    });
    const tAfter = runner.getTournament();
    const junPool = collectMatchNoteSlips(tAfter, { kind: 'group-pool', classId: 'jun', groupId: '1' }, 'en');
    const senPool = collectMatchNoteSlips(tAfter, { kind: 'group-pool', classId: 'sen', groupId: '1' }, 'en');
    expect(junPool.length).toBe(0);
    expect(senPool.length).toBe(1);
    expect(senPool[0]!.playerA.name).toBe('S1');
    const junBracket = collectMatchNoteSlips(tAfter, { kind: 'bracket-round', classId: 'jun', round: 1 }, 'en');
    expect(junBracket.length).toBe(1);
    expect(junBracket[0]!.contextLine).toContain('Junior');
    const senBracket = collectMatchNoteSlips(tAfter, { kind: 'bracket-round', classId: 'sen', round: 1 }, 'en');
    expect(senBracket.length).toBe(0);
  });

  it('uses S1–S5 for Dutch game column headers on match slips', () => {
    expect(messageText(catalog, 'ui.matchNotes.gameN', 'en', { n: '1' })).toBe('G1');
    expect(messageText(catalog, 'ui.matchNotes.gameN', 'nl', { n: '1' })).toBe('S1');
    expect(messageText(catalog, 'ui.matchNotes.gameN', 'nl', { n: '3' })).toBe('S3');
  });

  it('uses Total / Totaal for match score column header', () => {
    expect(messageText(catalog, 'ui.matchNotes.total', 'en')).toBe('Total');
    expect(messageText(catalog, 'ui.matchNotes.total', 'nl')).toBe('Totaal');
  });

  it('formats match-note context lines with match / wedstrijd numbers', () => {
    expect(
      messageText(catalog, 'ui.matchNotes.contextGroup', 'en', {
        track: 'Main draw',
        group: 'Group 1',
        n: '3',
      }),
    ).toBe('Main draw · Group 1, match 3');
    expect(
      messageText(catalog, 'ui.matchNotes.contextGroup', 'nl', {
        track: 'Hoofdreeks',
        group: 'Poule 1',
        n: '3',
      }),
    ).toBe('Hoofdreeks · Poule 1, wedstrijd 3');
    expect(
      messageText(catalog, 'ui.matchNotes.contextBracket', 'en', {
        track: 'Main draw',
        round: 'final',
        n: '1',
      }),
    ).toBe('Main draw · final, match 1');
  });

  it('doubles group slips show both players on each side', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const runner = new CommandRunner();
    for (const [id, name] of [
      ['p1', 'Alice'],
      ['p2', 'Bob'],
      ['p3', 'Carol'],
      ['p4', 'Dave'],
      ['p5', 'Eve'],
      ['p6', 'Frank'],
      ['p7', 'Grace'],
      ['p8', 'Henry'],
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
      dependsOn: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
      payload: {
        targetGroupSize: 4,
        playerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
        format: 'doubles-random-partners',
      },
      timestamp: ts,
    });
    const slips = collectMatchNoteSlips(runner.getTournament(), { kind: 'group-overall' }, 'en');
    expect(slips.length).toBeGreaterThan(0);
    const slip = slips[0]!;
    expect(slip.playerA.name).toMatch(/Alice|Bob/);
    expect(slip.playerA.name).toMatch(/Alice|Bob/);
    expect(slip.playerA.name).not.toBe('Alice');
    expect(slip.playerA.name).not.toBe('Bob');
  });

  it('shuffle doubles group slips show both players on each side', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const runner = new CommandRunner();
    for (const [id, name] of [
      ['p1', 'Alice'],
      ['p2', 'Bob'],
      ['p3', 'Carol'],
      ['p4', 'Dave'],
      ['p5', 'Eve'],
      ['p6', 'Frank'],
      ['p7', 'Grace'],
      ['p8', 'Henry'],
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
      dependsOn: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
      payload: {
        targetGroupSize: 4,
        playerIds: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'],
        format: 'doubles-shuffle-partners',
      },
      timestamp: ts,
    });
    const slips = collectMatchNoteSlips(runner.getTournament(), { kind: 'group-overall' }, 'en');
    expect(slips.length).toBe(6);
    const slip = slips.find((s) => s.matchKey.includes('shuffle')) ?? slips[0]!;
    expect(slip.playerA.name).toContain(' / ');
    expect(slip.playerB.name).toContain(' / ');
  });
});
