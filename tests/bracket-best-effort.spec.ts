import { describe, it, expect } from 'vitest';
import {
  bestEffortOrderParticipantsForGroupBracket,
  searchBestHeuristicBracketOrder,
  postprocessBracketLeafByeRankSwaps,
  bracketPartitionTreeTotalPenalty,
  buildBracketPartitionTree,
  applyLeafPlayersToEqualizedPartitionTree,
  bracketPartitionEntryByPid,
  collectBracketPartitionTerminals,
  equalizeBracketPartitionTreeDepths,
  flattenBracketPartitionTreeToLeafOrder,
  maxBracketPartitionTerminalDepth,
  bipartitionBracketPlayers,
  bracketMatchRound,
  buildBracketLeafOrderByBipartition,
  createTournament,
  currentGroupPlace1Based,
  findGroupForPlayer,
  generateBracket,
  inferBracketSlotCountFromRoundOne,
  nextPowerOfTwo,
  orderParticipantsForGroupBalancedBracket,
  shuffleDeterministic,
  type BracketMatch,
  type BracketSeedingMode,
} from '../src/model';

/** Mirrors {@link generateBracket} participant resolution (fillByes path, no cull/forfeits). */
function expectedR1MatchCountAfterSeeding(
  t: ReturnType<typeof createTournament>,
  participantIds: string[],
  shuffleKey: string,
  classId: string | undefined,
  mode: BracketSeedingMode | 'extend_closed_form' = 'heuristic',
  tieBreakSalt = 'test-salt',
): number {
  let participants = [...participantIds];
  const beKey = shuffleKey.trim() || 'Tournament';
  if (mode === 'closed_form') {
    const o = orderParticipantsForGroupBalancedBracket(t, participants, classId, 'exact');
    if (!o) throw new Error('expectedR1MatchCountAfterSeeding: closed_form not applicable');
    participants = o;
  } else if (mode === 'extend_closed_form') {
    const o = orderParticipantsForGroupBalancedBracket(t, participants, classId, 'virtual');
    if (!o) throw new Error('expectedR1MatchCountAfterSeeding: legacy extend_closed_form not applicable');
    participants = o;
  } else {
    const best = bestEffortOrderParticipantsForGroupBracket(t, participants, classId, tieBreakSalt);
    if (best) {
      participants = best;
    } else if (participants.length > 1) {
      participants = shuffleDeterministic(participants, beKey);
    }
  }
  const slotCount = nextPowerOfTwo(participants.length);
  while (participants.length < slotCount) participants.push('BYE');
  return participants.length / 2;
}

function addGroupRRDominant(t: ReturnType<typeof createTournament>, gid: string, pids: readonly string[]): void {
  const ids = [...pids];
  t.groups[gid] = { id: gid, playerIds: ids };
  const dom = ids[0]!;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]!;
      const b = ids[j]!;
      const mid = `m-${gid}-${a}-${b}`;
      const winner = a === dom || b === dom ? dom : a.localeCompare(b) < 0 ? a : b;
      t.matches[mid] = {
        id: mid,
        playerA: a,
        playerB: b,
        scores: [],
        status: 'finished',
        winner,
        groupId: gid,
      };
    }
  }
}

type PartitionEntry = { pid: string; groupIndex: number; place: number };

/** Players with a round-1 walkover (one real seed, other side empty / BYE). */
function round1WalkoverPlayerIds(bracket: BracketMatch[]): string[] {
  const out: string[] = [];
  for (const m of bracket) {
    if (bracketMatchRound(m) !== 1) continue;
    const hasA = Boolean(m.seedA);
    const hasB = Boolean(m.seedB);
    if (hasA === hasB) continue;
    out.push((hasA ? m.seedA : m.seedB)!);
  }
  return out;
}

function inGroupPlaceByPlayer(
  t: ReturnType<typeof createTournament>,
  playerIds: readonly string[],
  classId: string | undefined,
): Map<string, number> {
  const places = new Map<string, number>();
  for (const pid of playerIds) {
    const g = findGroupForPlayer(t, pid, classId);
    if (!g) throw new Error(`no group for ${pid}`);
    places.set(pid, currentGroupPlace1Based(t, g, pid, classId));
  }
  return places;
}

/**
 * If any player at in-group place `p` has an R1 bye, every player at every place `< p` must also have one.
 * Later bracket rounds must not contain one-sided (bye) slots.
 */
