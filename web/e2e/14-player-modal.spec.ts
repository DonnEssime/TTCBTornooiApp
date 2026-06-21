import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { debugFillPlayers, openPlayerModal, renamePlayerInModal } from './helpers/players';
import { createGroupsByPlayerCount } from './helpers/groups';
import { openFirstGroupCell } from './helpers/groups';
import {
  fillBo5WinnerA,
  saveScoreModal,
} from './helpers/scores';
import { readBackend } from './helpers/backend';

test.describe('14 player modal', () => {
  test.beforeEach(async ({ page }) => {
    await createMinimalTournament(page);
    await debugFillPlayers(page, 8);
    await createGroupsByPlayerCount(page, 4);
  });

  test('player history modal opens and shows name', async ({ page }) => {
    const { tournament } = await readBackend(page);
    const firstName = Object.values(tournament.players)[0]?.name ?? '';
    await openPlayerModal(page, firstName);
    await expect(page.getByTestId('player-history-name')).toBeVisible();
  });

  test('rename updates backend', async ({ page }) => {
    const { tournament } = await readBackend(page);
    const firstName = Object.values(tournament.players)[0]?.name ?? 'Player';
    await openPlayerModal(page, firstName);
    await renamePlayerInModal(page, 'Renamed');
    await page.keyboard.press('Escape');
    const after = await readBackend(page);
    expect(Object.values(after.tournament.players).some((p) => p.name === 'Renamed')).toBe(true);
  });

  test('match history visible after scoring', async ({ page }) => {
    await openFirstGroupCell(page);
    await fillBo5WinnerA(page);
    await saveScoreModal(page);
    const { tournament } = await readBackend(page);
    const pid = Object.keys(tournament.players)[0]!;
    const name = tournament.players[pid]!.name;
    await openPlayerModal(page, name);
    await expect(page.locator('.player-history-lines li').first()).toBeVisible();
  });
});
