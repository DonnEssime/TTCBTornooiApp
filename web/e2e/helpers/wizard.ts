import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { waitForTournamentTab, workspaceTab } from './app';

export async function enableDebug(page: Page): Promise<void> {
  await page.getByTestId('wizard-debug').check();
}

export async function createMinimalTournament(page: Page, name = 'E2E Tournament'): Promise<void> {
  await page.getByTestId('wizard-name').fill(name);
  await enableDebug(page);
  await page.getByTestId('wizard-create').click();
  await waitForTournamentTab(page, name);
}

export async function setWizardTableCount(page: Page, count: number): Promise<void> {
  await page.getByTestId('wizard-tables').fill(String(count));
}

export async function enableHandicap(
  page: Page,
  min = 0,
  max = 9,
  maxStartAdjustment?: number,
): Promise<void> {
  await page.getByTestId('wizard-handicap').check();
  const inputs = page.locator('.handicap-config-grid input');
  await inputs.nth(0).fill(String(min));
  await inputs.nth(1).fill(String(max));
  if (maxStartAdjustment !== undefined) {
    await inputs.nth(2).fill(String(maxStartAdjustment));
  }
}

/** Create a tournament for docs/howto captures: handicap on, debug off. */
export async function createHowtoTournament(
  page: Page,
  name = 'Demo Tornooi',
): Promise<void> {
  await page.getByTestId('wizard-name').fill(name);
  await enableHandicap(page, 0, 9, 7);
  await page.getByTestId('wizard-create').click();
  await waitForTournamentTab(page, name);
}

export async function enableMisc(page: Page, label = 'Club'): Promise<void> {
  const miscToggle = page.locator('.checkbox-line-misc input[type="checkbox"]');
  await miscToggle.check();
  await page.locator('.misc-label-inline').fill(label);
}

export async function enableClasses(page: Page, names: string[]): Promise<void> {
  await page.getByTestId('wizard-classes').check();
  for (let i = 0; i < names.length; i++) {
    if (i > 0) await page.getByRole('button', { name: 'Add class row' }).click();
    await page.locator('.class-grid tbody tr').nth(i).locator('input').fill(names[i]!);
  }
}

export async function expectNoTournamentSession(page: Page, name: string): Promise<void> {
  await expect(workspaceTab(page, name)).toHaveCount(0);
}
