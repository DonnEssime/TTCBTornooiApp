import type { Locator } from '@playwright/test';
import { test, expect } from './fixtures/test-fixture';
import { expectStatusBanner, waitForTournamentTab } from './helpers/app';
import { setWizardTableCount, enableMisc, enableClasses, enableDebug } from './helpers/wizard';
import { addPlayer, goToPlayersTab } from './helpers/players';
import { setPlayerSingleClass } from './helpers/classes';
import {
  createClassGroupsByGroupCount,
  createClassGroupsByPlayerCount,
  hybridCompleteClassGroups,
} from './helpers/groups';
import {
  createClassKnockoutClosedForm,
  createClassKnockoutHeuristic,
  simulateClassBracketToCompletion,
  goToClassBracketTab,
  goToClassResultsTab,
} from './helpers/bracket';
import { goToOverviewTab, dragReadyToTable } from './helpers/overview';
import {
  readBackend,
  expectReplayRoundTrip,
  classIdByName,
  countFinishedGroupMatches,
  countGroupMatches,
  snapshotClassGroupsSync,
  getClassPlacementRows,
  classThirdPlaceEnabled,
} from './helpers/backend';

// Fixed scenario, matched to the reviewed plan:
//   Youth (6, 1 group, no bracket) / Seniors (20, 5x4, heuristic + 3rd place)
//   Veterans (20, 5x4, heuristic + 3rd place) / Ladies (8, 2x4, closed-form + 3rd place)
// Club (misc) meta on, no handicap, 8 shared tables, single class flag per player.

const CLUBS = ['TTC Alpha', 'TTC Beta', 'TTC Gamma'];
const INDEPENDENT_CLUB = '-';

interface RosterPlayer {
  name: string;
  club: string;
  className: string;
}

/** Every 5th player (0-indexed) in a class plays independently (no club). */
function clubForIndex(i: number): string {
  return i % 5 === 4 ? INDEPENDENT_CLUB : CLUBS[i % CLUBS.length]!;
}

/** Zero-pad indices so names never collide as substrings (e.g. "S01" vs "S10"), which would break
 * `getByRole('button', { name: new RegExp(name) })` locators used by class-flag helpers. */
