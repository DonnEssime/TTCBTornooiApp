import { describe, it, expect } from 'vitest';
import { TournamentController } from '../src/controller';
import {
  firstNonCompletedClassId,
  isClassTrackFullyComplete,
} from '../src/competition-track';

/** Mirrors App.svelte addPlayer: create, seed, assign first non-completed class. */
function addPlayerLikeUi(
  c: TournamentController,
  playerId: string,
  name: string,
): void {
  expect(c.createPlayer(playerId, name, 0, '', `cmd-${playerId}`)).toEqual({ success: true });
  expect(c.setSeedings([playerId], [`cmd-${playerId}`], `cmd-seed-${playerId}`)).toEqual({ success: true });
  const t = c.getTournament();
  const classId = firstNonCompletedClassId(t);
  if (classId) {
    expect(
      c.setPlayerClassFlags(playerId, { [classId]: true }, [`cmd-${playerId}`], `cmd-pcf-${playerId}-${classId}`),
    ).toEqual({ success: true });
  }
}

describe('AddTournamentClass then assign existing players', () => {
  it('assigns a new player to the first non-completed class in multi-class setup', () => {
    const c = new TournamentController();
    expect(
      c.setTournamentClasses(
        [
          { id: 'jun', name: 'Junior' },
          { id: 'sen', name: 'Senior' },
        ],
        [],
        'cmd-classes-init',
      ),
    ).toEqual({ success: true });

    const playerId = 'p-new';
    addPlayerLikeUi(c, playerId, 'Alice');

    const t = c.getTournament();
    expect(t.playerClassFlags[playerId]).toEqual({ jun: true, sen: false });
    expect(t.classTournaments.jun?.seedings).toEqual([playerId]);
    expect(t.classTournaments.sen?.seedings).toEqual([]);
  });

  it('assigns to senior when junior class track is fully complete', () => {
    const c = new TournamentController();
    expect(
      c.setTournamentClasses(
        [
          { id: 'jun', name: 'Junior' },
          { id: 'sen', name: 'Senior' },
        ],
        [],
        'cmd-classes-init',
      ),
    ).toEqual({ success: true });

    for (const [id, name, cls] of [
      ['j1', 'J1', 'jun'],
      ['j2', 'J2', 'jun'],
      ['s1', 'S1', 'sen'],
      ['s2', 'S2', 'sen'],
    ] as const) {
      expect(c.createPlayer(id, name, 0, '', `cmd-${id}`)).toEqual({ success: true });
      expect(
        c.setPlayerClassFlags(id, { [cls]: true }, [`cmd-${id}`], `cmd-pcf-${id}-${cls}`),
      ).toEqual({ success: true });
    }
    expect(
      c.setSeedings(['j1', 'j2', 's1', 's2'], ['cmd-j1', 'cmd-j2', 'cmd-s1', 'cmd-s2'], 'cmd-seed-all'),
    ).toEqual({ success: true });

    expect(
      c.setClassGroups('jun', [{ id: '1', playerIds: ['j1', 'j2'] }], ['cmd-seed-all'], 'cmd-jun-groups'),
    ).toEqual({ success: true });
    expect(
      c.setClassGroups(
        'sen',
        [{ id: '1', playerIds: ['s1', 's2'] }],
        ['cmd-seed-all', 'cmd-jun-groups'],
        'cmd-sen-groups',
      ),
    ).toEqual({ success: true });

    const t0 = c.getTournament();
    const junMatch = Object.values(t0.matches).find((m) => m.classId === 'jun')!;
    expect(
      c.enterScore(
        junMatch.id,
        [
          { playerA: 11, playerB: 5 },
          { playerA: 11, playerB: 7 },
          { playerA: 11, playerB: 3 },
        ],
        [],
        'cmd-jun-score',
      ),
    ).toEqual({ success: true });
    expect(isClassTrackFullyComplete(c.getTournament(), 'jun')).toBe(true);
    expect(isClassTrackFullyComplete(c.getTournament(), 'sen')).toBe(false);
    expect(firstNonCompletedClassId(c.getTournament())).toBe('sen');

    addPlayerLikeUi(c, 'p-new', 'Alice');
    const t = c.getTournament();
    expect(t.playerClassFlags['p-new']).toEqual({ jun: false, sen: true });
    expect(t.classTournaments.sen?.seedings).toContain('p-new');
  });

  it('opts an original player into a newly added class (UI dependency pattern)', () => {
    const c = new TournamentController();
    expect(
      c.setTournamentClasses(
        [
          { id: 'jun', name: 'Junior' },
          { id: 'sen', name: 'Senior' },
        ],
        [],
        'cmd-classes-init',
      ),
    ).toEqual({ success: true });

    const playerId = 'p-abc123';
    expect(c.createPlayer(playerId, 'Alice', 0, '', `cmd-${playerId}`)).toEqual({ success: true });
    expect(c.setSeedings([playerId], [`cmd-${playerId}`], 'cmd-seed-1')).toEqual({ success: true });
    expect(
      c.setPlayerClassFlags(playerId, { jun: true }, [`cmd-${playerId}`], 'cmd-pcf-jun'),
    ).toEqual({ success: true });

    expect(c.addTournamentClass('Veteran', [], 'cmd-add-vet', 'vet')).toEqual({ success: true });

    expect(
      c.setPlayerClassFlags(playerId, { vet: true }, [`cmd-${playerId}`], 'cmd-pcf-vet'),
    ).toEqual({ success: true });

    const t = c.getTournament();
    expect(t.playerClassFlags[playerId]?.vet).toBe(true);
    expect(t.classTournaments.vet?.seedings).toEqual([playerId]);
  });

  it('opts an original player into a class added after single-class setup (wizard flow)', () => {
    const c = new TournamentController();
    expect(
      c.setTournamentClasses([{ id: 'jun', name: 'Junior' }], [], 'cmd-classes-init'),
    ).toEqual({ success: true });

    const playerId = 'p-abc123';
    expect(c.createPlayer(playerId, 'Alice', 0, '', `cmd-${playerId}`)).toEqual({ success: true });
    expect(c.setSeedings([playerId], [`cmd-${playerId}`], 'cmd-seed-1')).toEqual({ success: true });
    expect(
      c.setPlayerClassFlags(playerId, { jun: true }, [`cmd-${playerId}`], 'cmd-pcf-jun'),
    ).toEqual({ success: true });

    expect(c.addTournamentClass('Senior', [], 'cmd-add-sen')).toEqual({ success: true });
    const senId = c.getTournament().classDefinitions.find((d) => d.name === 'Senior')!.id;

    expect(
      c.setPlayerClassFlags(playerId, { [senId]: true }, [`cmd-${playerId}`], 'cmd-pcf-sen'),
    ).toEqual({ success: true });

    const t = c.getTournament();
    expect(t.playerClassFlags[playerId]?.[senId]).toBe(true);
    expect(t.classTournaments[senId]?.seedings).toEqual([playerId]);
  });
});