function expectByesOnlyForTopRanksAndRound1(
  bracket: BracketMatch[],
  places: Map<string, number>,
  allPlayerIds: readonly string[],
): void {
  const byeSet = new Set(round1WalkoverPlayerIds(bracket));

  for (const pid of byeSet) {
    const place = places.get(pid)!;
    for (const other of allPlayerIds) {
      const otherPlace = places.get(other)!;
      if (otherPlace < place) {
        expect(byeSet.has(other)).toBe(true);
      }
    }
  }

  for (const m of bracket) {
    const r = bracketMatchRound(m);
    if (r <= 1) continue;
    const hasA = Boolean(m.seedA);
    const hasB = Boolean(m.seedB);
    expect(hasA && hasB).toBe(true);
  }
}

function terminalDepthSpread(terminals: ReturnType<typeof collectBracketPartitionTerminals>): number {
  if (terminals.length === 0) return 0;
  const depths = terminals.map((t) => t.depth);
  return Math.max(...depths) - Math.min(...depths);
}

function buildSevenGroupsOfThree(t: ReturnType<typeof createTournament>): string[] {
  const seed: string[] = [];
  for (let g = 0; g < 7; g++) {
    const pids = [`p${g * 3 + 1}`, `p${g * 3 + 2}`, `p${g * 3 + 3}`];
    for (const id of pids) {
      t.players[id] = { id, name: id, handicap: 0 };
      seed.push(id);
    }
    addGroupRRDominant(t, `g${g}`, pids);
  }
  return seed;
}

describe('bipartition bracket leaf order', () => {
  it('pre-BYE terminal partition depths differ by at most one (bipartition invariant)', () => {
    const cases: PartitionEntry[][] = [
      Array.from({ length: 21 }, (_, i) => ({
        pid: `p${i + 1}`,
        groupIndex: i % 7,
        place: (i % 3) + 1,
      })),
      [
        { pid: 'p1', groupIndex: 0, place: 1 },
        { pid: 'p2', groupIndex: 0, place: 2 },
        { pid: 'p3', groupIndex: 0, place: 3 },
      ],
      Array.from({ length: 27 }, (_, i) => ({
        pid: `p${i + 1}`,
        groupIndex: i % 9,
        place: (i % 3) + 1,
      })),
    ];
    for (const entries of cases) {
      const tree = buildBracketPartitionTree(entries).tree;
      const terminals = collectBracketPartitionTerminals(tree);
      expect(terminalDepthSpread(terminals)).toBeLessThanOrEqual(1);
    }
  });

  it('splits shallow 2-player terminals before BYEs so only max-depth leaves stay paired', () => {
    const entries: PartitionEntry[] = Array.from({ length: 21 }, (_, i) => ({
      pid: `p${i + 1}`,
      groupIndex: i % 7,
      place: (i % 3) + 1,
    }));
    const tree = buildBracketPartitionTree(entries).tree;
    const maxDepth = maxBracketPartitionTerminalDepth(collectBracketPartitionTerminals(tree));
    const equalized = equalizeBracketPartitionTreeDepths(tree, 0, maxDepth);
    const after = collectBracketPartitionTerminals(equalized);
    const maxAfter = maxBracketPartitionTerminalDepth(after);
    for (const term of after) {
      if (term.entries.length === 2) {
        expect(term.depth).toBe(maxAfter);
      }
    }
    const leafOrder = buildBracketLeafOrderByBipartition(entries).leaves;
    expect(leafOrder.length).toBe(32);
  });

  it('alternating subset picks keep sizes equal or one apart (21 → 11|10)', () => {
    const entries: PartitionEntry[] = Array.from({ length: 21 }, (_, i) => ({
      pid: `p${i + 1}`,
      groupIndex: i % 7,
      place: (i % 3) + 1,
    }));
    const { left, right } = bipartitionBracketPlayers(entries);
    expect(left.length).toBe(11);
    expect(right.length).toBe(10);
    expect(Math.abs(left.length - right.length)).toBeLessThanOrEqual(1);
  });

  it('bipartitions 3 players as best alone vs the other two', () => {
    const entries: PartitionEntry[] = [
      { pid: 'p3', groupIndex: 0, place: 3 },
      { pid: 'p1', groupIndex: 0, place: 1 },
      { pid: 'p2', groupIndex: 0, place: 2 },
    ];
    const { left, right } = bipartitionBracketPlayers(entries);
    expect(left.map((e) => e.pid)).toEqual(['p1']);
    expect(right.map((e) => e.pid).sort()).toEqual(['p2', 'p3']);
  });

  it('adds BYE only at terminal one-player partitions (3 → 4 leaves, one BYE)', () => {
    const entries: PartitionEntry[] = [
      { pid: 'p1', groupIndex: 0, place: 1 },
      { pid: 'p2', groupIndex: 0, place: 2 },
      { pid: 'p3', groupIndex: 0, place: 3 },
    ];
    const leafOrder = buildBracketLeafOrderByBipartition(entries).leaves;
    expect(leafOrder).toHaveLength(4);
    expect(leafOrder.filter((x) => x === 'BYE')).toEqual(['BYE']);
    expect(new Set(leafOrder.filter((x) => x !== 'BYE'))).toEqual(new Set(['p1', 'p2', 'p3']));
  });

  it('splits 4 players into cross-group R1 pairings at the leaves', () => {
    const entries = [
      { pid: 'a1', groupIndex: 0, place: 1 },
      { pid: 'a2', groupIndex: 0, place: 2 },
      { pid: 'b1', groupIndex: 1, place: 1 },
      { pid: 'b2', groupIndex: 1, place: 2 },
    ];
    const { left, right } = bipartitionBracketPlayers(entries);
    expect(left.map((e) => e.pid).sort()).toEqual(['a1', 'b2']);
    expect(right.map((e) => e.pid).sort()).toEqual(['a2', 'b1']);
    expect(buildBracketLeafOrderByBipartition(entries).leaves).toEqual(['a1', 'b2', 'b1', 'a2']);
  });

  it('4-player bipartition with tied ranks prefers both pairs cross-group', () => {
    const entries = [
      { pid: 'x2', groupIndex: 0, place: 1 },
      { pid: 'y1', groupIndex: 1, place: 1 },
      { pid: 'x1', groupIndex: 0, place: 2 },
      { pid: 'y2', groupIndex: 1, place: 2 },
    ];
    const { left, right } = bipartitionBracketPlayers(entries);
    expect(left.map((e) => e.pid).sort()).toEqual(['x2', 'y2']);
    expect(right.map((e) => e.pid).sort()).toEqual(['x1', 'y1']);
    expect(left[0]!.groupIndex).not.toBe(left[1]!.groupIndex);
    expect(right[0]!.groupIndex).not.toBe(right[1]!.groupIndex);
  });

  it('only gives round-1 byes to top in-group ranks, tiered', () => {
    const t = createTournament();
    const seed = buildSevenGroupsOfThree(t);
    const places = inGroupPlaceByPlayer(t, seed, undefined);
    const bracket = generateBracket([...seed], t, {
      fillByes: true,
      shuffleKey: 'Cup-21',
      tieBreakSalt: 'Cup-21',
      bracketSeedingMode: 'heuristic',
    });
    expect(bracket.length).toBe(16);
    expect(inferBracketSlotCountFromRoundOne(bracket)).toBe(32);
    expectByesOnlyForTopRanksAndRound1(bracket, places, seed);
  });
});

