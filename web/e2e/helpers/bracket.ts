import type { Page } from '@playwright/test';
import { singleEliminationPlacementRows } from '../../../src/model';
import { readBackend } from './backend';

function bracketHasPlacements(tournament: import('../../../src/model').Tournament): boolean {
  if (tournament.bracketMatches.length === 0) return false;
  const rows = singleEliminationPlacementRows(tournament.bracketMatches, tournament);
  return Boolean(rows && rows.length > 0);
}

export async function goToBracketTab(page: Page): Promise<void> {
  await page.getByTestId('tab-bracket').click();
}

export async function waitForBracketCreated(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const t = window.__ttcTest?.getTournament();
    if (!t || t.bracketMatches.length === 0) return false;
    const r1 = t.bracketMatches.filter((bm) => bm.seedA && bm.seedB);
    if (r1.length === 0) return false;
    return r1.every((bm) => Boolean(t.matches[`match-${bm.id}`]));
  }, { timeout: 90_000 });
  await page.locator('.match-box--interactive').first().waitFor({ state: 'visible', timeout: 90_000 });
  await page.getByTestId('tab-overview').click();
  await page.getByTestId('tab-bracket').click();
  await page.locator('.match-box--interactive').first().waitFor({ state: 'visible', timeout: 90_000 });
}

export async function createKnockoutClosedForm(page: Page): Promise<void> {
  await goToBracketTab(page);
  await page.locator('input[value="crop_closed_form"]').check();
  await page.getByTestId('bracket-create').click();
  await waitForBracketCreated(page);
}

export async function createKnockoutHeuristic(page: Page): Promise<void> {
  await goToBracketTab(page);
  await page.locator('input[value="heuristic"]').check();
  await page.getByTestId('bracket-create').click();
  await page.locator('#bracket-heuristic-search-title').waitFor({ state: 'hidden', timeout: 90_000 });
}

export async function removeBracket(page: Page): Promise<void> {
  await page.locator('.match-box--interactive').first().waitFor({ state: 'visible' });
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await page.getByTestId('bracket-remove').click();
  await page.waitForFunction(() => {
    const t = window.__ttcTest?.getTournament();
    return (t?.bracketMatches.length ?? 0) === 0;
  });
}

/** Run debug bracket simulate until placements are available on the Results tab. */
export async function simulateBracketToCompletion(page: Page, maxSteps = 15): Promise<void> {
  await goToBracketTab(page);
  for (let step = 0; step < maxSteps; step++) {
    const { tournament } = await readBackend(page);
    if (bracketHasPlacements(tournament)) return;

    const btn = page.getByTestId('debug-simulate-bracket');
    if (!(await btn.isEnabled())) {
      throw new Error('debug-simulate-bracket disabled before bracket placements exist');
    }
    await debugSimulateBracket(page);
  }
  const { tournament } = await readBackend(page);
  if (!bracketHasPlacements(tournament)) {
    throw new Error('simulateBracketToCompletion finished without bracket placements');
  }
}

export async function openFirstBracketSlot(page: Page): Promise<void> {
  await page.locator('.match-box--interactive').first().click();
}

export async function debugSimulateBracket(page: Page): Promise<void> {
  await page.getByTestId('debug-simulate-bracket').click();
}

export async function goToResultsTab(page: Page): Promise<void> {
  await page.getByTestId('tab-results').click();
}
