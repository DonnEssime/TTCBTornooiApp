import { describe, it, expect } from 'vitest';
import { TournamentController } from '../src/controller';

/** Mirrors App.svelte: create player, seed, assign first class, add class, toggle new class flag. */
describe('AddTournamentClass then assign existing players', () => {
  it('CreatePlayer in multi-class leaves all class flags false until opted in', () => {
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
    expect(c.createPlayer(playerId, 'Alice', 0, '', `cmd-${playerId}`)).toEqual({ success: true });
    expect(c.setSeedings([playerId], [`cmd-${playerId}`], 'cmd-seed-1')).toEqual({ success: true });

    const t = c.getTournament();
    expect(t.playerClassFlags[playerId]).toEqual({ jun: false, sen: false });
    expect(t.classTournaments.jun?.seedings).toEqual([]);
    expect(t.classTournaments.sen?.seedings).toEqual([]);
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
