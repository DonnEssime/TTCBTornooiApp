import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { debugFillPlayers, openPlayerModal, renamePlayerInModal } from './helpers/players';
import { createGroupsByPlayerCount } from './helpers/groups';
import { openFirstGroupCell } from './helpers/groups';
import { importJsonlAndOpen } from './helpers/importExport';
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

  test('group dropdown is disabled after the player has recorded group play', async ({ page }) => {
    await openFirstGroupCell(page);
    await fillBo5WinnerA(page);
    await saveScoreModal(page);
    const { tournament } = await readBackend(page);
    const pid = Object.keys(tournament.players)[0]!;
    const name = tournament.players[pid]!.name;
    await openPlayerModal(page, name);
    await expect(page.locator('.player-history-group-select').first()).toBeDisabled();
  });

  test('imported finished class keeps 2 Juli group dropdown disabled', async ({ page }) => {
    const closeBtn = page.getByRole('button', { name: /Close tournament/i });
    if (await closeBtn.count()) {
      await closeBtn.click();
    }
    await importJsonlAndOpen(page, '/mnt/c/Users/donne/Downloads/zomercompetitie-2026-07-02_broken_doubles_bracket.jsonl');
    await openPlayerModal(page, 'Simon Donné');
    const singlesSection = page.locator('.player-history-section').filter({
      has: page.locator('.player-history-track-title', { hasText: '2 Juli' }),
    });
    await expect(singlesSection.locator('.player-history-group-select')).toBeDisabled();
  });
});