describe('postprocessBracketLeafByeRankSwaps', () => {
  it('swaps a bye holder with a better-ranked forced round-1 player until stable', () => {
    const placeByPid = new Map([
      ['p1', 1],
      ['p2', 2],
      ['p3', 3],
    ]);
    const leaves = ['p3', 'BYE', 'p1', 'p2', 'BYE', 'BYE', 'BYE', 'BYE'];
    const out = postprocessBracketLeafByeRankSwaps(leaves, placeByPid);
    expect(out[0]).toBe('p1');
    expect(out[1]).toBe('BYE');
    expect(out[2]).toBe('p3');
    expect(out[3]).toBe('p2');
  });

  it('partition-tree penalty reflects final leaf assignment (e.g. who holds the bye)', () => {
    const entries = [
      { pid: 'p1', groupIndex: 0, place: 1 },
      { pid: 'p2', groupIndex: 0, place: 2 },
      { pid: 'p3', groupIndex: 0, place: 3 },
    ];
    const built = buildBracketPartitionTree(entries);
    const terminals = collectBracketPartitionTerminals(built.tree);
    const maxDepth = maxBracketPartitionTerminalDepth(terminals);
    const equalized = equalizeBracketPartitionTreeDepths(built.tree, 0, maxDepth);
    const entryByPid = bracketPartitionEntryByPid(entries);
    const treeP3Bye = applyLeafPlayersToEqualizedPartitionTree(
      equalized,
      ['p3', 'BYE', 'p1', 'p2'],
      entryByPid,
    );
    const treeP1Bye = applyLeafPlayersToEqualizedPartitionTree(
      equalized,
      ['p1', 'BYE', 'p3', 'p2'],
      entryByPid,
    );
    expect(bracketPartitionTreeTotalPenalty(treeP1Bye, entries)).not.toBe(
      bracketPartitionTreeTotalPenalty(treeP3Bye, entries),
    );
  });

  it('does not swap when every round-1 player is at least as strong as every bye holder', () => {
    const placeByPid = new Map([
      ['p1', 1],
      ['p2', 2],
      ['p3', 3],
    ]);
    const leaves = ['p1', 'BYE', 'p2', 'p3'];
    expect(postprocessBracketLeafByeRankSwaps(leaves, placeByPid)).toEqual(leaves);
  });
});

