import type { Match, PlayerId } from './model';

/**
 * Pluggable ready-match ordering algorithm.
 *
 * For now we only expose the original group-completion-staggered ordering (no ad-hoc swap optimizer).
 * Keep this type and public function surface stable so new algorithms can be introduced later.
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

/**
 * Order ready group matches so groups stay in step: repeatedly pick a match from the group whose
 * simulated completion ratio is lowest, assuming each previously chosen match is already done.
 */
export function groupCompletionStaggeredOrder(
  matches: Match[],
  groupProgress: (m: Match) => GroupProgressSnapshot,
): Match[] {
  if (matches.length <= 1) return [...matches];
  const rem = [...matches];
  const totals = new Map<string, GroupProgressSnapshot>();
  for (const m of matches) {
    const k = groupReadyStaggerKey(m);
    if (!totals.has(k)) {
      totals.set(k, { ...groupProgress(m) });
    }
  }
  const out: Match[] = [];
  while (rem.length > 0) {
    let bestIdx = 0;
    let bestRatio = Infinity;
    let bestId = '\uffff';
    for (let i = 0; i < rem.length; i++) {
      const m = rem[i]!;
      const rec = totals.get(groupReadyStaggerKey(m))!;
      const ratio = rec.total <= 0 ? 0 : rec.done / rec.total;
      const id = m.id;
      if (ratio < bestRatio || (ratio === bestRatio && id.localeCompare(bestId) < 0)) {
        bestRatio = ratio;
        bestId = id;
        bestIdx = i;
      }
    }
    const picked = rem.splice(bestIdx, 1)[0]!;
    out.push(picked);
    totals.get(groupReadyStaggerKey(picked))!.done += 1;
  }
  return out;
}

export type ScheduleMatchSlot = {
  playerA: PlayerId;
  playerB: PlayerId;
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
      waveBusy.add(slot.playerA);
      waveBusy.add(slot.playerB);
      assigned++;
    }

    if (assigned === 0) break;
    remaining = nextRemaining;
  }

  return waves;
}

type InternalMatchSlot = ScheduleMatchSlot & { id: string };

function slotOfMatch(m: Match): InternalMatchSlot {
  return { id: m.id, playerA: m.playerA, playerB: m.playerB };
}

function matchUsesPlayer(m: ScheduleMatchSlot, p: PlayerId): boolean {
  return m.playerA === p || m.playerB === p;
}

function countBackToBackPlayers(
  waveSlots: ScheduleMatchSlot[],
  lastWavePlayers: Set<PlayerId>,
): number {
  let c = 0;
  for (const s of waveSlots) {
    if (lastWavePlayers.has(s.playerA)) c++;
    if (lastWavePlayers.has(s.playerB)) c++;
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
    perPlayerCount.set(m.playerA, (perPlayerCount.get(m.playerA) ?? 0) + 1);
    perPlayerCount.set(m.playerB, (perPlayerCount.get(m.playerB) ?? 0) + 1);
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
      if (takenPlayers.has(m.playerA) || takenPlayers.has(m.playerB)) continue;

      const b2b = (lastWavePlayers.has(m.playerA) ? 1 : 0) + (lastWavePlayers.has(m.playerB) ? 1 : 0);
      const deg =
        (perPlayerCount.get(m.playerA) ?? 0) + (perPlayerCount.get(m.playerB) ?? 0) - 2; // subtract self

      // Weights chosen to be easy to reason about:
      // - prioritize filling tables (wave count is lexicographic primary)
      // - then avoid back-to-back
      // - then pick constrained matches earlier (higher conflict degree first)
      const base = 10;
      const scoreMain = base - 6 * b2b + 1 * deg;

      // Deterministic micro-jitter so multiple attempts explore slightly different but stable paths.
      const jitter = (hash32(`${attemptSalt}:${m.id}`) % 1024) / 1024 / 1000;
      const pref = preferredIndex ? preferredIndex.get(m.id) ?? Number.POSITIVE_INFINITY : Number.POSITIVE_INFINITY;

      // Warm-start is a tie-break only: it should never outweigh the main scoring terms.
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
    takenPlayers.add(picked.playerA);
    takenPlayers.add(picked.playerB);
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
    initialLastWavePlayers.add(m.playerA);
    initialLastWavePlayers.add(m.playerB);
  }
  for (const m of ctx.inProgressInAssignmentOrder) {
    initialLastWavePlayers.add(m.playerA);
    initialLastWavePlayers.add(m.playerB);
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
          wavePlayers.add(m.playerA);
          wavePlayers.add(m.playerB);
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
