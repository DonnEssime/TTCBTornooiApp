import type { Page } from '@playwright/test';

export async function goToGroupsTab(page: Page): Promise<void> {
  await page.getByTestId('tab-groups').click();
}

export async function createGroupsByPlayerCount(page: Page, count: number): Promise<void> {
  await goToGroupsTab(page);
  await page.locator('.group-create-num').first().fill(String(count));
  await page.getByTestId('groups-create-by-players').click();
}

export async function enableDoubles(page: Page): Promise<void> {
  await goToGroupsTab(page);
  await page.getByTestId('group-doubles').check();
}

export async function clearGroups(page: Page): Promise<void> {
  await goToGroupsTab(page);
  await page.getByTestId('groups-clear').click();
}

export async function openFirstGroupCell(page: Page): Promise<void> {
  await page.locator('.group-matrix-cell-btn').first().click();
}

export async function debugSimulateGroup(page: Page): Promise<void> {
  await page.getByTestId('debug-simulate-group').click();
}
