import type { Locale } from './i18n/types';
import { txt } from './i18n';
import type { CompetitionPair, GroupDefinition, Match, PlayerId, Tournament, TrackFormat } from './model';
import {
  displayLabelForGroup,
  groupAllMatchesFinished,
  groupStandingsRowsForBracketDoubles,
  isHandicapActive,
  partitionPlayerCountIntoGroupCount,
  partitionPlayerCountIntoGroupSizes,
  shuffleDeterministic,
} from './model';
import { getCompetitionTrack } from './competition-track';

export type { TrackFormat, CompetitionPair };

export function getTrackFormat(t: Tournament, classId?: string): TrackFormat {
  if (classId) {
    return t.classTournaments[classId]?.competitionFormat ?? 'singles';
  }
  return t.competitionFormat ?? 'singles';
}

export function isDoublesTrack(t: Tournament, classId?: string): boolean {
  return getTrackFormat(t, classId) === 'doubles-random-partners';
}

export function getTrackPairs(t: Tournament, classId?: string): Record<string, CompetitionPair> {
  if (classId) {
    return t.classTournaments[classId]?.pairs ?? {};
  }
  return t.pairs ?? {};
}

/** Deterministic random pairing: shuffle all players, then consecutive pairs. */
export function formRandomPairs(playerIds: PlayerId[], seed: string): CompetitionPair[] {
  const shuffled = shuffleDeterministic([...playerIds].filter(Boolean), seed);
  const pairs: CompetitionPair[] = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    const a = shuffled[i]!;
    const b = shuffled[i + 1]!;
    const sorted = [a, b].sort((x, y) => x.localeCompare(y));
    pairs.push({
      id: `pair-${sorted[0]}-${sorted[1]}`,
      playerIds: [sorted[0], sorted[1]],
    });
  }
  return pairs;
}

export function pairForPlayer(
  t: Tournament,
  classId: string | undefined,
  playerId: PlayerId,
): CompetitionPair | undefined {
  for (const p of Object.values(getTrackPairs(t, classId))) {
    if (p.playerIds[0] === playerId || p.playerIds[1] === playerId) return p;
  }
  return undefined;
}

export function pairById(
  t: Tournament,
  classId: string | undefined,
  pairId: string,
): CompetitionPair | undefined {
  return getTrackPairs(t, classId)[pairId];
}

export function pairHandicapValue(t: Tournament, pair: CompetitionPair): number {
  if (!isHandicapActive(t)) return 0;
  const h1 = t.players[pair.playerIds[0]]?.handicap ?? 0;
  const h2 = t.players[pair.playerIds[1]]?.handicap ?? 0;
  return Math.floor((h1 + h2) / 2);
}

export function pairDisplayLabel(
  t: Tournament,
  pairId: string,
  classId?: string,
  locale: Locale = 'en',
): string {
  const pair = pairById(t, classId, pairId);
  if (!pair) return pairId;
  const n1 = t.players[pair.playerIds[0]]?.name ?? pair.playerIds[0];
  const n2 = t.players[pair.playerIds[1]]?.name ?? pair.playerIds[1];
  return txt('model.pairDisplayLabel', locale, { a: n1, b: n2 });
}

export function allPlayersInMatch(t: Tournament, m: Match, classId?: string): PlayerId[] {
  if (m.pairA && m.pairB) {
    const pairs = getTrackPairs(t, classId);
    const pa = pairs[m.pairA];
    const pb = pairs[m.pairB];
    if (pa && pb) return [...pa.playerIds, ...pb.playerIds];
  }
  return [m.playerA, m.playerB];
}

export function matchSideLabels(
  t: Tournament,
  m: Match,
  classId?: string,
  locale: Locale = 'en',
): { sideA: string; sideB: string } {
  if (m.pairA && m.pairB) {
    return {
      sideA: pairDisplayLabel(t, m.pairA, classId, locale),
      sideB: pairDisplayLabel(t, m.pairB, classId, locale),
    };
  }
  const a = t.players[m.playerA]?.name ?? m.playerA;
  const b = t.players[m.playerB]?.name ?? m.playerB;
  return { sideA: a, sideB: b };
}

