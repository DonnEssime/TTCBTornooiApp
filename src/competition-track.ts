import type {
  BracketMatch,
  GroupDefinition,
  Match,
  ModelReason,
  PlayerId,
  Tournament,
} from './model';
import {
  buildNumberedGroupsFromPlayerOrder,
  buildNumberedGroupsFromPlayerOrderByGroupCount,
  emptyClassTournamentSlice,
  recomputeClassTournamentSlices,
  roundRobinPairs,
  shuffleDeterministic,
  tournamentUsesClassTabs,
} from './model';

export type TrackGroupsPayload =
  | { groups: Array<{ id: string; label?: string; playerIds: string[] }> }
  | { targetGroupSize: number; playerIds: string[] }
  | { targetGroupCount: number; playerIds: string[] };

export type SetTrackGroupsMessages = {
  passOneOf: string;
  requiresOneOf: string;
};

export type SetTrackGroupsFail = { key: string; params?: Record<string, string> };

/** Create scheduled round-robin matches for each group (skips existing match ids). */
export function addGroupRoundRobinMatches(
  tournament: Tournament,
  groupsRecord: Record<string, GroupDefinition>,
  classId?: string,
): void {
  for (const g of Object.values(groupsRecord)) {
    for (const [a, b] of roundRobinPairs(g.playerIds)) {
      const sortedPair = [a, b].sort((x, y) => x.localeCompare(y));
      const mid = classId
        ? `gm-${classId}-${g.id}-${sortedPair[0]}-${sortedPair[1]}`
        : `gm-${g.id}-${sortedPair[0]}-${sortedPair[1]}`;
      if (tournament.matches[mid]) continue;
      tournament.matches[mid] = {
        id: mid,
        playerA: a,
        playerB: b,
        scores: [],
        status: 'scheduled',
        groupId: g.id,
        ...(classId ? { classId } : {}),
      };
    }
  }
}

/**
 * Define groups on a competition track and materialize round-robin match rows.
 * Returns `true` on success or a failure key for {@link commandFail}.
 */
export function setTrackGroups(
  tournament: Tournament,
  classId: string | undefined,
  payload: TrackGroupsPayload,
  commandId: string,
  messages: SetTrackGroupsMessages,
): true | SetTrackGroupsFail {
  const resolved = resolveTrackClassId(tournament, classId);
  if ('key' in resolved) {
    return resolved;
  }
  const trackClassId = resolved.classId;
  const track = getCompetitionTrack(tournament, trackClassId);
  if (tournamentUsesClassTabs(tournament) && trackClassId && !tournament.classTournaments[trackClassId]) {
    return { key: 'command.classSliceNotFound' };
  }
  const eligible = trackClassId ? new Set(track.seedings) : null;

  const hasGroups = 'groups' in payload && payload.groups !== undefined;
  const hasSize = 'targetGroupSize' in payload;
  const hasCount = 'targetGroupCount' in payload;
  if ((hasGroups ? 1 : 0) + (hasSize ? 1 : 0) + (hasCount ? 1 : 0) > 1) {
    return { key: messages.passOneOf };
  }

  let shuffleGroupMemberOrder = false;
  let groups: Array<{ id: string; label?: string; playerIds: string[] }>;
  if (hasSize || hasCount) {
    shuffleGroupMemberOrder = true;
    const rawList = (payload as { playerIds: unknown }).playerIds;
    if (!Array.isArray(rawList)) {
      return { key: 'command.playerIdsMustBeArray' };
    }
    const ordered: string[] = [];
    const seenPid = new Set<string>();
    for (const x of rawList) {
      const pid = String(x ?? '').trim();
      if (!pid || seenPid.has(pid)) continue;
      if (eligible) {
        if (!eligible.has(pid)) {
          return { key: 'command.playerNotInClassSeedingList', params: { pid } };
        }
      } else if (!tournament.players[pid]) {
        return { key: 'command.unknownPlayer', params: { pid } };
      }
      seenPid.add(pid);
      ordered.push(pid);
    }
    if (hasSize) {
      const ts = Number((payload as { targetGroupSize: number }).targetGroupSize);
      const tInt = Math.floor(ts);
      if (!Number.isFinite(ts) || tInt < 1) {
        return { key: 'command.targetGroupSizePositive' };
      }
      const defs = buildNumberedGroupsFromPlayerOrder(ordered, tInt);
      groups = defs.map((g) => ({ id: g.id, label: g.label, playerIds: g.playerIds }));
    } else {
      const tc = Number((payload as { targetGroupCount: number }).targetGroupCount);
      const gInt = Math.floor(tc);
      if (!Number.isFinite(tc) || gInt < 1) {
        return { key: 'command.targetGroupCountPositive' };
      }
      const defs = buildNumberedGroupsFromPlayerOrderByGroupCount(ordered, gInt);
      groups = defs.map((g) => ({ id: g.id, label: g.label, playerIds: g.playerIds }));
    }
  } else if (hasGroups) {
    const arr = (payload as { groups: unknown }).groups;
    if (!Array.isArray(arr)) {
      return { key: 'command.groupsMustBeArray' };
    }
    groups = arr as Array<{ id: string; label?: string; playerIds: string[] }>;
  } else {
    return { key: messages.requiresOneOf };
  }

  for (const mid of Object.keys(tournament.matches)) {
    const m = tournament.matches[mid];
    if (!m?.groupId) continue;
    if (trackClassId) {
      if (m.classId === trackClassId) {
        delete tournament.matches[mid];
      }
    } else if (!m.classId) {
      delete tournament.matches[mid];
    }
  }

  const rec: Record<string, GroupDefinition> = {};
  const gidSeen = new Set<string>();
  const pidSeen = new Set<string>();
  const shufflePrefix = trackClassId ? `${commandId}:class:${trackClassId}:group-order:` : `${commandId}:group-order:`;

  for (const raw of groups) {
    const id = String(raw.id ?? '').trim();
    if (!id) {
      return { key: 'command.eachGroupNeedsId' };
    }
    if (gidSeen.has(id)) {
      return { key: 'command.duplicateGroupId' };
    }
    gidSeen.add(id);
    const label = String(raw.label ?? '').trim();
    const playerIds = Array.isArray(raw.playerIds) ? [...raw.playerIds] : [];
    for (const pid of playerIds) {
      if (eligible) {
        if (!eligible.has(pid)) {
          return { key: 'command.playerNotInClassSeedingList', params: { pid } };
        }
      } else if (!tournament.players[pid]) {
        return { key: 'command.unknownPlayerInGroup', params: { id, pid } };
      }
      if (pidSeen.has(pid)) {
        return { key: 'command.playerInMultipleGroups', params: { pid } };
      }
      pidSeen.add(pid);
    }
    rec[id] = {
      id,
      ...(label ? { label } : {}),
      playerIds: shuffleGroupMemberOrder
        ? shuffleDeterministic(playerIds, `${shufflePrefix}${id}`)
        : [...playerIds],
    };
  }

  const err = mutateCompetitionTrack(tournament, trackClassId, (tr) => {
    tr.groups = rec;
  });
  if (err) {
    return err;
  }
  addGroupRoundRobinMatches(tournament, rec, trackClassId);
  return true;
}

