import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Reset OPFS + localStorage before each test. */
export async function resetAppState(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.clear();
    if (window.__ttcTest) await window.__ttcTest.clearOpfs();
  });
  await page.reload();
  await page.waitForSelector('.brand-text', { state: 'visible' });
}

/** Workspace tab button (excludes OPFS recent-list entries). */
export function workspaceTab(page: Page, name: string) {
  return page.locator('nav.workspace-tabs').getByRole('button', { name, exact: true });
}

export async function gotoSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
}

export async function setLocale(page: Page, locale: 'en' | 'nl'): Promise<void> {
  await page.getByRole('button', { name: locale.toUpperCase(), exact: true }).click();
}

export async function expectStatusBanner(page: Page, pattern: RegExp | string): Promise<void> {
  const banner = page.getByTestId('status-banner');
  await banner.waitFor({ state: 'visible' });
  if (typeof pattern === 'string') await expect(banner).toContainText(pattern);
  else await expect(banner).toHaveText(pattern);
}

export async function selectWorkspaceTab(page: Page, name: string): Promise<void> {
  await workspaceTab(page, name).click();
}

export async function waitForTournamentTab(page: Page, name: string): Promise<void> {
  await workspaceTab(page, name).waitFor({ state: 'visible' });
}

/** Top-level competition class tab (Junior, Senior, …) in multi-class tournaments. */
export async function selectCompetitionClassTab(page: Page, className: string): Promise<void> {
  await page
    .locator('nav.inner-tabs:not(.class-track-tabs)')
    .getByRole('button', { name: className, exact: true })
    .click();
}

/** Class-level sub-tab (Group phase, Bracket, Results) in multi-class tournaments. */
export async function selectClassTrackTab(page: Page, tabName: string): Promise<void> {
  await page
    .locator('nav.class-track-tabs')
    .getByRole('button', { name: tabName, exact: true })
    .click();
}