describe('bestEffortOrderParticipantsForGroupBracket', () => {
  it('returns null when participants are not exactly the union of group members', () => {
    const t = createTournament();
    t.players.p1 = { id: 'p1', name: 'A', handicap: 0 };
    t.players.p2 = { id: 'p2', name: 'B', handicap: 0 };
    addGroupRRDominant(t, 'g1', ['p1', 'p2']);
    const r = bestEffortOrderParticipantsForGroupBracket(t, ['p1'], undefined, 'k');
    expect(r).toBeNull();
  });

  it('searchBestHeuristicBracketOrder picks the lowest penalty among trials', () => {
    const t = createTournament();
    for (let i = 1; i <= 12; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: id, handicap: 0 };
    }
    for (let g = 0; g < 4; g++) {
      const base = g * 3 + 1;
      addGroupRRDominant(t, `g${g}`, [`p${base}`, `p${base + 1}`, `p${base + 2}`]);
    }
    const seed = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);
    const result = searchBestHeuristicBracketOrder(t, seed, undefined, 'bench', 8);
    expect(result).not.toBeNull();
    expect(result!.runs).toBe(8);
    expect(result!.trialPenalties).toHaveLength(8);
    expect(result!.totalPenalty).toBe(Math.min(...result!.trialPenalties));
    expect(result!.tieBreakSalt).toMatch(/^bench:trial:\d+$/);
    expect(result!.order.filter((x) => x !== 'BYE').length).toBe(12);
  });

  it('is deterministic for the same tieBreakSalt', () => {
    const t = createTournament();
    for (let i = 1; i <= 27; i++) {
      const id = `p${i}`;
      t.players[id] = { id, name: id, handicap: 0 };
    }
    for (let g = 0; g < 9; g++) {
      const base = g * 3 + 1;
      addGroupRRDominant(t, `g${g}`, [`p${base}`, `p${base + 1}`, `p${base + 2}`]);
    }
    const seed = Array.from({ length: 27 }, (_, i) => `p${i + 1}`);
    const a = bestEffortOrderParticipantsForGroupBracket(t, seed, undefined, 'MyKey');
    const b = bestEffortOrderParticipantsForGroupBracket(t, seed, undefined, 'MyKey');
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
    expect(a!.filter((x) => x !== 'BYE').length).toBe(27);
    expect(new Set(a!.filter((x) => x !== 'BYE'))).toEqual(new Set(seed));
  });

  it('random stress: always finite, correct length, bijection onto seed players', () => {
    for (let trial = 0; trial < 400; trial++) {
      const t = createTournament();
      const G = 1 + Math.floor(Math.random() * 12);
      let pidCounter = 1;
      const all: string[] = [];
      for (let g = 0; g < G; g++) {
        const sz = 2 + Math.floor(Math.random() * 5);
        const pids: string[] = [];
        for (let k = 0; k < sz; k++) {
          const id = `p${pidCounter++}`;
          pids.push(id);
          all.push(id);
          t.players[id] = { id, name: id, handicap: 0 };
        }
        addGroupRRDominant(t, `gg${g}`, pids);
      }
      const key = `stress-${trial}`;
      const r = bestEffortOrderParticipantsForGroupBracket(t, all, undefined, key);
      expect(r).not.toBeNull();
      expect(r!.length % 2).toBe(0);
      expect(r!.length).toBe(nextPowerOfTwo(r!.length));
      const nonBye = r!.filter((x) => x !== 'BYE');
      expect(nonBye.length).toBe(all.length);
      expect(new Set(nonBye).size).toBe(all.length);
      for (const id of all) {
        expect(nonBye.includes(id)).toBe(true);
      }
      const bm = generateBracket([...all], t, {
        fillByes: true,
        shuffleKey: key,
        bracketSeedingMode: 'heuristic',
      });
      expect(bm.length).toBe(expectedR1MatchCountAfterSeeding(t, all, key, undefined));
    }
  });
});
