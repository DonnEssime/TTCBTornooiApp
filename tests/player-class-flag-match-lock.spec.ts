import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../src/command';
import { bracketPlayerMatchId, playerHasAnyRecordedMatchInClass } from '../src/model';

function baseCmd(id: string, type: string, payload: unknown, dependsOn: string[] = []) {
  return {
    id,
    type,
    timestamp: '2026-01-01T00:00:00.000Z',
    dependsOn,
    payload,
  };
}

const bo3 = [
  { playerA: 11, playerB: 5 },
  { playerA: 11, playerB: 5 },
  { playerA: 11, playerB: 5 },
];

describe('SetPlayerClassFlags class removal after recorded play', () => {
  function seedMultiClassSingles(runner: CommandRunner): void {
    runner.execute(
      baseCmd('tc', 'SetTournamentClasses', {
        classes: [
          { id: 'jun', name: 'Junior' },
          { id: 'sen', name: 'Senior' },
        ],
      }),
    );
    for (const pid of ['p1', 'p2', 'p3', 'p4']) {
      runner.execute(baseCmd(pid, 'CreatePlayer', { playerId: pid, name: pid, handicap: 0 }, ['tc']));
    }
    runner.execute(
      baseCmd('seed', 'SetSeedings', { playerIds: ['p1', 'p2', 'p3', 'p4'] }, ['p1', 'p2', 'p3', 'p4']),
    );
    for (const [pid, flags] of [
      ['p1', { jun: true, sen: true }],
      ['p2', { jun: true, sen: false }],
      ['p3', { jun: true, sen: false }],
      ['p4', { jun: false, sen: true }],
    ] as const) {
      runner.execute(baseCmd(`f-${pid}`, 'SetPlayerClassFlags', { playerId: pid, flags }, ['seed']));
    }
    runner.execute(
      baseCmd(
        'sg-jun',
        'SetClassGroups',
        { classId: 'jun', groups: [{ id: '1', playerIds: ['p1', 'p2', 'p3'] }] },
        ['seed'],
      ),
    );
    runner.execute(
      baseCmd(
        'sg-sen',
        'SetClassGroups',
        { classId: 'sen', groups: [{ id: '1', playerIds: ['p4'] }] },
        ['seed'],
      ),
    );
  }

  it('blocks removing a player from a class after a scored group match in that class', () => {
    const r = new CommandRunner();
    seedMultiClassSingles(r);
    expect(
      r.execute(
        baseCmd('score', 'EnterScore', { matchId: 'gm-jun-1-p1-p2', scores: bo3 }, ['sg-jun']),
      ).success,
    ).toBe(true);

    expect(playerHasAnyRecordedMatchInClass(r.getTournament(), 'p1', 'jun')).toBe(true);

    const res = r.execute(
      baseCmd('off-jun', 'SetPlayerClassFlags', { playerId: 'p1', flags: { jun: false } }, ['seed']),
    );
    expect(res.success).toBe(false);
    expect(res.reason).toBe('command.cannotRemovePlayerFromClassAlreadyPlayed');
    expect(r.getTournament().playerClassFlags.p1?.jun).toBe(true);
  });

  it('allows removing a player from a class when group matches are still untouched', () => {
    const r = new CommandRunner();
    seedMultiClassSingles(r);

    const res = r.execute(
      baseCmd('off-jun', 'SetPlayerClassFlags', { playerId: 'p1', flags: { jun: false } }, ['seed']),
    );
    expect(res.success).toBe(true);
    expect(r.getTournament().playerClassFlags.p1?.jun).toBe(false);
  });

  it('allows removing a class when recorded play exists only in another class', () => {
    const r = new CommandRunner();
    seedMultiClassSingles(r);
    expect(
      r.execute(
        baseCmd('score', 'EnterScore', { matchId: 'gm-jun-1-p1-p2', scores: bo3 }, ['sg-jun']),
      ).success,
    ).toBe(true);

    const res = r.execute(
      baseCmd('off-sen', 'SetPlayerClassFlags', { playerId: 'p1', flags: { sen: false } }, ['seed']),
    );
    expect(res.success).toBe(true);
    expect(r.getTournament().playerClassFlags.p1?.sen).toBe(false);
  });

  it('blocks removing a player from a class after a scored bracket match in that class', () => {
    const r = new CommandRunner();
    seedMultiClassSingles(r);
    for (const mid of ['gm-jun-1-p1-p2', 'gm-jun-1-p1-p3', 'gm-jun-1-p2-p3']) {
      expect(r.execute(baseCmd(`score-${mid}`, 'EnterScore', { matchId: mid, scores: bo3 }, ['sg-jun'])).success).toBe(
        true,
      );
    }
    expect(r.execute(baseCmd('gen', 'GenerateBracket', { classId: 'jun', fillByes: true }, ['score-gm-jun-1-p2-p3'])).success).toBe(
      true,
    );
    const bm = r.getTournament().classTournaments.jun!.bracketMatches.find((m) => m.seedA && m.seedB)!;
    const mid = bracketPlayerMatchId(bm.id, 'jun');
    expect(
      r.execute(
        baseCmd('cm-br', 'CreateMatch', { matchId: mid, playerA: bm.seedA, playerB: bm.seedB, classId: 'jun' }, ['gen']),
      ).success,
    ).toBe(true);
    expect(r.execute(baseCmd('score-br', 'EnterScore', { matchId: mid, scores: bo3 }, ['cm-br'])).success).toBe(true);

    const res = r.execute(
      baseCmd('off-jun', 'SetPlayerClassFlags', { playerId: 'p1', flags: { jun: false } }, ['seed']),
    );
    expect(res.success).toBe(false);
    expect(res.reason).toBe('command.cannotRemovePlayerFromClassAlreadyPlayed');
  });

  it('blocks removing a player from a doubles class after a scored group match', () => {
    const r = new CommandRunner();
    r.execute(
      baseCmd('tc', 'SetTournamentClasses', {
        classes: [{ id: 'jun', name: 'Junior' }],
      }),
    );
    for (const pid of ['p1', 'p2', 'p3', 'p4']) {
      r.execute(baseCmd(pid, 'CreatePlayer', { playerId: pid, name: pid, handicap: 0 }, ['tc']));
    }
    r.execute(
      baseCmd('seed', 'SetSeedings', { playerIds: ['p1', 'p2', 'p3', 'p4'] }, ['p1', 'p2', 'p3', 'p4']),
    );
    for (const pid of ['p1', 'p2', 'p3', 'p4']) {
      r.execute(baseCmd(`f-${pid}`, 'SetPlayerClassFlags', { playerId: pid, flags: { jun: true } }, ['seed']));
    }
    r.execute(
      baseCmd(
        'sg-jun',
        'SetClassGroups',
        {
          classId: 'jun',
          targetGroupSize: 4,
          playerIds: ['p1', 'p2', 'p3', 'p4'],
          format: 'doubles-random-partners',
        },
        ['seed'],
      ),
    );
    const gm = Object.values(r.getTournament().matches).find((m) => m.classId === 'jun' && m.groupId)!;
    expect(r.execute(baseCmd('score', 'EnterScore', { matchId: gm.id, scores: bo3 }, ['sg-jun'])).success).toBe(true);
    expect(playerHasAnyRecordedMatchInClass(r.getTournament(), 'p1', 'jun')).toBe(true);

    const res = r.execute(
      baseCmd('off-jun', 'SetPlayerClassFlags', { playerId: 'p1', flags: { jun: false } }, ['seed']),
    );
    expect(res.success).toBe(false);
    expect(res.reason).toBe('command.cannotRemovePlayerFromClassAlreadyPlayed');
  });
});

