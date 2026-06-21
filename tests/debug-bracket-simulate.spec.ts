import { describe, it, expect } from 'vitest';
import { CommandRunner } from '../src/command';
import {
  bracketPlayerMatchId,
  matchPlayersResolvedForBracketPhaseList,
  partitionPlayerCountIntoGroupSizes,
  ensureBracketPhasePlayerMatchesIn,
  isTrackParticipantId,
  bracketMatchRound,
  bracketSlotAwaitingPlay,
} from '../src/model';
import { TournamentController } from '../src/controller';

const BO5_A = [
  { playerA: 11, playerB: 9 },
  { playerA: 11, playerB: 6 },
  { playerA: 11, playerB: 5 },
];

function setup21Player5GroupHeuristicBracket() {
  const runner = new CommandRunner();
  const ts = '2026-06-06T12:00:00.000Z';
  const exec = (cmd: Parameters<CommandRunner['execute']>[0]) => runner.execute({ ...cmd, timestamp: ts });

  const pids = Array.from({ length: 21 }, (_, i) => `p${i + 1}`);
  for (const id of pids) {
    exec({
      id: `cp-${id}`,
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId: id, name: id, handicap: 0 },
    });
  }
  exec({ id: 'seed', type: 'SetSeedings', dependsOn: pids.map((id) => `cp-${id}`), payload: { playerIds: pids } });
  expect(partitionPlayerCountIntoGroupSizes(21, 4)).toEqual([5, 4, 4, 4, 4]);
  exec({
    id: 'sg',
    type: 'SetGroups',
    dependsOn: ['seed'],
    payload: { targetGroupSize: 4, playerIds: pids },
  });

  const groupMatches = Object.keys(runner.getTournament().matches)
    .filter((k) => k.startsWith('gm-'))
    .sort();
  let deps: string[] = ['sg', 'seed'];
  for (let i = 0; i < groupMatches.length; i++) {
    exec({
      id: `gs${i}`,
      type: 'EnterScore',
      dependsOn: ['sg'],
      payload: { matchId: groupMatches[i]!, scores: BO5_A },
    });
    deps.push(`gs${i}`);
  }

  exec({
    id: 'gen',
    type: 'GenerateBracket',
    dependsOn: deps,
    payload: {
      fillByes: true,
      cullToPowerOfTwo: false,
      bracketSeedingMode: 'heuristic',
      tieBreakSalt: 'test-salt',
    },
  });

  return runner;
}

function bracketSimulateEligibleCount(t: ReturnType<CommandRunner['getTournament']>): number {
  let n = 0;
  for (const bm of t.bracketMatches) {
    if (!bm.seedA || !bm.seedB) continue;
    const mid = bracketPlayerMatchId(bm.id);
    const m = t.matches[mid];
    if (!m || m.groupId) continue;
    if (m.status !== 'scheduled' && m.status !== 'in-progress') continue;
    if (m.scores.length > 0) continue;
    if (!matchPlayersResolvedForBracketPhaseList(t, m, undefined)) continue;
    n++;
  }
  return n;
}