export { tournamentUsesClassTabs };

/** One competition track (main draw or a class slice). */
export type CompetitionTrack = {
  classId: string | undefined;
  seedings: string[];
  groups: Record<string, GroupDefinition>;
  bracketMatches: BracketMatch[];
  lockedBracketRounds: number[];
};

/** Session / dependency map key for the main (non-class) track. */
export const MAIN_TRACK_KEY = '';

function sliceForClass(t: Tournament, classId: string) {
  if (!t.classTournaments[classId]) {
    t.classTournaments[classId] = emptyClassTournamentSlice();
  }
  const slice = t.classTournaments[classId];
  if (!slice.lockedBracketRounds) {
    slice.lockedBracketRounds = [];
  }
  return slice;
}

/** All tracks in display order (main draw, or one per class definition). */
export function listCompetitionTracks(t: Tournament): CompetitionTrack[] {
  if (!tournamentUsesClassTabs(t)) {
    return [
      {
        classId: undefined,
        seedings: t.seedings,
        groups: t.groups,
        bracketMatches: t.bracketMatches,
        lockedBracketRounds: t.lockedBracketRounds ?? [],
      },
    ];
  }
  return t.classDefinitions.map((def) => {
    const sl = sliceForClass(t, def.id);
    return {
      classId: def.id,
      seedings: sl.seedings,
      groups: sl.groups,
      bracketMatches: sl.bracketMatches,
      lockedBracketRounds: sl.lockedBracketRounds ?? [],
    };
  });
}

/**
 * Read/write view of one track. Mutating `groups`, `bracketMatches`, or `lockedBracketRounds`
 * updates the underlying tournament (global fields or class slice).
 */
export function getCompetitionTrack(t: Tournament, classId?: string): CompetitionTrack {
  if (!tournamentUsesClassTabs(t)) {
    if (classId) {
      return {
        classId: undefined,
        seedings: [],
        groups: {},
        bracketMatches: [],
        lockedBracketRounds: [],
      };
    }
    if (!t.lockedBracketRounds) {
      t.lockedBracketRounds = [];
    }
    return {
      classId: undefined,
      seedings: t.seedings,
      groups: t.groups,
      bracketMatches: t.bracketMatches,
      lockedBracketRounds: t.lockedBracketRounds,
    };
  }
  const cid = String(classId ?? '').trim();
  if (!cid || !t.classDefinitions.some((c) => c.id === cid)) {
    return {
      classId: cid || undefined,
      seedings: [],
      groups: {},
      bracketMatches: [],
      lockedBracketRounds: [],
    };
  }
  const sl = sliceForClass(t, cid);
  return {
    classId: cid,
    seedings: sl.seedings,
    groups: sl.groups,
    bracketMatches: sl.bracketMatches,
    lockedBracketRounds: sl.lockedBracketRounds,
  };
}

