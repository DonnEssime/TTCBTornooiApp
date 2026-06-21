import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { setLocale, waitForTournamentTab } from './helpers/app';
import { addPlayer } from './helpers/players';

test.describe('13 i18n', () => {
  test('switches to Dutch locale', async ({ page }) => {
    await setLocale(page, 'nl');
    await expect(page.getByRole('button', { name: 'Instellingen', exact: true })).toBeVisible();
    const locale = await page.evaluate(() => localStorage.getItem('ttc.locale'));
    expect(locale).toBe('nl');
  });

  test('switches back to English', async ({ page }) => {
    await setLocale(page, 'nl');
    await setLocale(page, 'en');
    await expect(page.getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  });

  test('creates tournament in Dutch UI', async ({ page }) => {
    await setLocale(page, 'nl');
    await page.getByTestId('wizard-name').fill('NL Test');
    await page.getByTestId('wizard-create').click();
    await waitForTournamentTab(page, 'NL Test');
  });
});
