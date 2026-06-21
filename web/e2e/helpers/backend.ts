import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { Command, Tournament } from '../../../src/index';
import {
  tournamentControllerFromCommandLog,
  singleEliminationPlacementRows,
  isDoublesTrack,
  getTrackPairs,
} from '../../../src/index';

export function countFinishedGroupMatches(tournament: Tournament): number {
  return Object.values(tournament.matches).filter(
    (m) => m.id.startsWith('gm-') && m.status === 'finished',
  ).length;
}

export async function expectDoublesTrack(page: Page, classId?: string): Promise<void> {
  const { tournament } = await readBackend(page);
  expect(isDoublesTrack(tournament, classId)).toBe(true);
  expect(Object.keys(getTrackPairs(tournament, classId)).length).toBeGreaterThan(0);
}

export async function expectNewGroupMatchFinished(
  page: Page,
  finishedBefore: number,
): Promise<void> {
  const { tournament } = await readBackend(page);
  expect(countFinishedGroupMatches(tournament)).toBe(finishedBefore + 1);
}

export async function readBackend(page: Page): Promise<{ tournament: Tournament; log: Command[] }> {
  return page.evaluate(() => {
    const b = window.__ttcTest;
    if (!b) throw new Error('Test bridge not installed');
    const tournament = b.getTournament();
    const log = b.getCommandLog();
    if (!tournament) throw new Error('No active tournament session');
    return { tournament, log };
  });
}

export async function exportJsonl(page: Page): Promise<string> {
  return page.evaluate(() => {
    const b = window.__ttcTest;
    if (!b) throw new Error('Test bridge not installed');
    return b.exportJsonl();
  });
}

export async function expectReplayRoundTrip(page: Page): Promise<void> {
  const jsonl = await exportJsonl(page);
  expect(jsonl.length).toBeGreaterThan(0);
  const { controller, replay } = tournamentControllerFromCommandLog(jsonl);
  expect(replay.success).toBe(true);
  const live = await readBackend(page);
  expect(controller.getTournament()).toEqual(live.tournament);
}

export async function expectLogContains(page: Page, type: Command['type']): Promise<void> {
  const { log } = await readBackend(page);
  expect(log.some((c) => c.type === type)).toBe(true);
}

export async function expectLogEndsWith(page: Page, type: Command['type'], count = 1): Promise<void> {
  const { log } = await readBackend(page);
  const tail = log.slice(-count);
  expect(tail.every((c) => c.type === type)).toBe(true);
}

export async function expectMatchStatus(
  page: Page,
  matchId: string,
  status: 'scheduled' | 'finished',
): Promise<void> {
  const { tournament } = await readBackend(page);
  expect(tournament.matches[matchId]?.status).toBe(status);
}

export async function expectBracketPlacements(
  page: Page,
  expected: Array<{ place: number; playerId: string }>,
  classId?: string,
): Promise<void> {
  const { tournament } = await readBackend(page);
  const rows = singleEliminationPlacementRows(
    classId ? tournament.classTournaments[classId]?.bracketMatches ?? [] : tournament.bracketMatches,
    tournament,
    classId,
  );
  expect(rows?.slice(0, expected.length)).toEqual(expected);
}

export async function snapshotClassBracket(
  page: Page,
  classId: string,
): Promise<string> {
  const { tournament } = await readBackend(page);
  const slice = tournament.classTournaments[classId];
  return JSON.stringify(slice?.bracketMatches ?? []);
}

export async function canRedo(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__ttcTest?.canRedo() ?? false);
}