/** When multi-class, `classId` must be set; returns id, undefined (main), or a reason. */
export function requireTrackClassId(t: Tournament, classId?: string): string | undefined | ModelReason {
  if (!tournamentUsesClassTabs(t)) {
    const raw = classId !== undefined && classId !== null ? String(classId).trim() : '';
    if (raw) {
      return { key: 'command.classIdMustNotBeSetSingleClass' };
    }
    return undefined;
  }
  const cid = String(classId ?? '').trim();
  if (!cid || !t.classDefinitions.some((c) => c.id === cid)) {
    return { key: 'model.trackClassIdRequired' };
  }
  return cid;
}

/** Resolve optional command `classId` for the current tournament mode. */
export function resolveTrackClassId(
  t: Tournament,
  classId?: string,
): { classId: string | undefined } | ModelReason {
  const raw = classId !== undefined && classId !== null ? String(classId).trim() : undefined;
  if (!tournamentUsesClassTabs(t)) {
    if (raw) {
      return { key: 'command.classIdMustNotBeSetSingleClass' };
    }
    return { classId: undefined };
  }
  if (!raw || !t.classDefinitions.some((c) => c.id === raw)) {
    return { key: 'model.trackClassIdRequired' };
  }
  return { classId: raw };
}

export function trackTitle(t: Tournament, classId: string | undefined, mainDrawLabel: string): string {
  if (!classId) {
    return mainDrawLabel;
  }
  const def = t.classDefinitions.find((d) => d.id === classId);
  return def?.name?.trim() || classId;
}

export function trackGroupMatches(t: Tournament, classId: string | undefined): Match[] {
  return Object.values(t.matches).filter((m) => {
    if (!m.groupId) return false;
    if (classId === undefined) return !m.classId;
    return m.classId === classId;
  });
}

/** Install a knockout bracket on the given track and clear round locks on that track. */
export function applyBracketToTrack(
  tournament: Tournament,
  bracketMatches: BracketMatch[],
  classId?: string,
): void {
  if (Object.keys(tournament.teamMatches).length > 0) {
    throw new Error('Cannot apply a player bracket while team vs team matches exist');
  }
  const resolved = resolveTrackClassId(tournament, classId);
  if ('key' in resolved) {
    throw new Error(resolved.key);
  }
  const cid = resolved.classId;
  if (cid) {
    const slice = sliceForClass(tournament, cid);
    slice.bracketMatches = bracketMatches;
    slice.lockedBracketRounds = [];
    return;
  }
  tournament.bracketMatches = bracketMatches;
  tournament.lockedBracketRounds = [];
}

/** Writable storage for a track (for commands that assign groups / locks). */
export function mutateCompetitionTrack(
  t: Tournament,
  classId: string | undefined,
  fn: (track: {
    seedings: string[];
    groups: Record<string, GroupDefinition>;
    bracketMatches: BracketMatch[];
    lockedBracketRounds: number[];
  }) => void,
): ModelReason | undefined {
  const resolved = resolveTrackClassId(t, classId);
  if ('key' in resolved) {
    return resolved;
  }
  if (resolved.classId) {
    const slice = sliceForClass(t, resolved.classId);
    fn(slice);
    return undefined;
  }
  if (!t.lockedBracketRounds) {
    t.lockedBracketRounds = [];
  }
  const main = {
    get seedings(): string[] {
      return t.seedings;
    },
    set seedings(v: string[]) {
      t.seedings = v;
    },
    get groups(): Record<string, GroupDefinition> {
      return t.groups;
    },
    set groups(v: Record<string, GroupDefinition>) {
      t.groups = v;
    },
    get bracketMatches(): BracketMatch[] {
      return t.bracketMatches;
    },
    set bracketMatches(v: BracketMatch[]) {
      t.bracketMatches = v;
    },
    get lockedBracketRounds(): number[] {
      return t.lockedBracketRounds;
    },
    set lockedBracketRounds(v: number[]) {
      t.lockedBracketRounds = v;
    },
  };
  fn(main);
  return undefined;
}

/** Seedings used for bracket generation on this track. */
export function trackSeedingsForBracket(t: Tournament, classId?: string): string[] {
  const track = getCompetitionTrack(t, classId);
  if (tournamentUsesClassTabs(t)) {
    return [...track.seedings];
  }
  return [...t.seedings];
}

/** Ensure class slices are up to date before track reads (after flag/seed changes). */
export function refreshClassSlices(t: Tournament): void {
  if (t.classDefinitions.length > 0) {
    recomputeClassTournamentSlices(t);
  }
}
