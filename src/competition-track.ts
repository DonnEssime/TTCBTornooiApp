import type {
  BracketMatch,
  CompetitionPair,
  GroupDefinition,
  Match,
  PlayerId,
  Tournament,
  TrackFormat,
} from './model';
import type { ModelReason } from './i18n';
import {
  buildNumberedGroupsFromPlayerOrder,
  buildNumberedGroupsFromPlayerOrderByGroupCount,
  emptyClassTournamentSlice,
  recomputeClassTournamentSlices,
  roundRobinPairs,
  shuffleDeterministic,
  tournamentUsesClassTabs,
} from './model';
import {
  applyTrackFormatAndPairs,
  buildNumberedGroupsFromPairOrder,
  buildNumberedGroupsFromPairOrderByGroupCount,
  clearTrackFormatAndPairs,
  formRandomPairs,
  pairsRecordFromList,
  trackBracketParticipants,
} from './doubles-track';
import { groupPhaseCounts, type GroupProgressSnapshot } from './match-ordering';

export type TrackGroupsFormat = { format?: TrackFormat };

export type TrackGroupsPayload =
  | ({ groups: Array<{ id: string; label?: string; playerIds: string[]; pairIds?: string[] }> } & TrackGroupsFormat)
  | ({ targetGroupSize: number; playerIds: string[] } & TrackGroupsFormat)
  | ({ targetGroupCount: number; playerIds: string[] } & TrackGroupsFormat);

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

export function groupDoublesMatchIdForPair(
  groupId: string,
  pairA: string,
  pairB: string,
  classId?: string,
): string {
  const sorted = [pairA, pairB].sort((x, y) => x.localeCompare(y));
  return classId
    ? `gm-${classId}-${groupId}-${sorted[0]}-${sorted[1]}`
    : `gm-${groupId}-${sorted[0]}-${sorted[1]}`;
}

/** Create scheduled pair-vs-pair round-robin matches for each doubles group. */
export function addGroupDoublesRoundRobinMatches(
  tournament: Tournament,
  groupsRecord: Record<string, GroupDefinition>,
  pairsRecord: Record<string, CompetitionPair>,
  classId?: string,
): void {
  for (const g of Object.values(groupsRecord)) {
    const pairIds = g.pairIds ?? [];
    for (const [pairAId, pairBId] of roundRobinPairs(pairIds)) {
      const mid = groupDoublesMatchIdForPair(g.id, pairAId, pairBId, classId);
      if (tournament.matches[mid]) continue;
      const pairA = pairsRecord[pairAId];
      const pairB = pairsRecord[pairBId];
      if (!pairA || !pairB) continue;
      tournament.matches[mid] = {
        id: mid,
        playerA: pairA.playerIds[0],
        playerB: pairB.playerIds[0],
        pairA: pairAId,
        pairB: pairBId,
        scores: [],
        status: 'scheduled',
        groupId: g.id,
        ...(classId ? { classId } : {}),
      };
    }
  }
}

function payloadFormat(payload: TrackGroupsPayload): TrackFormat {
  return payload.format === 'doubles-random-partners' ? 'doubles-random-partners' : 'singles';
}