export function trackBracketParticipants(t: Tournament, classId?: string): string[] {
  if (isDoublesTrack(t, classId)) {
    return Object.keys(getTrackPairs(t, classId));
  }
  return getCompetitionTrack(t, classId).seedings;
}

function buildNumberedGroupsFromPairSizes(pairs: CompetitionPair[], sizesInPairs: number[]): GroupDefinition[] {
  const out: GroupDefinition[] = [];
  let offset = 0;
  for (let gi = 0; gi < sizesInPairs.length; gi++) {
    const sz = sizesInPairs[gi]!;
    const chunk = pairs.slice(offset, offset + sz);
    offset += sz;
    const num = String(gi + 1);
    out.push({
      id: num,
      pairIds: chunk.map((p) => p.id),
      playerIds: chunk.flatMap((p) => [...p.playerIds]),
    });
  }
  return out;
}

/** Distribute pairs into numbered groups; targetSize is players per group (must be even). */
export function buildNumberedGroupsFromPairOrder(
  pairs: CompetitionPair[],
  targetSizeInPlayers: number,
): GroupDefinition[] {
  const n = pairs.length;
  if (n === 0) return [];
  const pairsPerGroup = Math.max(1, Math.floor(targetSizeInPlayers / 2));
  const sizesInPairs = partitionPlayerCountIntoGroupSizes(n, pairsPerGroup);
  return buildNumberedGroupsFromPairSizes(pairs, sizesInPairs);
}

export function buildNumberedGroupsFromPairOrderByGroupCount(
  pairs: CompetitionPair[],
  targetGroupCount: number,
): GroupDefinition[] {
  const n = pairs.length;
  if (n === 0) return [];
  const sizesInPairs = partitionPlayerCountIntoGroupCount(n, targetGroupCount);
  return buildNumberedGroupsFromPairSizes(pairs, sizesInPairs);
}

export function findGroupForPair(
  tournament: Tournament,
  pairId: string,
  classId: string | undefined,
): GroupDefinition | undefined {
  const rec = classId ? tournament.classTournaments[classId]?.groups ?? {} : tournament.groups;
  return Object.values(rec).find((g) => g.pairIds?.includes(pairId));
}

export function formatBracketSlotPairLabel(
  tournament: Tournament,
  pairId: string,
  classId: string | undefined,
  locale: Locale = 'en',
): string {
  const g = findGroupForPair(tournament, pairId, classId);
  if (!g || groupAllMatchesFinished(tournament, g, classId)) {
    return pairDisplayLabel(tournament, pairId, classId, locale);
  }
  const rows = groupStandingsRowsForBracketDoubles(tournament, g, classId);
  const idx = rows.findIndex((r) => r.pid === pairId);
  const place = idx >= 0 ? idx + 1 : 1;
  return txt('model.bracketSlotPlaceLabel', locale, {
    group: displayLabelForGroup(g, locale),
    placeWord: txt('model.placeWord', locale),
    place: String(place),
  });
}

export function bracketPairIdentityResolvedForDisplay(
  tournament: Tournament,
  pairId: string,
  classId: string | undefined,
): boolean {
  const g = findGroupForPair(tournament, pairId, classId);
  if (!g) return true;
  return groupAllMatchesFinished(tournament, g, classId);
}

export function pairsRecordFromList(pairs: CompetitionPair[]): Record<string, CompetitionPair> {
  const rec: Record<string, CompetitionPair> = {};
  for (const p of pairs) rec[p.id] = p;
  return rec;
}

export function applyTrackFormatAndPairs(
  tournament: Tournament,
  classId: string | undefined,
  format: TrackFormat,
  pairs: Record<string, CompetitionPair>,
): void {
  if (classId) {
    const slice = tournament.classTournaments[classId];
    if (!slice) return;
    slice.competitionFormat = format;
    slice.pairs = pairs;
    return;
  }
  tournament.competitionFormat = format;
  tournament.pairs = pairs;
}

export function clearTrackFormatAndPairs(tournament: Tournament, classId: string | undefined): void {
  if (classId) {
    const slice = tournament.classTournaments[classId];
    if (!slice) return;
    delete slice.competitionFormat;
    delete slice.pairs;
    return;
  }
  delete tournament.competitionFormat;
  delete tournament.pairs;
}
