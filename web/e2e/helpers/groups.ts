import type { Page } from '@playwright/test';
import { selectCompetitionClassTab, selectClassTrackTab } from './app';
import { fillBo5WinnerA, saveScoreModal } from './scores';

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

/** Class-scoped "Create by group count" (fixed number of groups, e.g. one group for a small class). */
export async function createClassGroupsByGroupCount(
  page: Page,
  className: string,
  groupCount: number,
): Promise<void> {
  await selectCompetitionClassTab(page, className);
  await selectClassTrackTab(page, 'Group phase');
  await page.locator('.group-create-num').nth(1).fill(String(groupCount));
  await page.getByRole('button', { name: 'Create by group count', exact: true }).click();
}

export async function enableDoubles(page: Page): Promise<void> {
  await goToGroupsTab(page);
  await page.getByTestId('group-format-fixed-doubles').check();
}

export async function enableShuffleDoubles(page: Page): Promise<void> {
  await goToGroupsTab(page);
  await page.getByTestId('group-format-shuffle-doubles').check();
}

export async function clearGroups(page: Page): Promise<void> {
  await goToGroupsTab(page);
  await page.getByTestId('groups-clear').click();
}

export async function openFirstGroupCell(page: Page): Promise<void> {
  await page.locator('.group-matrix-cell-btn').first().click();
}

/** Open the last (open) group-matrix cell currently rendered on the active class/track tab. */
export async function openLastGroupCell(page: Page): Promise<void> {
  await page.locator('.group-matrix-cell-btn').last().click();
}

export async function debugSimulateGroup(page: Page): Promise<void> {
  await page.getByTestId('debug-simulate-group').click();
}

/** Repeatedly click "debug simulate" for the active class's group phase until no `gm-*` match for
 * that class is left unfinished (defensive loop; a single click usually finishes every round-robin
 * match since group creation eagerly creates all matches). */
export async function debugSimulateGroupUntilDone(
  page: Page,
  classId: string,
  maxSteps = 5,
): Promise<void> {
  for (let step = 0; step < maxSteps; step++) {
    const remaining = await page.evaluate((cid) => {
      const t = window.__ttcTest?.getTournament();
      if (!t) return 0;
      return Object.values(t.matches).filter(
        (m) => m.id.startsWith('gm-') && m.classId === cid && m.status !== 'finished',
      ).length;
    }, classId);
    if (remaining === 0) return;
    await debugSimulateGroup(page);
  }
  const remaining = await page.evaluate((cid) => {
    const t = window.__ttcTest?.getTournament();
    if (!t) return 0;
    return Object.values(t.matches).filter(
      (m) => m.id.startsWith('gm-') && m.classId === cid && m.status !== 'finished',
    ).length;
  }, classId);
  if (remaining > 0) {
    throw new Error(`debugSimulateGroupUntilDone: ${remaining} group matches still unfinished for class ${classId}`);
  }
}

/**
 * Hybrid class group scoring: manually score the first and last (still-open) group-matrix cells
 * through the real UI (score modal), then bulk-finish every remaining group match for the class
 * via debug simulate. Requires the class's Group phase tab to already have groups created.
 */
export async function hybridCompleteClassGroups(
  page: Page,
  className: string,
  classId: string,
): Promise<void> {
  await selectCompetitionClassTab(page, className);
  await selectClassTrackTab(page, 'Group phase');

  await openFirstGroupCell(page);
  await fillBo5WinnerA(page);
  await saveScoreModal(page);

  await openLastGroupCell(page);
  await fillBo5WinnerA(page);
  await saveScoreModal(page);

  await debugSimulateGroupUntilDone(page, classId);
}

export async function dragPlayerToGroup(
  page: Page,
  playerId: string,
  targetGroupId: string,
): Promise<void> {
  const source = page.getByTestId(`group-player-drag-${playerId}`);
  const target = page.getByTestId(`group-drop-${targetGroupId}`);
  await source.dragTo(target);
}
