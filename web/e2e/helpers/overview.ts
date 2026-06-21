import type { Page } from '@playwright/test';

export async function goToOverviewTab(page: Page): Promise<void> {
  await page.getByTestId('tab-overview').click();
}

export async function incrementTables(page: Page): Promise<void> {
  await goToOverviewTab(page);
  await page.getByLabel(/increase/i).click();
}

export async function decrementTables(page: Page): Promise<void> {
  await goToOverviewTab(page);
  await page.getByLabel(/decrease/i).click();
}

export async function dragReadyToTable(page: Page, tableIndex = 0): Promise<void> {
  await goToOverviewTab(page);
  const ready = page.locator('.ov-ready-btn').first();
  const table = page.locator('.ov-table-tile').nth(tableIndex);
  await ready.dragTo(table);
}
