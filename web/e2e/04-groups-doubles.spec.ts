import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { debugFillPlayers } from './helpers/players';
import { enableDoubles, createGroupsByPlayerCount } from './helpers/groups';
import { importJsonlAndOpen } from './helpers/importExport';
import { expectDoublesTrack } from './helpers/backend';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

test.describe('04 groups doubles', () => {
  test('blocks doubles with odd player count', async ({ page }) => {
    await createMinimalTournament(page);
    await debugFillPlayers(page, 7);
    await enableDoubles(page);
    await expect(page.getByText(/even/i)).toBeVisible();
    const btn = page.getByTestId('groups-create-by-players');
    await expect(btn).toBeDisabled();
  });

  test('creates doubles groups with even players', async ({ page }) => {
    await createMinimalTournament(page);
    await debugFillPlayers(page, 8);
    await enableDoubles(page);
    await createGroupsByPlayerCount(page, 4);
    await expectDoublesTrack(page);
  });

  test('imported doubles fixture shows pair matrix', async ({ page }) => {
    await importJsonlAndOpen(page, path.join(fixturesDir, 'doubles-8-players.jsonl'));
    await page.getByTestId('tab-groups').click();
    await expect(page.locator('.pair-label-btn').first()).toBeVisible();
  });
});
