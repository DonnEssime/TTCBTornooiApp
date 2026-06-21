import type { Page } from '@playwright/test';
import { goToPlayersTab } from './players';

export async function addCompetitionClass(page: Page, name: string): Promise<void> {
  await page.locator('.inner-tab-add-class').click();
  await page.locator('#add-class-name-input').fill(name);
  await page.getByRole('button', { name: 'Add class', exact: true }).click();
}

export async function setPlayerClassFlag(
  page: Page,
  playerName: string,
  className: string,
  checked: boolean,
): Promise<void> {
  await goToPlayersTab(page);
  const row = page.locator('.player-row').filter({
    has: page.getByRole('button', { name: new RegExp(playerName) }),
  });
  const checkbox = row.getByRole('checkbox', { name: className, exact: true });
  if (checked) await checkbox.check();
  else await checkbox.uncheck();
}
