import type { Page } from '@playwright/test';

export async function goToPlayersTab(page: Page): Promise<void> {
  await page.getByTestId('tab-players').click();
}

export async function addPlayer(page: Page, name: string, handicap?: number): Promise<void> {
  await goToPlayersTab(page);
  await page.getByTestId('player-name-input').fill(name);
  if (handicap !== undefined) {
    const hc = page.locator('#new-player-hc');
    if (await hc.isVisible()) await hc.fill(String(handicap));
  }
  await page.getByTestId('player-add-btn').click();
}

export async function addPlayers(page: Page, names: string[]): Promise<void> {
  for (const name of names) await addPlayer(page, name);
}

export async function openPlayerModal(page: Page, name: string): Promise<void> {
  await goToPlayersTab(page);
  await page.getByRole('button', { name: new RegExp(name) }).first().click();
}

export async function renamePlayerInModal(page: Page, newName: string): Promise<void> {
  await page.getByTestId('player-history-name').fill(newName);
  await page.getByTestId('player-history-name').blur();
}

export async function debugFillPlayers(page: Page, count: number): Promise<void> {
  await goToPlayersTab(page);
  await page.getByTestId('debug-fill-count').fill(String(count));
  await page.getByTestId('debug-fill-btn').click();
}
