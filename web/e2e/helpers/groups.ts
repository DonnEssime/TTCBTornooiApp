import type { Page } from '@playwright/test';
import { selectCompetitionClassTab, selectClassTrackTab } from './app';

export async function goToGroupsTab(page: Page): Promise<void> {
  await page.getByTestId('tab-groups').click();
}

export async function createGroupsByPlayerCount(page: Page, count: number): Promise<void> {
  await goToGroupsTab(page);
  await page.locator('.group-create-num').first().fill(String(count));
  await page.getByTestId('groups-create-by-players').click();
}

export async function createClassGroupsByPlayerCount(
  page: Page,
  className: string,
  targetSize: number,
): Promise<void> {
  await selectCompetitionClassTab(page, className);
  await selectClassTrackTab(page, 'Group phase');
  await page.locator('.group-create-num').first().fill(String(targetSize));
  await page.getByRole('button', { name: 'Create by player count', exact: true }).click();
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
