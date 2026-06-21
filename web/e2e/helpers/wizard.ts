import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { waitForTournamentTab, workspaceTab } from './app';

export async function createMinimalTournament(page: Page, name = 'E2E Tournament'): Promise<void> {
  await page.getByTestId('wizard-name').fill(name);
  await page.getByTestId('wizard-create').click();
  await waitForTournamentTab(page, name);
}

export async function setWizardTableCount(page: Page, count: number): Promise<void> {
  await page.getByTestId('wizard-tables').fill(String(count));
}

export async function enableHandicap(page: Page, min = 0, max = 10): Promise<void> {
  await page.getByTestId('wizard-handicap').check();
  await page.locator('.handicap-config-grid input').nth(0).fill(String(min));
  await page.locator('.handicap-config-grid input').nth(1).fill(String(max));
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
