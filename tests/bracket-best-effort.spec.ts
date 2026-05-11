import { describe, it, expect } from 'vitest';
import {
  bestEffortOrderParticipantsForGroupBracket,
  createTournament,
  generateBracket,
  nextPowerOfTwo,
  orderParticipantsForGroupBalancedBracket,
  shuffleDeterministic,
  type BracketSeedingMode,
} from '../src/model';

/** Mirrors {@link generateBracket} participant resolution (fillByes path, no cull/forfeits). */
function expectedR1MatchCountAfterSeeding(
  t: ReturnType<typeof createTournament>,
  participantIds: string[],
  shuffleKey: string,
  classId: string | undefined,
  mode: BracketSeedingMode = 'extend_closed_form',
): number {
  let participants = [...participantIds];
  const beKey = shuffleKey.trim() || 'Tournament';
  if (mode === 'closed_form') {
    const o = orderParticipantsForGroupBalancedBracket(t, participants, classId, 'exact');
    if (!o) throw new Error('expectedR1MatchCountAfterSeeding: closed_form not applicable');
    participants = o;
  } else if (mode === 'extend_closed_form') {
    const o = orderParticipantsForGroupBalancedBracket(t, participants, classId, 'virtual');
    if (!o) throw new Error('expectedR1MatchCountAfterSeeding: extend_closed_form not applicable');
    participants = o;
  } else {
    const best = bestEffortOrderParticipantsForGroupBracket(t, participants, classId, beKey);
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

describe('bestEffortOrderParticipantsForGroupBracket', () => {
  it('returns null when participants are not exactly the union of group members', () => {
    const t = createTournament();
    t.players.p1 = { id: 'p1', name: 'A', handicap: 0 };
    t.players.p2 = { id: 'p2', name: 'B', handicap: 0 };
    addGroupRRDominant(t, 'g1', ['p1', 'p2']);
    const r = bestEffortOrderParticipantsForGroupBracket(t, ['p1'], undefined, 'k');
    expect(r).toBeNull();
  });

  it('is deterministic for the same shuffleKey', () => {
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
    expect(a!.length).toBe(nextPowerOfTwo(27));
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
      const nonBye = r!.filter((x) => x !== 'BYE');
      expect(nonBye.length).toBe(all.length);
      expect(new Set(nonBye).size).toBe(all.length);
      for (const id of all) {
        expect(nonBye.includes(id)).toBe(true);
      }
      const bm = generateBracket([...all], t, {
        fillByes: true,
        shuffleKey: key,
        bracketSeedingMode: 'extend_closed_form',
      });
      expect(bm.length).toBe(expectedR1MatchCountAfterSeeding(t, all, key, undefined));
    }
  });

  it('generateBracket uses best-effort when ideal layout is unavailable (e.g. 9 groups)', () => {
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
    expect(orderParticipantsForGroupBalancedBracket(t, seed, undefined)).toBeNull();
    const be = bestEffortOrderParticipantsForGroupBracket(t, seed, undefined, 'Cup');
    expect(be).not.toBeNull();
    const bracket = generateBracket([...seed], t, { fillByes: true, shuffleKey: 'Cup', bracketSeedingMode: 'heuristic' });
    expect(bracket.length).toBe(16);
  });
});