function buildClassRoster(prefix: string, className: string, count: number): RosterPlayer[] {
  const width = String(count).length;
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}${String(i + 1).padStart(width, '0')}`,
    club: clubForIndex(i),
    className,
  }));
}

const YOUTH = buildClassRoster('Y', 'Youth', 6);
const SENIORS = buildClassRoster('S', 'Seniors', 20);
const VETERANS = buildClassRoster('V', 'Veterans', 20);
const LADIES = buildClassRoster('L', 'Ladies', 8);
const ROSTER: RosterPlayer[] = [...YOUTH, ...SENIORS, ...VETERANS, ...LADIES];

const CLASS_NAMES = ['Youth', 'Seniors', 'Veterans', 'Ladies'] as const;

function groupMatchCount(groupSizes: number[]): number {
  return groupSizes.reduce((sum, size) => sum + (size * (size - 1)) / 2, 0);
}

/** Fail loudly (not silently pass) if a supposedly-visible element is off-screen or zero-sized at
 * the assumed Full HD viewport. Scrolls the element into view first: long content (e.g. a many-round
 * bracket tree) legitimately extends past one screenful and requires scrolling, which is normal,
 * acceptable UX — this check is about catching mis-positioned/overlapping/zero-sized controls, not
 * about disallowing page scroll. */
async function expectOnScreen(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box, 'expected a bounding box for a visible element').not.toBeNull();
  const b = box!;
  expect(b.width).toBeGreaterThan(0);
  expect(b.height).toBeGreaterThan(0);
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(1920);
  expect(b.y + b.height).toBeLessThanOrEqual(1080);
}

test.describe('21 four-class full tournament', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('runs a four-class tournament end to end with shared tables and club meta', async ({ page }) => {
    test.setTimeout(20 * 60_000);

    // ---------------------------------------------------------------------
    // 1. Wizard: 8 shared tables, Club meta (no handicap), four classes, debug on.
    // ---------------------------------------------------------------------
    await test.step('create tournament via wizard', async () => {
      await page.getByTestId('wizard-name').fill('Four Class Cup');
      await setWizardTableCount(page, 8);
      await enableMisc(page, 'Club');
      await enableClasses(page, [...CLASS_NAMES]);
      await enableDebug(page);
      await expect(page.getByTestId('wizard-handicap')).not.toBeChecked();
      await page.getByTestId('wizard-create').click();
      await waitForTournamentTab(page, 'Four Class Cup');

      const { tournament, log } = await readBackend(page);
      expect(tournament.classDefinitions.length).toBe(4);
      expect(tournament.classDefinitions.map((d) => d.name).sort()).toEqual([...CLASS_NAMES].sort());
      expect(tournament.tables.length).toBe(8);
      expect(tournament.miscConfig?.label).toBe('Club');
      expect(tournament.handicapConfig).toBeUndefined();
      expect(tournament.debugMode).toBe(true);
      expect(log.some((c) => c.type === 'SetTournamentTables')).toBe(true);
      expect(log.some((c) => c.type === 'SetMiscConfig')).toBe(true);
      expect(log.some((c) => c.type === 'SetTournamentClasses')).toBe(true);
      await expectReplayRoundTrip(page);
    });

    // ---------------------------------------------------------------------
    // 2. Data-model guard: an empty club must be rejected while misc is active,
    //    and no player should be silently created.
    // ---------------------------------------------------------------------
    await test.step('rejects an empty club (misc required) with no side effects', async () => {
      const before = await readBackend(page);
      const beforeCount = Object.keys(before.tournament.players).length;

      await goToPlayersTab(page);
      await expect(page.locator('#new-player-hc')).not.toBeVisible();
      const miscInput = page.locator('#new-player-misc');
      await expectOnScreen(miscInput);
      await page.getByTestId('player-name-input').fill('ClubTestReject');
      await miscInput.fill('');
      await page.getByTestId('player-add-btn').click();
      await expectStatusBanner(page, /required/i);

      const after = await readBackend(page);
      expect(Object.keys(after.tournament.players).length).toBe(beforeCount);
    });

    // ---------------------------------------------------------------------
    // 3. Players: add all 54, club meta filled (or "-" for independents), exactly
    //    one class flag each.
    // ---------------------------------------------------------------------
    await test.step('adds all players with club meta and exactly one class each', async () => {
      let expectedCount = 0;
      for (const p of ROSTER) {
        await addPlayer(page, p.name, { misc: p.club });
        expectedCount++;
        // Fail fast (instead of hanging on a nonexistent checkbox) if the add didn't actually land.
        const { tournament: afterCreate } = await readBackend(page);
        expect(
          Object.keys(afterCreate.players).length,
          `player ${p.name} should have been created (player #${expectedCount})`,
        ).toBe(expectedCount);
        await setPlayerSingleClass(page, p.name, p.className, [...CLASS_NAMES]);
      }

      const { tournament } = await readBackend(page);
      expect(Object.keys(tournament.players).length).toBe(ROSTER.length);

      const idByName = new Map(Object.entries(tournament.players).map(([id, pl]) => [pl.name, id]));
      for (const p of ROSTER) {
        const id = idByName.get(p.name);
        expect(id, `player ${p.name} should exist`).toBeDefined();
        expect(tournament.players[id!]!.misc).toBe(p.club);

        const flags = tournament.playerClassFlags[id!] ?? {};
        const trueFlags = Object.entries(flags).filter(([, v]) => v === true);
        expect(trueFlags.length, `player ${p.name} should have exactly one class flag`).toBe(1);
        const flaggedClassId = trueFlags[0]![0];
        expect(flaggedClassId).toBe(classIdByName(tournament, p.className));
      }

      const independentCount = ROSTER.filter((p) => p.club === INDEPENDENT_CLUB).length;
      expect(independentCount).toBeGreaterThan(0);
      await expectReplayRoundTrip(page);
    });

    // ---------------------------------------------------------------------
    // 4. Group phase per class: Youth -> one group (ranking only, no bracket
    //    later); Seniors/Veterans -> 5x4; Ladies -> 2x4.
    // ---------------------------------------------------------------------
    await test.step('creates group stages for every class', async () => {
      await createClassGroupsByGroupCount(page, 'Youth', 1);
      await createClassGroupsByPlayerCount(page, 'Seniors', 4);
      await createClassGroupsByPlayerCount(page, 'Veterans', 4);
      await createClassGroupsByPlayerCount(page, 'Ladies', 4);

      const { tournament } = await readBackend(page);

      const youthId = classIdByName(tournament, 'Youth');
      const youthGroups = tournament.classTournaments[youthId]!.groups;
      expect(Object.keys(youthGroups).length).toBe(1);
      expect(Object.values(youthGroups)[0]!.playerIds.length).toBe(6);
      expect(countGroupMatches(tournament, youthId)).toBe(groupMatchCount([6]));

      const seniorsId = classIdByName(tournament, 'Seniors');
      const seniorsGroups = tournament.classTournaments[seniorsId]!.groups;
      expect(Object.keys(seniorsGroups).length).toBe(5);
      for (const g of Object.values(seniorsGroups)) expect(g.playerIds.length).toBe(4);
      expect(countGroupMatches(tournament, seniorsId)).toBe(groupMatchCount([4, 4, 4, 4, 4]));

      const veteransId = classIdByName(tournament, 'Veterans');
      const veteransGroups = tournament.classTournaments[veteransId]!.groups;
      expect(Object.keys(veteransGroups).length).toBe(5);
      for (const g of Object.values(veteransGroups)) expect(g.playerIds.length).toBe(4);
      expect(countGroupMatches(tournament, veteransId)).toBe(groupMatchCount([4, 4, 4, 4, 4]));

      const ladiesId = classIdByName(tournament, 'Ladies');
      const ladiesGroups = tournament.classTournaments[ladiesId]!.groups;
      expect(Object.keys(ladiesGroups).length).toBe(2);
      for (const g of Object.values(ladiesGroups)) expect(g.playerIds.length).toBe(4);
      expect(countGroupMatches(tournament, ladiesId)).toBe(groupMatchCount([4, 4]));

      // Visual: group matrix for the currently active class (Ladies) renders on-screen.
      await expectOnScreen(page.locator('.group-matrix-cell-btn').first());
      await expectOnScreen(page.locator('nav.inner-tabs:not(.class-track-tabs)'));
    });

    // ---------------------------------------------------------------------
    // 5. Shared tables: one pool of 8 across all classes; assign a ready match
    //    from Overview while many group matches are still pending everywhere.
    // ---------------------------------------------------------------------
    await test.step('shares one 8-table pool across all classes on Overview', async () => {
      await goToOverviewTab(page);
      await expect(page.locator('.ov-table-tile')).toHaveCount(8);
      await expectOnScreen(page.locator('.ov-table-tile').first());

      const { tournament: beforeDrag } = await readBackend(page);
      expect(beforeDrag.tableAssignments.length).toBe(0);

      await dragReadyToTable(page, 0);

      const { tournament: afterDrag } = await readBackend(page);
      expect(afterDrag.tableAssignments.length).toBe(1);
    });

    // ---------------------------------------------------------------------
    // 6. Hybrid group scoring per class, with cross-class isolation checks
    //    before/after each class finishes.
    // ---------------------------------------------------------------------
    await test.step('hybrid-scores every class group phase, verifying isolation', async () => {
      const { tournament: initial } = await readBackend(page);
      const classIds = Object.fromEntries(
        CLASS_NAMES.map((name) => [name, classIdByName(initial, name)]),
      ) as Record<(typeof CLASS_NAMES)[number], string>;

      for (const className of CLASS_NAMES) {
        const otherClassIds = CLASS_NAMES.filter((n) => n !== className).map((n) => classIds[n]);
        const { tournament: before } = await readBackend(page);
        const otherSnapshotsBefore = otherClassIds.map((cid) => snapshotClassGroupsSync(before, cid));

        await hybridCompleteClassGroups(page, className, classIds[className]);

        const { tournament: after } = await readBackend(page);
        expect(countFinishedGroupMatches(after, classIds[className])).toBe(
          countGroupMatches(after, classIds[className]),
        );

        const otherSnapshotsAfter = otherClassIds.map((cid) => snapshotClassGroupsSync(after, cid));
        expect(otherSnapshotsAfter).toEqual(otherSnapshotsBefore);
      }

      await expectReplayRoundTrip(page);
    });

    // ---------------------------------------------------------------------
    // 7. Youth: ranking via the single finished group, no bracket ever generated.
    // ---------------------------------------------------------------------
    await test.step('youth stays group-only: no bracket, no knockout Results', async () => {
      await goToClassBracketTab(page, 'Youth');
      // Group phase is finished, so the bracket create button must be enabled and reachable
      // (proving the *product* would allow it) even though this test deliberately never clicks it.
      await expectOnScreen(page.getByTestId('bracket-create'));
      await expect(page.locator('#bracket-heuristic-search-title')).toHaveCount(0);

      await goToClassResultsTab(page, 'Youth');
      await expectOnScreen(page.getByText('No knockout bracket for this class yet.'));
      await expect(page.locator('.placement-ol li')).toHaveCount(0);

      const { tournament, log } = await readBackend(page);
      const youthId = classIdByName(tournament, 'Youth');
      expect(tournament.classTournaments[youthId]!.bracketMatches.length).toBe(0);
      expect(
        log.some(
          (c) =>
            c.type === 'GenerateBracket' &&
            (c.payload as Record<string, unknown>).classId === youthId,
        ),
      ).toBe(false);
      expect(countFinishedGroupMatches(tournament, youthId)).toBe(groupMatchCount([6]));
    });

    // ---------------------------------------------------------------------
    // 8. Locks: once a player has recorded play in a class, that class flag is
    //    disabled (cannot remove); once a class has a bracket, non-members are
    //    locked out (cannot add). Checked before Ladies' bracket exists / after.
    // ---------------------------------------------------------------------
    await test.step('class flag checkboxes lock exactly when the product says they should', async () => {
      await goToPlayersTab(page);
      const ladiesPlayerRow = page.locator('.player-row').filter({
        has: page.getByRole('button', { name: new RegExp(LADIES[0]!.name) }),
      });
      const ladiesCheckbox = ladiesPlayerRow.getByRole('checkbox', { name: 'Ladies', exact: true });
      await expect(ladiesCheckbox).toBeChecked();
      await expect(ladiesCheckbox).toBeDisabled();
      await expect(ladiesCheckbox).toHaveAttribute('title', /already played matches/i);

      // A Youth player (not in Ladies) can still be added to Ladies right now (no bracket yet).
      const youthPlayerRow = page.locator('.player-row').filter({
        has: page.getByRole('button', { name: new RegExp(YOUTH[0]!.name) }),
      });
      const youthLadiesCheckbox = youthPlayerRow.getByRole('checkbox', { name: 'Ladies', exact: true });
      await expect(youthLadiesCheckbox).not.toBeChecked();
      await expect(youthLadiesCheckbox).toBeEnabled();
    });

    // ---------------------------------------------------------------------
    // 9. Ladies bracket: closed-form seeding, 3rd place on, simulate to placements.
    // ---------------------------------------------------------------------
    await test.step('ladies plays a closed-form bracket with 3rd place', async () => {
      await createClassKnockoutClosedForm(page, 'Ladies');
      await simulateClassBracketToCompletion(page, 'Ladies');

      const { tournament } = await readBackend(page);
      const ladiesId = classIdByName(tournament, 'Ladies');
      expect(classThirdPlaceEnabled(tournament, ladiesId)).toBe(true);

      const rows = await getClassPlacementRows(page, ladiesId);
      expect(rows).not.toBeNull();
      expect(rows!.length).toBeGreaterThanOrEqual(4);

      // Now that Ladies has a bracket, a non-member (Youth) can no longer be added to it.
      await goToPlayersTab(page);
      const youthPlayerRow = page.locator('.player-row').filter({
        has: page.getByRole('button', { name: new RegExp(YOUTH[0]!.name) }),
      });
      const youthLadiesCheckbox = youthPlayerRow.getByRole('checkbox', { name: 'Ladies', exact: true });
      await expect(youthLadiesCheckbox).toBeDisabled();
      await expect(youthLadiesCheckbox).toHaveAttribute('title', /already has a knockout bracket/i);
    });

    // ---------------------------------------------------------------------
    // 10. Seniors / Veterans brackets: heuristic seeding, 3rd place on.
    // ---------------------------------------------------------------------
    for (const className of ['Seniors', 'Veterans'] as const) {
      await test.step(`${className} plays a heuristic-seeded bracket with 3rd place`, async () => {
        await createClassKnockoutHeuristic(page, className);
        await simulateClassBracketToCompletion(page, className, 25);

        const { tournament } = await readBackend(page);
        const classId = classIdByName(tournament, className);
        expect(classThirdPlaceEnabled(tournament, classId)).toBe(true);

        const rows = await getClassPlacementRows(page, classId);
        expect(rows).not.toBeNull();
        expect(rows!.length).toBeGreaterThanOrEqual(4);

        await goToClassBracketTab(page, className);
        await expectOnScreen(page.getByTestId('bracket-third-place-box'));
      });
    }

    // ---------------------------------------------------------------------
    // 11. Final cross-class isolation + full replay round-trip.
    // ---------------------------------------------------------------------
    await test.step('final isolation and replay-round-trip check', async () => {
      const { tournament, log } = await readBackend(page);

      const youthId = classIdByName(tournament, 'Youth');
      const seniorsId = classIdByName(tournament, 'Seniors');
      const veteransId = classIdByName(tournament, 'Veterans');
      const ladiesId = classIdByName(tournament, 'Ladies');

      expect(tournament.classTournaments[youthId]!.bracketMatches.length).toBe(0);
      expect((await getClassPlacementRows(page, seniorsId))!.length).toBeGreaterThanOrEqual(4);
      expect((await getClassPlacementRows(page, veteransId))!.length).toBeGreaterThanOrEqual(4);
      expect((await getClassPlacementRows(page, ladiesId))!.length).toBeGreaterThanOrEqual(4);

      expect(tournament.tables.length).toBe(8);
      expect(Object.keys(tournament.players).length).toBe(ROSTER.length);

      expect(log.some((c) => c.type === 'GenerateBracket')).toBe(true);
      await expectReplayRoundTrip(page);
    });
  });
});
