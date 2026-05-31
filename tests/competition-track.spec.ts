import { describe, expect, it } from 'vitest';
import {
  applyBracketToTrack,
  getCompetitionTrack,
  listCompetitionTracks,
  requireTrackClassId,
  resolveTrackClassId,
  trackGroupMatches,
} from '../src/competition-track';
import { createTournament, generateBracket, recomputeClassTournamentSlices } from '../src/model';

describe('competition-track', () => {
  it('single-class lists one main track from globals', () => {
    const t = createTournament();
    t.seedings = ['p1', 'p2'];
    t.groups = { '1': { id: '1', playerIds: ['p1', 'p2'] } };
    t.bracketMatches = [{ id: 'm1', seedA: 'p1', seedB: 'p2', round: 1 }];
    t.lockedBracketRounds = [1];

    const tracks = listCompetitionTracks(t);
    expect(tracks).toHaveLength(1);
    expect(tracks[0].classId).toBeUndefined();
    expect(tracks[0].seedings).toEqual(['p1', 'p2']);
    expect(tracks[0].groups['1']?.playerIds).toEqual(['p1', 'p2']);
    expect(tracks[0].bracketMatches).toHaveLength(1);
    expect(tracks[0].lockedBracketRounds).toEqual([1]);
  });

  it('multi-class lists one track per class definition', () => {
    const t = createTournament();
    t.classDefinitions = [
      { id: 'jun', name: 'Junior' },
      { id: 'sen', name: 'Senior' },
    ];
    t.playerClassFlags = { p1: { jun: true, sen: false }, p2: { jun: false, sen: true } };
    t.seedings = ['p1', 'p2'];
    recomputeClassTournamentSlices(t);
    t.classTournaments.jun!.groups = { '1': { id: '1', playerIds: ['p1'] } };
    t.classTournaments.sen!.bracketMatches = generateBracket(['p2'], { fillByes: false, cullToPowerOfTwo: false });

    const tracks = listCompetitionTracks(t);
    expect(tracks).toHaveLength(2);
    expect(tracks[0].classId).toBe('jun');
    expect(tracks[0].groups['1']?.playerIds).toEqual(['p1']);
    expect(tracks[1].classId).toBe('sen');
    expect(tracks[1].bracketMatches.length).toBeGreaterThan(0);
  });

  it('requireTrackClassId requires classId when multi-class', () => {
    const t = createTournament();
    t.classDefinitions = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ];
    expect(requireTrackClassId(t, undefined)).toEqual({ key: 'model.trackClassIdRequired' });
    expect(requireTrackClassId(t, 'a')).toBe('a');
  });

  it('resolveTrackClassId rejects classId on single-class track', () => {
    const t = createTournament();
    expect(resolveTrackClassId(t, 'jun')).toEqual({ key: 'command.classIdMustNotBeSetSingleClass' });
    expect(resolveTrackClassId(t, undefined)).toEqual({ classId: undefined });
  });

  it('applyBracketToTrack writes global bracket for single-class', () => {
    const t = createTournament();
    t.seedings = ['p1', 'p2', 'p3', 'p4'];
    const bm = generateBracket(t.seedings, { fillByes: false, cullToPowerOfTwo: false });
    applyBracketToTrack(t, bm, undefined);
    expect(t.bracketMatches).toEqual(bm);
    expect(t.lockedBracketRounds).toEqual([]);
  });

  it('applyBracketToTrack writes slice bracket for multi-class', () => {
    const t = createTournament();
    t.classDefinitions = [
      { id: 'jun', name: 'Junior' },
      { id: 'sen', name: 'Senior' },
    ];
    t.playerClassFlags = { p1: { jun: true, sen: false }, p2: { jun: true, sen: false } };
    t.seedings = ['p1', 'p2'];
    recomputeClassTournamentSlices(t);
    const bm = generateBracket(['p1', 'p2'], { fillByes: false, cullToPowerOfTwo: false });
    applyBracketToTrack(t, bm, 'jun');
    expect(t.bracketMatches).toEqual([]);
    expect(t.classTournaments.jun!.bracketMatches).toEqual(bm);
    expect(t.classTournaments.jun!.lockedBracketRounds).toEqual([]);
  });

  it('trackGroupMatches scopes by classId', () => {
    const t = createTournament();
    t.matches = {
      'gm-1-p1-p2': {
        id: 'gm-1-p1-p2',
        playerA: 'p1',
        playerB: 'p2',
        scores: [],
        status: 'scheduled',
        groupId: '1',
      },
      'gm-jun-1-p1-p2': {
        id: 'gm-jun-1-p1-p2',
        playerA: 'p1',
        playerB: 'p2',
        scores: [],
        status: 'scheduled',
        groupId: '1',
        classId: 'jun',
      },
    };
    expect(trackGroupMatches(t, undefined).map((m) => m.id)).toEqual(['gm-1-p1-p2']);
    expect(trackGroupMatches(t, 'jun').map((m) => m.id)).toEqual(['gm-jun-1-p1-p2']);
  });

  it('getCompetitionTrack shares groups object with tournament storage', () => {
    const t = createTournament();
    t.groups = { g: { id: 'g', playerIds: ['p1'] } };
    const track = getCompetitionTrack(t, undefined);
    expect(track.groups).toBe(t.groups);
    track.groups['g']!.playerIds.push('p2');
    expect(t.groups.g!.playerIds).toEqual(['p1', 'p2']);
  });
});
