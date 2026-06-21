import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { debugFillPlayers } from './helpers/players';
import { createGroupsByPlayerCount } from './helpers/groups';
import { openFirstGroupCell } from './helpers/groups';
import {
  fillBo5WinnerA,
  fillGameScores,
  saveScoreModal,
  expectScoreModalOpen,
  expectScoreHint,
} from './helpers/scores';
import { readBackend, countFinishedGroupMatches, expectNewGroupMatchFinished } from './helpers/backend';

test.describe('06 scores validation', () => {
  test.beforeEach(async ({ page }) => {
    await createMinimalTournament(page);
    await debugFillPlayers(page, 8);
    await createGroupsByPlayerCount(page, 4);
    await openFirstGroupCell(page);
  });

  test('accepts legal BO5 winner A', async ({ page }) => {
    const finishedBefore = countFinishedGroupMatches((await readBackend(page)).tournament);
    await fillBo5WinnerA(page);
    await saveScoreModal(page);
    await expectNewGroupMatchFinished(page, finishedBefore);
  });

  test('rejects 10-10 incomplete game', async ({ page }) => {
    await fillGameScores(page, [[10, 10]]);
    await page.getByTestId('score-save').click();
    await expectScoreModalOpen(page);
  });

  test('accepts deuce win 12-10', async ({ page }) => {
    await fillGameScores(page, [[12, 10], [11, 6], [11, 5]]);
    await saveScoreModal(page);
    const { log } = await readBackend(page);
    expect(log.some((c) => c.type === 'EnterScore')).toBe(true);
  });

  test('rejects negative points', async ({ page }) => {
    await fillGameScores(page, [[-1, 11]]);
    await page.getByTestId('score-save').click();
    await expectScoreModalOpen(page);
  });
});