function clearTrackGroupMatches(tournament: Tournament, trackClassId: string | undefined): void {
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
  const format = payloadFormat(payload);
  const eligible = trackClassId ? new Set(track.seedings) : null;

  const hasGroups = 'groups' in payload && payload.groups !== undefined;
  const hasSize = 'targetGroupSize' in payload;
  const hasCount = 'targetGroupCount' in payload;
  if ((hasGroups ? 1 : 0) + (hasSize ? 1 : 0) + (hasCount ? 1 : 0) > 1) {
    return { key: messages.passOneOf };
  }

  if (hasGroups && Array.isArray(payload.groups) && payload.groups.length === 0) {
    clearTrackGroupMatches(tournament, trackClassId);
    clearTrackFormatAndPairs(tournament, trackClassId);
    const err = mutateCompetitionTrack(tournament, trackClassId, (tr) => {
      tr.groups = {};
    });
    if (err) return err;
    return true;
  }

  let shuffleGroupMemberOrder = false;
  let groups: Array<{ id: string; label?: string; playerIds: string[]; pairIds?: string[] }>;

  if (format === 'doubles-random-partners' && (hasSize || hasCount)) {
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
    if (ordered.length % 2 !== 0) {
      return { key: 'command.doublesRequiresEvenPlayerCount' };
    }
    clearTrackGroupMatches(tournament, trackClassId);
    const pairs = formRandomPairs(ordered, `${commandId}:pairs`);
    const pairsRec = pairsRecordFromList(pairs);
    const shuffledPairs = shuffleDeterministic(pairs, `${commandId}:pair-order`);
    let groupDefs: GroupDefinition[];
    if (hasSize) {
      const ts = Number((payload as { targetGroupSize: number }).targetGroupSize);
      const tInt = Math.floor(ts);
      if (!Number.isFinite(ts) || tInt < 1) {
        return { key: 'command.targetGroupSizePositive' };
      }
      groupDefs = buildNumberedGroupsFromPairOrder(shuffledPairs, tInt);
    } else {
      const tc = Number((payload as { targetGroupCount: number }).targetGroupCount);
      const gInt = Math.floor(tc);
      if (!Number.isFinite(tc) || gInt < 1) {
        return { key: 'command.targetGroupCountPositive' };
      }
      groupDefs = buildNumberedGroupsFromPairOrderByGroupCount(shuffledPairs, gInt);
    }
    const rec: Record<string, GroupDefinition> = {};
    for (const g of groupDefs) {
      rec[g.id] = g;
    }
    applyTrackFormatAndPairs(tournament, trackClassId, 'doubles-random-partners', pairsRec);
    const err = mutateCompetitionTrack(tournament, trackClassId, (tr) => {
      tr.groups = rec;
    });
    if (err) return err;
    addGroupDoublesRoundRobinMatches(tournament, rec, pairsRec, trackClassId);
    return true;
  }

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
    groups = arr as Array<{ id: string; label?: string; playerIds: string[]; pairIds?: string[] }>;
  } else {
    return { key: messages.requiresOneOf };
  }

  clearTrackGroupMatches(tournament, trackClassId);
  if (format !== 'doubles-random-partners') {
    clearTrackFormatAndPairs(tournament, trackClassId);
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
      ...(raw.pairIds?.length ? { pairIds: [...raw.pairIds] } : {}),
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
  if (format === 'doubles-random-partners') {
    const pairsRec: Record<string, CompetitionPair> = {};
    for (const g of Object.values(rec)) {
      for (const pairId of g.pairIds ?? []) {
        if (pairsRec[pairId]) continue;
        const m = /^pair-(.+)-(.+)$/.exec(pairId);
        if (!m) {
          return { key: 'command.unknownPlayerInGroup', params: { id: g.id, pid: pairId } };
        }
        const a = m[1]!;
        const b = m[2]!;
        if (!tournament.players[a] || !tournament.players[b]) {
          return { key: 'command.unknownPlayerInGroup', params: { id: g.id, pid: pairId } };
        }
        pairsRec[pairId] = { id: pairId, playerIds: [a, b] };
      }
    }
    applyTrackFormatAndPairs(tournament, trackClassId, 'doubles-random-partners', pairsRec);
    addGroupDoublesRoundRobinMatches(tournament, rec, pairsRec, trackClassId);
    return true;
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

/** True when a class track already has a generated knockout bracket. */
export function classTrackHasGeneratedBracket(t: Tournament, classId: string): boolean {
  return getCompetitionTrack(t, classId).bracketMatches.length > 0;
}

/** Group matches for a track, limited to pools currently defined on that track. */
export function trackDefinedGroupMatches(
  t: Tournament,
  classId: string | undefined,
  groups: Record<string, GroupDefinition>,
): Match[] {
  const ids = new Set(Object.keys(groups));
  if (ids.size === 0) return [];
  return trackGroupMatches(t, classId).filter((m) => m.groupId !== undefined && ids.has(m.groupId));
}

/** Overview sidebar totals — same per-track scope as the per-pool progress rows. */
export function aggregateGroupPhaseCounts(t: Tournament): GroupProgressSnapshot {
  if (!tournamentUsesClassTabs(t)) {
    return groupPhaseCounts(trackGroupMatches(t, undefined));
  }
  let total = 0;
  let done = 0;
  for (const tr of listCompetitionTracks(t)) {
    const c = groupPhaseCounts(trackDefinedGroupMatches(t, tr.classId, tr.groups));
    total += c.total;
    done += c.done;
  }
  return { total, done };
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

/** Bracket participant ids for this track (pair ids in doubles, player ids in singles). */
export function trackSeedingsForBracket(t: Tournament, classId?: string): string[] {
  return trackBracketParticipants(t, classId);
}

/** Ensure class slices are up to date before track reads (after flag/seed changes). */
export function refreshClassSlices(t: Tournament): void {
  if (t.classDefinitions.length > 0) {
    recomputeClassTournamentSlices(t);
  }
}