describe('Debug simulate bracket phase (21 players, 5 groups, heuristic)', () => {
  it('has round-1 pairings with both seeds after heuristic bracket generation', () => {
    const runner = setup21Player5GroupHeuristicBracket();
    const t = runner.getTournament();
    const r1Both = t.bracketMatches.filter((bm) => bm.round === 1 && bm.seedA && bm.seedB);
    expect(r1Both.length).toBeGreaterThan(0);
  });

  it('ensureBracketPhasePlayerMatchesIn creates rows so debug simulate can score round 1', () => {
    const runner = setup21Player5GroupHeuristicBracket();
    const t = runner.getTournament();
    ensureBracketPhasePlayerMatchesIn(t, t.bracketMatches);
    expect(bracketSimulateEligibleCount(t)).toBeGreaterThan(0);
  });

  it('all round-1 seeds are valid track participants', () => {
    const runner = setup21Player5GroupHeuristicBracket();
    const t = runner.getTournament();
    const r1 = t.bracketMatches.filter((bm) => bracketMatchRound(bm) === 1 && bm.seedA && bm.seedB);
    for (const bm of r1) {
      expect(isTrackParticipantId(t, bm.seedA!, undefined)).toBe(true);
      expect(isTrackParticipantId(t, bm.seedB!, undefined)).toBe(true);
      expect(bracketSlotAwaitingPlay(t, bm, undefined)).toBe(true);
    }
  });

  it('GenerateBracket creates round-1 player rows for singles (debug simulate / ready to play)', () => {
    const runner = setup21Player5GroupHeuristicBracket();
    const t = runner.getTournament();
    const r1Both = t.bracketMatches.filter((bm) => bm.round === 1 && bm.seedA && bm.seedB);
    expect(r1Both.length).toBe(5);
    expect(bracketSimulateEligibleCount(t)).toBe(5);
  });

  it('enterScore works on GenerateBracket rows without a separate CreateMatch command', () => {
    const runner = setup21Player5GroupHeuristicBracket();
    const c = new TournamentController(runner);
    const bm = c.getTournament().bracketMatches.find((x) => x.round === 1 && x.seedA && x.seedB)!;
    const mid = bracketPlayerMatchId(bm.id);
    expect(c.findLatestActiveCreateMatchCommandId(mid)).toBeUndefined();
    const r = c.enterScore(mid, BO5_A, [], `dbg-sc-${bm.id}`);
    expect(r).toEqual({ success: true });
  });

  it('debug simulate scores every round-1 pairing (same deps as App debug button)', () => {
    const runner = setup21Player5GroupHeuristicBracket();
    const c = new TournamentController(runner);
    const r1 = c.getTournament().bracketMatches.filter((bm) => bm.round === 1 && bm.seedA && bm.seedB);
    expect(bracketSimulateEligibleCount(c.getTournament())).toBe(r1.length);

    let done = 0;
    for (const bm of r1) {
      const mid = bracketPlayerMatchId(bm.id);
      const createCmdId = c.findLatestActiveCreateMatchCommandId(mid);
      const r = c.enterScore(mid, BO5_A, createCmdId ? [createCmdId] : [], `dbg-sc-${bm.id}`);
      expect(r).toEqual({ success: true });
      done++;
    }
    expect(done).toBe(r1.length);
  });

  it('debug simulate still works when match rows come from reconcile after a prior score', () => {
    const runner = setup21Player5GroupHeuristicBracket();
    const c = new TournamentController(runner);
    const t = c.getTournament();
    const r1 = t.bracketMatches.filter((bm) => bm.round === 1 && bm.seedA && bm.seedB && !bm.winner);
    for (const bm of r1) {
      const mid = bracketPlayerMatchId(bm.id);
      if (c.getTournament().matches[mid]) continue;
      c.createMatch(mid, bm.seedA!, bm.seedB!, ['gen', `cp-${bm.seedA}`, `cp-${bm.seedB}`], `gen-pair-${bm.id}`);
    }

    const bm = r1[0]!;
    const mid = bracketPlayerMatchId(bm.id);
    const createCmdId = c.findLatestActiveCreateMatchCommandId(mid);
    const r = c.enterScore(mid, BO5_A, createCmdId ? [createCmdId] : [], `dbg-sc-${bm.id}`);
    expect(r).toEqual({ success: true });

    const t2 = c.getTournament();
    const r2Ready = t2.bracketMatches.filter(
      (x) => x.round === 2 && x.seedA && x.seedB && !x.winner && t2.matches[bracketPlayerMatchId(x.id)],
    );
    expect(r2Ready.length).toBeGreaterThan(0);
    const bm2 = r2Ready[0]!;
    const mid2 = bracketPlayerMatchId(bm2.id);
    const createCmdId2 = c.findLatestActiveCreateMatchCommandId(mid2);
    const r2 = c.enterScore(mid2, BO5_A, createCmdId2 ? [createCmdId2] : [], `dbg-sc-${bm2.id}`);
    expect(r2).toEqual({ success: true });
  });
});
