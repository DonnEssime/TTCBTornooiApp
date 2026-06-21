import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { addPlayer, debugFillPlayers } from './helpers/players';
import { createGroupsByPlayerCount, openFirstGroupCell } from './helpers/groups';
import { fillBo5WinnerA, saveScoreModal } from './helpers/scores';
import { clickUndo, clickRedo, expectRedoEnabled } from './helpers/undo';
import { expectReplayRoundTrip, readBackend, canRedo } from './helpers/backend';

async function finishedGroupMatchId(page: import('@playwright/test').Page): Promise<string> {
  const { tournament } = await readBackend(page);
  const mid = Object.values(tournament.matches).find(
    (m) => m.id.startsWith('gm-') && m.status === 'finished',
  )?.id;
  if (!mid) throw new Error('no finished group match');
  return mid;
}

test.describe('07 undo redo', () => {
  test.beforeEach(async ({ page }) => {
    await createMinimalTournament(page);
    await debugFillPlayers(page, 4);
    await createGroupsByPlayerCount(page, 4);
  });

  test('undo single score restores scheduled match', async ({ page }) => {
    await openFirstGroupCell(page);
    await fillBo5WinnerA(page);
    await saveScoreModal(page);
    const mid = await finishedGroupMatchId(page);
    await clickUndo(page);
    await expectMatchScheduled(page, mid);
    expect(await canRedo(page)).toBe(true);
    await expectReplayRoundTrip(page);
  });

  test('redo restores finished match', async ({ page }) => {
    await openFirstGroupCell(page);
    await fillBo5WinnerA(page);
    await saveScoreModal(page);
    const mid = await finishedGroupMatchId(page);
    await clickUndo(page);
    await clickRedo(page);
    const { tournament } = await readBackend(page);
    expect(tournament.matches[mid]?.status).toBe('finished');
  });

  test('redo disabled after new action following undo', async ({ page }) => {
    await openFirstGroupCell(page);
    await fillBo5WinnerA(page);
    await saveScoreModal(page);
    const cells = page.locator('.group-matrix-cell-btn');
    await clickUndo(page);
    await cells.nth(1).click();
    await fillBo5WinnerA(page);
    await saveScoreModal(page);
    await expectRedoEnabled(page, false);
  });

  test('undo create player blocked when used in groups', async ({ page }) => {
    await clickUndo(page);
    await clickUndo(page);
    await expect(page.getByTestId('status-banner')).toBeVisible();
  });

  test('multi-step undo chain', async ({ page }) => {
    await addExtraPlayerAndGroup(page);
    for (let i = 0; i < 3; i++) await clickUndo(page);
    const { tournament } = await readBackend(page);
    expect(Object.keys(tournament.groups).length).toBe(0);
  });
});

async function expectMatchScheduled(page: import('@playwright/test').Page, mid: string): Promise<void> {
  const { tournament } = await readBackend(page);
  expect(tournament.matches[mid]?.status).toBe('scheduled');
}

async function addExtraPlayerAndGroup(page: import('@playwright/test').Page): Promise<void> {
  await addPlayer(page, 'Extra');
}
