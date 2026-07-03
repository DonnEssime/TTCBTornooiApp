import { trackGroupMatches } from './competition-track';
import type { GroupDefinition, Match, PlayerId, Tournament } from './model';
import {
  playersOccupiedByMatch,
  roundRobinMatchRounds,
  roundRobinPairKey,
  roundRobinRoundIndexForPair,
} from './model';

/**
 * Pluggable ready-match ordering algorithm.
 *
 * Group-phase default uses round-robin group rounds; optional wave optimizer for table packing.
 */
export type ReadyMatchOrderingAlgorithm = 'groupCompletionStaggered';

export type GroupProgressSnapshot = {
  total: number;
  done: number;
};

export type ReadyMatchOrderingContext = {
  /** Total configured tables (not free tables). Used for wave estimate. */
  tableCount: number;
  /** Finished matches in completion order (old → new). */
  pastFinishedInOrder: Match[];
  /** In-progress matches in table-assignment order (old → new). */
  inProgressInAssignmentOrder: Match[];
  /**
   * Optional "warm start" preference: stable ordering hint for tie-breaks.
   * Earlier ids are preferred when wave count + back-to-back penalty are equal.
   */
  preferredReadyOrderIds?: string[];
};

/** Stable key for (competition class × group) when staggering ready group matches. */
export function groupReadyStaggerKey(m: Match): string {
  return `${m.classId ?? ''}\t${m.groupId ?? ''}`;
}

export function isGroupMatchFinished(m: Match): boolean {
  return m.status === 'finished' && Boolean(m.winner);
}

export function groupPhaseCounts(matches: Match[]): GroupProgressSnapshot {
  let total = 0;
  let done = 0;
  for (const m of matches) {
    total++;
    if (isGroupMatchFinished(m)) done++;
  }
  return { total, done };
}

export function groupDefForMatch(t: Tournament, m: Match): GroupDefinition | undefined {
  if (!m.groupId) return undefined;
  if (m.classId) {
    return t.classTournaments[m.classId]?.groups[m.groupId];
  }
  return t.groups[m.groupId];
}

function matchParticipantPair(m: Match): [PlayerId, PlayerId] | undefined {
  if (m.pairA && m.pairB) return [m.pairA, m.pairB];
  if (m.playerA && m.playerB) return [m.playerA, m.playerB];
  return undefined;
}

function matchSchedulePlayerIds(m: Match): PlayerId[] {
  return playersOccupiedByMatch(m);
}

function participantIdsForGroup(g: GroupDefinition, sample: Match): PlayerId[] {
  if (sample.teamA && sample.teamB) return g.playerIds;
  if (sample.pairA && sample.pairB && g.pairIds && g.pairIds.length > 0) {
    return g.pairIds;
  }
  return g.playerIds;
}

function groupMatchesFromTournament(t: Tournament, m: Match): Match[] {
  const classScope = m.classId ?? undefined;
  return trackGroupMatches(t, classScope).filter((x) => x.groupId === m.groupId);
}

/** Leading fully-finished round-robin rounds for a group (in-progress rounds do not count). */
export function groupCompletedRoundCount(
  groupMatches: readonly Match[],
  participantIds: readonly PlayerId[],
): number {
  const rounds = roundRobinMatchRounds(participantIds);
  const byKey = new Map<string, Match>();
  for (const gm of groupMatches) {
    const pair = matchParticipantPair(gm);
    if (!pair) continue;
    byKey.set(roundRobinPairKey(pair[0], pair[1]), gm);
  }

  let completed = 0;
  for (const round of rounds) {
    let allDone = true;
    for (const [a, b] of round) {
      const gm = byKey.get(roundRobinPairKey(a, b));
      if (!gm || !isGroupMatchFinished(gm)) {
        allDone = false;
        break;
      }
    }
    if (!allDone) break;
    completed++;
  }
  return completed;
}

function roundIndexForMatch(m: Match, participantIds: readonly PlayerId[]): number | undefined {
  if (m.shuffleRound !== undefined) return m.shuffleRound;
  const pair = matchParticipantPair(m);
  if (!pair) return undefined;
  return roundRobinRoundIndexForPair(participantIds, pair[0], pair[1]);
}

/**
 * Order ready group matches in full round-robin rounds: repeatedly emit every ready match
 * from the next incomplete round of the group with the fewest completed rounds.
 */
