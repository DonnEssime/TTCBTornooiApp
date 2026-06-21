import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { debugFillPlayers } from './helpers/players';
import { createGroupsByPlayerCount } from './helpers/groups';
import { fillBo5WinnerA, cancelScoreModal } from './helpers/scores';
import { openFirstGroupCell } from './helpers/groups';
import { clickUndo } from './helpers/undo';
import { setLocale, waitForTournamentTab } from './helpers/app';
import { readBackend } from './helpers/backend';

test.describe('15 invariant breakers', () => {
  test('navigate away mid-score-modal without backend mutation', async ({ page }) => {
    await createMinimalTournament(page);
    await debugFillPlayers(page, 8);
    await createGroupsByPlayerCount(page, 4);
    const logBefore = (await readBackend(page)).log.length;
    await openFirstGroupCell(page);
    await fillBo5WinnerA(page);
    await cancelScoreModal(page);
    await page.getByTestId('tab-players').click();
    const logAfter = (await readBackend(page)).log.length;
    expect(logAfter).toBe(logBefore);
  });

  test('toggle language mid-wizard does not crash', async ({ page }) => {
    await page.getByTestId('wizard-name').fill('Lang');
    await setLocale(page, 'nl');
    await setLocale(page, 'en');
    await page.getByTestId('wizard-create').click();
    await waitForTournamentTab(page, 'Lang');
  });

  test('undo while modal was open stays consistent', async ({ page }) => {
    await createMinimalTournament(page);
    await debugFillPlayers(page, 4);
    await createGroupsByPlayerCount(page, 4);
    await openFirstGroupCell(page);
    await fillBo5WinnerA(page);
    await page.getByTestId('score-save').click();
    await clickUndo(page);
    const { tournament } = await readBackend(page);
    const pending = Object.values(tournament.matches).filter((m) => m.id.startsWith('gm-'));
    expect(pending.some((m) => m.status === 'scheduled')).toBe(true);
  });

  test('rapid undo clicks do not crash', async ({ page }) => {
    await createMinimalTournament(page);
    await debugFillPlayers(page, 4);
    for (let i = 0; i < 5; i++) {
      await page.getByTestId('undo-btn').click({ force: true });
    }
    await expect(page.getByTestId('footer-last-command')).toBeVisible();
  });
});
