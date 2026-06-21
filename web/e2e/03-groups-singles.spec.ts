import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { debugFillPlayers } from './helpers/players';
import { createGroupsByPlayerCount, clearGroups, openFirstGroupCell, debugSimulateGroup } from './helpers/groups';
import {
  fillBo5WinnerA,
  saveScoreModal,
  fillGameScores,
  expectScoreModalOpen,
} from './helpers/scores';
import { expectReplayRoundTrip, readBackend, expectMatchStatus } from './helpers/backend';

test.describe('03 groups singles', () => {
  test.beforeEach(async ({ page }) => {
    await createMinimalTournament(page);
    await debugFillPlayers(page, 8);
  });

  test('creates groups by player count', async ({ page }) => {
    await createGroupsByPlayerCount(page, 4);
    const { tournament } = await readBackend(page);
    expect(Object.keys(tournament.groups).length).toBeGreaterThan(0);
    const groupMatches = Object.keys(tournament.matches).filter((k) => k.startsWith('gm-'));
    expect(groupMatches.length).toBe(12);
    await expectReplayRoundTrip(page);
  });

  test('scores group match via modal with real input', async ({ page }) => {
    await createGroupsByPlayerCount(page, 4);
    await openFirstGroupCell(page);
    await expectScoreModalOpen(page);
    await fillBo5WinnerA(page);
    await saveScoreModal(page);
    const { tournament } = await readBackend(page);
    const finished = Object.values(tournament.matches).filter((m) => m.status === 'finished');
    expect(finished.length).toBe(1);
    await expectReplayRoundTrip(page);
  });

  test('completes all group matches with hybrid debug simulate', async ({ page }) => {
    await createGroupsByPlayerCount(page, 4);
    await openFirstGroupCell(page);
    await fillBo5WinnerA(page);
    await saveScoreModal(page);
    while (true) {
      const { tournament } = await readBackend(page);
      const pending = Object.values(tournament.matches).filter(
        (m) => m.id.startsWith('gm-') && m.status !== 'finished',
      );
      if (pending.length === 0) break;
      await debugSimulateGroup(page);
    }
    const { tournament } = await readBackend(page);
    const groupMatches = Object.values(tournament.matches).filter((m) => m.id.startsWith('gm-'));
    expect(groupMatches.every((m) => m.status === 'finished')).toBe(true);
    await expectReplayRoundTrip(page);
  });

  test('clears groups before knockout', async ({ page }) => {
    await createGroupsByPlayerCount(page, 4);
    await clearGroups(page);
    const { tournament } = await readBackend(page);
    expect(Object.keys(tournament.groups).length).toBe(0);
  });

  test('blocks illegal score 11-10', async ({ page }) => {
    await createGroupsByPlayerCount(page, 4);
    await openFirstGroupCell(page);
    await fillGameScores(page, [[11, 10]]);
    await page.getByTestId('score-save').click();
    await expectScoreModalOpen(page);
    const { log } = await readBackend(page);
    expect(log.some((c) => c.type === 'EnterScore')).toBe(false);
  });
});