export function groupRoundStaggeredOrder(matches: Match[], tournament: Tournament): Match[] {
  if (matches.length <= 1) return [...matches];

  type GroupBucket = {
    key: string;
    participantIds: PlayerId[];
    matches: Match[];
    completedRounds: number;
    offeredRound: number;
  };

  const buckets = new Map<string, GroupBucket>();
  for (const m of matches) {
    const key = groupReadyStaggerKey(m);
    if (!buckets.has(key)) {
      const def = groupDefForMatch(tournament, m);
      if (!def) {
        buckets.set(key, { key, participantIds: [], matches: [], completedRounds: 0, offeredRound: 0 });
      } else {
        const participantIds = participantIdsForGroup(def, m);
        const allGroup = groupMatchesFromTournament(tournament, m);
        const completedRounds = groupCompletedRoundCount(allGroup, participantIds);
        buckets.set(key, { key, participantIds, matches: [], completedRounds, offeredRound: completedRounds });
      }
    }
    buckets.get(key)!.matches.push(m);
  }

  const remaining = new Set(matches.map((m) => m.id));
  const out: Match[] = [];

  while (remaining.size > 0) {
    let pickKey: string | null = null;
    let pickCompleted = Infinity;
    let pickOffered = Infinity;

    for (const [key, bucket] of buckets) {
      const hasRemaining = bucket.matches.some((m) => remaining.has(m.id));
      if (!hasRemaining) continue;
      if (
        bucket.completedRounds < pickCompleted ||
        (bucket.completedRounds === pickCompleted && bucket.offeredRound < pickOffered) ||
        (bucket.completedRounds === pickCompleted &&
          bucket.offeredRound === pickOffered &&
          (pickKey === null || key.localeCompare(pickKey) < 0))
      ) {
        pickCompleted = bucket.completedRounds;
        pickOffered = bucket.offeredRound;
        pickKey = key;
      }
    }

    if (!pickKey) break;

    const bucket = buckets.get(pickKey)!;
    const targetRound = bucket.offeredRound;
    const batch = bucket.matches
      .filter((m) => {
        if (!remaining.has(m.id)) return false;
        if (bucket.participantIds.length === 0) return true;
        const ri = roundIndexForMatch(m, bucket.participantIds);
        return ri === undefined || ri === targetRound;
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    if (batch.length === 0) {
      const fallback = bucket.matches.filter((m) => remaining.has(m.id)).sort((a, b) => a.id.localeCompare(b.id));
      out.push(...fallback);
      for (const m of fallback) remaining.delete(m.id);
      bucket.offeredRound += 1;
      continue;
    }

    out.push(...batch);
    for (const m of batch) remaining.delete(m.id);
    bucket.offeredRound += 1;
  }

  return out;
}

export type ScheduleMatchSlot = {
  playerA: PlayerId;
  playerB: PlayerId;
  /** All players busy during this match (shuffle doubles uses four). */
  playerIds?: PlayerId[];
};

/**
 * Estimate how many parallel "waves" (match-time units) are needed to play {@link ordered} when
 * assigning in list order to {@link tableCount} tables. Each wave fills up to tableCount matches
 * whose players are not already playing that wave; skipped entries stay queued for later waves.
 */
export function estimateScheduleWaves(ordered: ScheduleMatchSlot[], tableCount: number): number {
  if (ordered.length === 0) return 0;
  if (tableCount <= 0) return 0;

  let remaining = [...ordered];
  let waves = 0;

  while (remaining.length > 0) {
    waves++;
    const waveBusy = new Set<PlayerId>();
    let assigned = 0;
    const nextRemaining: ScheduleMatchSlot[] = [];

    for (const slot of remaining) {
      if (assigned >= tableCount) {
        nextRemaining.push(slot);
        continue;
      }
      if (waveBusy.has(slot.playerA) || waveBusy.has(slot.playerB)) {
        nextRemaining.push(slot);
        continue;
      }
      if (slotPlayerIds(slot).some((pid) => waveBusy.has(pid))) {
        nextRemaining.push(slot);
        continue;
      }
      for (const pid of slotPlayerIds(slot)) waveBusy.add(pid);
      assigned++;
    }

    if (assigned === 0) break;
    remaining = nextRemaining;
  }

  return waves;
}

type InternalMatchSlot = ScheduleMatchSlot & { id: string };

function slotOfMatch(m: Match): InternalMatchSlot {
  const playerIds = matchSchedulePlayerIds(m);
  return { id: m.id, playerA: m.playerA, playerB: m.playerB, playerIds };
}

function slotPlayerIds(slot: ScheduleMatchSlot): PlayerId[] {
  return slot.playerIds && slot.playerIds.length > 0 ? slot.playerIds : [slot.playerA, slot.playerB];
}

function matchUsesPlayer(m: ScheduleMatchSlot, p: PlayerId): boolean {
  return slotPlayerIds(m).includes(p);
}

function countBackToBackPlayers(
  waveSlots: ScheduleMatchSlot[],
  lastWavePlayers: Set<PlayerId>,
): number {
  let c = 0;
  for (const s of waveSlots) {
    for (const pid of slotPlayerIds(s)) {
      if (lastWavePlayers.has(pid)) c++;
    }
  }
  return c;
}

function hash32(s: string): number {
  // Simple deterministic string hash (FNV-1a-ish) for stable tie-break jitter.
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function greedyWavePack(
  remaining: InternalMatchSlot[],
  cap: number,
  lastWavePlayers: Set<PlayerId>,
  attemptSalt: number,
  preferredIndex: Map<string, number> | null,
): InternalMatchSlot[] {
  if (cap <= 0 || remaining.length === 0) return [];

  // Conflict degree proxy: how many remaining matches share either player.
  const perPlayerCount = new Map<PlayerId, number>();
  for (const m of remaining) {
    for (const pid of slotPlayerIds(m)) {
      perPlayerCount.set(pid, (perPlayerCount.get(pid) ?? 0) + 1);
    }
  }

  const takenPlayers = new Set<PlayerId>();
  const out: InternalMatchSlot[] = [];
  const rem = [...remaining];

  while (out.length < cap && rem.length > 0) {
    let bestIdx = -1;
    let bestScoreMain = -Infinity;
    let bestPref = Number.POSITIVE_INFINITY;
    let bestJitter = Number.POSITIVE_INFINITY;
    let bestId = '\uffff';

    for (let i = 0; i < rem.length; i++) {
      const m = rem[i]!;
      const pids = slotPlayerIds(m);
      if (pids.some((pid) => takenPlayers.has(pid))) continue;

      const b2b = pids.reduce((n, pid) => n + (lastWavePlayers.has(pid) ? 1 : 0), 0);
      const deg = pids.reduce((n, pid) => n + (perPlayerCount.get(pid) ?? 0), 0) - pids.length;

      const base = 10;
      const scoreMain = base - 6 * b2b + 1 * deg;

      const jitter = (hash32(`${attemptSalt}:${m.id}`) % 1024) / 1024 / 1000;
      const pref = preferredIndex ? preferredIndex.get(m.id) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;

      const better =
        scoreMain > bestScoreMain ||
        (scoreMain === bestScoreMain && pref < bestPref) ||
        (scoreMain === bestScoreMain && pref === bestPref && jitter < bestJitter) ||
        (scoreMain === bestScoreMain && pref === bestPref && jitter === bestJitter && m.id.localeCompare(bestId) < 0);

      if (better) {
        bestScoreMain = scoreMain;
        bestPref = pref;
        bestJitter = jitter;
        bestId = m.id;
        bestIdx = i;
      }
    }

    if (bestIdx < 0) break;
    const picked = rem.splice(bestIdx, 1)[0]!;
    out.push(picked);
    for (const pid of slotPlayerIds(picked)) takenPlayers.add(pid);
  }

  return out;
}

export function minWavesAvoidBackToBackOrder(matches: Match[], ctx: ReadyMatchOrderingContext): Match[] {
  const tableCount = Math.max(0, Math.floor(ctx.tableCount ?? 0));
  if (matches.length <= 1) return [...matches];
  if (tableCount <= 0) return [...matches];

  // Initial "just played" approximation in a pure wave model:
  // last N finished + all currently playing (in assignment order, but we only need players).
  const lastFinished = ctx.pastFinishedInOrder.slice(Math.max(0, ctx.pastFinishedInOrder.length - tableCount));
  const initialLastWavePlayers = new Set<PlayerId>();
  for (const m of lastFinished) {
    for (const pid of playersOccupiedByMatch(m)) initialLastWavePlayers.add(pid);
  }
  for (const m of ctx.inProgressInAssignmentOrder) {
    for (const pid of playersOccupiedByMatch(m)) initialLastWavePlayers.add(pid);
  }

  const allSlots = matches.map(slotOfMatch);
  const byId = new Map(matches.map((m) => [m.id, m] as const));
  const preferredIndex =
    ctx.preferredReadyOrderIds && ctx.preferredReadyOrderIds.length > 0
      ? new Map(ctx.preferredReadyOrderIds.map((id, i) => [id, i] as const))
      : null;

  type State = {
    remaining: InternalMatchSlot[];
    lastWavePlayers: Set<PlayerId>;
    wavesUsed: number;
    penalty: number;
    outIds: string[];
  };

  const beamWidth = 40;
  const attemptsPerWave = 12;

  let beam: State[] = [
    {
      remaining: allSlots,
      lastWavePlayers: initialLastWavePlayers,
      wavesUsed: 0,
      penalty: 0,
      outIds: [],
    },
  ];

  const bestPossibleWavesLowerBound = (n: number) => Math.ceil(n / tableCount);

  while (beam.length > 0) {
    // Finished schedules are terminal; pick best.
    const finished = beam.filter((s) => s.remaining.length === 0);
    if (finished.length > 0) {
      finished.sort((a, b) => {
        if (a.wavesUsed !== b.wavesUsed) return a.wavesUsed - b.wavesUsed;
        if (a.penalty !== b.penalty) return a.penalty - b.penalty;
        return a.outIds.join('\t').localeCompare(b.outIds.join('\t'));
      });
      const best = finished[0]!;
      return best.outIds.map((id) => byId.get(id)!).filter(Boolean);
    }

    const nextBeam: State[] = [];

    for (const s of beam) {
      if (s.remaining.length === 0) {
        nextBeam.push(s);
        continue;
      }

      // Generate multiple candidate wave packs to give beam search branching factor.
      for (let attempt = 0; attempt < attemptsPerWave; attempt++) {
        const wave = greedyWavePack(
          s.remaining,
          tableCount,
          s.lastWavePlayers,
          attempt + s.wavesUsed * 997,
          preferredIndex,
        );
        if (wave.length === 0) continue;

        const wavePlayers = new Set<PlayerId>();
        for (const m of wave) {
          for (const pid of slotPlayerIds(m)) wavePlayers.add(pid);
        }

        const wavePenalty = countBackToBackPlayers(wave, s.lastWavePlayers);

        const picked = new Set(wave.map((m) => m.id));
        const nextRemaining = s.remaining.filter((m) => !picked.has(m.id));

        nextBeam.push({
          remaining: nextRemaining,
          lastWavePlayers: wavePlayers,
          wavesUsed: s.wavesUsed + 1,
          penalty: s.penalty + wavePenalty,
          outIds: [...s.outIds, ...wave.map((m) => m.id)],
        });
      }
    }

    if (nextBeam.length === 0) {
      // Shouldn't happen with valid matches, but avoid infinite loops.
      return [...matches];
    }

    nextBeam.sort((a, b) => {
      const aBound = a.wavesUsed + bestPossibleWavesLowerBound(a.remaining.length);
      const bBound = b.wavesUsed + bestPossibleWavesLowerBound(b.remaining.length);
      if (aBound !== bBound) return aBound - bBound; // primary: minimize waves
      if (a.penalty !== b.penalty) return a.penalty - b.penalty; // secondary: minimize back-to-back
      if (preferredIndex) {
        // Warm-start tie-break: preserve the user's current visible order if all else is equal.
        const pa = a.outIds.reduce((acc, id, i) => acc + (preferredIndex.get(id) ?? 1e6) * (i + 1), 0);
        const pb = b.outIds.reduce((acc, id, i) => acc + (preferredIndex.get(id) ?? 1e6) * (i + 1), 0);
        if (pa !== pb) return pa - pb;
      }
      // deterministic final tie-break
      return a.outIds.join('\t').localeCompare(b.outIds.join('\t'));
    });

    // Deduplicate by remaining signature + last wave players to keep beam diverse but bounded.
    const seen = new Set<string>();
    beam = [];
    for (const cand of nextBeam) {
      const remSig = cand.remaining.map((m) => m.id).join(',');
      const lastSig = [...cand.lastWavePlayers].sort().join(',');
      const key = `${cand.wavesUsed}|${remSig}|${lastSig}`;
      if (seen.has(key)) continue;
      seen.add(key);
      beam.push(cand);
      if (beam.length >= beamWidth) break;
    }
  }

  return [...matches];
}
