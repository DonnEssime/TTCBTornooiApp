import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function openRecentTournament(page: Page, name: string): Promise<void> {
  await page.getByTestId(`recent-${name}`).click();
  await page.locator('#tournament-load-title').waitFor({ state: 'hidden', timeout: 90_000 }).catch(() => {});
}

export async function deleteSavedTournament(page: Page, name: string, phrase = 'I understand'): Promise<void> {
  await page.getByTestId(`recent-delete-${name}`).click();
  await page.getByTestId('delete-confirm-input').fill(phrase);
  await page.getByTestId('delete-confirm-btn').click();
}

export async function closeActiveSession(page: Page): Promise<void> {
  await page.getByTestId('session-close').click();
}

export async function expectRecentEntry(page: Page, name: string, visible = true): Promise<void> {
  const el = page.getByTestId(`recent-${name}`);
  if (visible) await expect(el).toBeVisible();
  else await expect(el).toHaveCount(0);
}
