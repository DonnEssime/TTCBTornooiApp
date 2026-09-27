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

/**
 * Ensure a player has exactly one competition class flagged true (`targetClassName`), unchecking
 * every other class. In single-class tournaments newly-added players auto-inherit that sole class
 * flag (see `preferredClassIdForNewPlayer` in App.svelte); in multi-class tournaments new players
 * start unassigned. Either way, explicitly unchecking every other class here guarantees single-class
 * membership regardless of how many classes exist.
 */
export async function setPlayerSingleClass(
  page: Page,
  playerName: string,
  targetClassName: string,
  allClassNames: string[],
): Promise<void> {
  await setPlayerClassFlag(page, playerName, targetClassName, true);
  for (const className of allClassNames) {
    if (className === targetClassName) continue;
    await setPlayerClassFlag(page, playerName, className, false);
  }
}
