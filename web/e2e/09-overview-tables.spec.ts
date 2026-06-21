import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { debugFillPlayers } from './helpers/players';
import { createGroupsByPlayerCount } from './helpers/groups';
import { goToOverviewTab, incrementTables } from './helpers/overview';
import { readBackend } from './helpers/backend';

test.describe('09 overview tables', () => {
  test.beforeEach(async ({ page }) => {
    await createMinimalTournament(page);
    await debugFillPlayers(page, 4);
    await createGroupsByPlayerCount(page, 4);
  });

  test('table stepper changes table count', async ({ page }) => {
    const before = (await readBackend(page)).tournament.tables.length;
    await incrementTables(page);
    const after = (await readBackend(page)).tournament.tables.length;
    expect(after).toBe(before + 1);
  });

  test('overview shows ready matches', async ({ page }) => {
    await goToOverviewTab(page);
    await expect(page.locator('.ov-ready-list').first()).toBeVisible();
  });

  test('table grid renders tiles', async ({ page }) => {
    await goToOverviewTab(page);
    await expect(page.locator('.ov-table-tile').first()).toBeVisible();
  });
});
