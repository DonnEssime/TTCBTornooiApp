import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { addPlayer, addPlayers, openPlayerModal, renamePlayerInModal, debugFillPlayers } from './helpers/players';
import { expectReplayRoundTrip, readBackend, expectLogContains } from './helpers/backend';

test.describe('02 players and seeding', () => {
  test.beforeEach(async ({ page }) => {
    await createMinimalTournament(page);
  });

  test('adds players and updates seedings', async ({ page }) => {
    await addPlayers(page, ['Alice', 'Bob', 'Charlie', 'Dana']);
    const { tournament, log } = await readBackend(page);
    expect(Object.keys(tournament.players).length).toBe(4);
    expect(log.filter((c) => c.type === 'CreatePlayer').length).toBe(4);
    expect(tournament.seedings.length).toBe(4);
    await expectReplayRoundTrip(page);
  });

  test('renames player via history modal', async ({ page }) => {
    await addPlayer(page, 'Alice');
    await openPlayerModal(page, 'Alice');
    await renamePlayerInModal(page, 'Alicia');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Alicia' })).toBeVisible();
    await expectLogContains(page, 'RenamePlayer');
    await expectReplayRoundTrip(page);
  });

  test('rejects empty player name', async ({ page }) => {
    await addPlayer(page, '   ');
    const { tournament } = await readBackend(page);
    expect(Object.keys(tournament.players).length).toBe(0);
  });

  test('rejects duplicate display name', async ({ page }) => {
    await addPlayer(page, 'Alice');
    await addPlayer(page, 'Alice');
    await expect(page.getByTestId('status-banner')).toBeVisible();
    const { tournament } = await readBackend(page);
    expect(Object.keys(tournament.players).length).toBe(1);
  });

  test('debug fill adds many players', async ({ page }) => {
    await debugFillPlayers(page, 8);
    const { tournament } = await readBackend(page);
    expect(Object.keys(tournament.players).length).toBe(8);
  });
});
