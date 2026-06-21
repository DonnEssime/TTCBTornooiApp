import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { workspaceTab } from './helpers/app';

test.describe('16 session edge cases', () => {
  test('version footer shows build info', async ({ page }) => {
    await expect(page.locator('.version-footer')).toBeVisible();
  });

  test('settings shows import control', async ({ page }) => {
    await expect(page.getByTestId('import-jsonl')).toBeAttached();
  });

  test('tournament name inline edit persists in tab', async ({ page }) => {
    await createMinimalTournament(page, 'Rename Me');
    await page.locator('#tm-name-input').fill('Renamed Tab');
    await page.locator('#tm-name-input').blur();
    await expect(workspaceTab(page, 'Renamed Tab')).toBeVisible();
  });

  test('closing tournament returns to settings and removes workspace tab', async ({ page }) => {
    const name = 'E2E Tournament';
    await createMinimalTournament(page, name);
    await page.getByTestId('session-close').click();
    await expect(page.getByRole('heading', { name: 'Tournament Management' })).toBeVisible();
    await expect(workspaceTab(page, name)).toHaveCount(0);
  });
});