describe('SetPlayerClassFlags class add after bracket generated', () => {
  function seedJunWithBracket(runner: CommandRunner): void {
    runner.execute(
      baseCmd('tc', 'SetTournamentClasses', {
        classes: [
          { id: 'jun', name: 'Junior' },
          { id: 'sen', name: 'Senior' },
        ],
      }),
    );
    for (const pid of ['p1', 'p2', 'p3', 'p4']) {
      runner.execute(baseCmd(pid, 'CreatePlayer', { playerId: pid, name: pid, handicap: 0 }, ['tc']));
    }
    runner.execute(
      baseCmd('seed', 'SetSeedings', { playerIds: ['p1', 'p2', 'p3', 'p4'] }, ['p1', 'p2', 'p3', 'p4']),
    );
    for (const [pid, flags] of [
      ['p1', { jun: true, sen: false }],
      ['p2', { jun: true, sen: false }],
      ['p3', { jun: true, sen: false }],
      ['p4', { jun: false, sen: true }],
    ] as const) {
      runner.execute(baseCmd(`f-${pid}`, 'SetPlayerClassFlags', { playerId: pid, flags }, ['seed']));
    }
    runner.execute(
      baseCmd(
        'sg-jun',
        'SetClassGroups',
        { classId: 'jun', groups: [{ id: '1', playerIds: ['p1', 'p2', 'p3'] }] },
        ['seed'],
      ),
    );
    for (const mid of ['gm-jun-1-p1-p2', 'gm-jun-1-p1-p3', 'gm-jun-1-p2-p3']) {
      expect(runner.execute(baseCmd(`score-${mid}`, 'EnterScore', { matchId: mid, scores: bo3 }, ['sg-jun'])).success).toBe(
        true,
      );
    }
    expect(
      runner.execute(baseCmd('gen', 'GenerateBracket', { classId: 'jun', fillByes: true }, ['score-gm-jun-1-p2-p3']))
        .success,
    ).toBe(true);
  }

  it('blocks adding a player to a class after a bracket has been generated', () => {
    const r = new CommandRunner();
    seedJunWithBracket(r);

    const res = r.execute(
      baseCmd('on-jun', 'SetPlayerClassFlags', { playerId: 'p4', flags: { jun: true } }, ['seed']),
    );
    expect(res.success).toBe(false);
    expect(res.reason).toBe('command.cannotAddPlayerToClassBracketGenerated');
    expect(r.getTournament().playerClassFlags.p4?.jun).toBe(false);
  });

  it('allows adding a player to another class without a generated bracket', () => {
    const r = new CommandRunner();
    seedJunWithBracket(r);

    const res = r.execute(
      baseCmd('on-sen', 'SetPlayerClassFlags', { playerId: 'p1', flags: { sen: true } }, ['seed']),
    );
    expect(res.success).toBe(true);
    expect(r.getTournament().playerClassFlags.p1?.sen).toBe(true);
  });

  it('allows reaffirming class membership when a bracket already exists', () => {
    const r = new CommandRunner();
    seedJunWithBracket(r);

    const res = r.execute(
      baseCmd('keep-jun', 'SetPlayerClassFlags', { playerId: 'p1', flags: { jun: true } }, ['seed']),
    );
    expect(res.success).toBe(true);
    expect(r.getTournament().playerClassFlags.p1?.jun).toBe(true);
  });
});
