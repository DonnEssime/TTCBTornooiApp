import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/test-fixture';
import { importJsonlAndOpen } from './helpers/importExport';
import { expectReplayRoundTrip, readBackend, snapshotClassBracket } from './helpers/backend';
import { addCompetitionClass, setPlayerClassFlag } from './helpers/classes';
import { createClassGroupsByPlayerCount } from './helpers/groups';
import { addPlayer, assignPlayerToGroup } from './helpers/players';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Keep in sync with tests/late-add-class-groups.spec.ts (seed 0x4c417e). */
const LATE_ADD_SUBSET_NAMES = ['P10', 'P11', 'P12', 'P13', 'P14', 'P16', 'P17', 'P18', 'P20', 'P9'];
const LATE_ADD_SUBSET_IDS = ['p10', 'p11', 'p12', 'p13', 'p14', 'p16', 'p17', 'p18', 'p20', 'p9'];

test.describe('17 late-add class with groups', () => {
  test('adds late class, groups, and assigns latecomer to existing group', async ({ page }) => {
    await importJsonlAndOpen(page, path.join(fixturesDir, 'multi-class-jun-finished.jsonl'));
    const junBefore = await snapshotClassBracket(page, 'jun');

    await addCompetitionClass(page, 'Veteran');
    await page.getByTestId('tab-players').click();
    for (const name of LATE_ADD_SUBSET_NAMES) {
      await setPlayerClassFlag(page, name, 'Veteran', true);
    }

    await createClassGroupsByPlayerCount(page, 'Veteran', 4);
    await addPlayer(page, 'Latecomer');
    await setPlayerClassFlag(page, 'Latecomer', 'Veteran', true);

    const { tournament: beforeAssign } = await readBackend(page);
    const vetId = beforeAssign.classDefinitions.find((d) => d.name === 'Veteran')!.id;
    const latecomerId = Object.entries(beforeAssign.players).find(([, p]) => p.name === 'Latecomer')?.[0];
    expect(latecomerId).toBeDefined();

    const groupBefore = beforeAssign.classTournaments[vetId]!.groups['1']!.playerIds.slice();
    expect(groupBefore.length).toBe(5);

    await assignPlayerToGroup(page, 'Latecomer', '1', 'Veteran');

    const { tournament, log } = await readBackend(page);

    expect(tournament.classDefinitions.some((d) => d.name === 'Veteran')).toBe(true);
    expect(tournament.classTournaments[vetId]).toBeDefined();

    const vetSeedings = tournament.classTournaments[vetId]!.seedings.slice().sort();
    expect(vetSeedings).toEqual([...LATE_ADD_SUBSET_IDS, latecomerId!].sort());

    expect(tournament.playerClassFlags[latecomerId!]![vetId]).toBe(true);
    expect(tournament.playerClassFlags[latecomerId!]!.jun).toBe(false);
    expect(tournament.playerClassFlags[latecomerId!]!.sen).toBe(false);

    const vetGroups = tournament.classTournaments[vetId]!.groups;
    expect(Object.keys(vetGroups)).toHaveLength(2);
    const group1 = vetGroups['1']!;
    expect(group1.playerIds).toContain(latecomerId);
    expect(group1.playerIds).toHaveLength(6);

    for (const x of groupBefore) {
      const sorted = [latecomerId!, x].sort();
      const mid = `gm-${vetId}-1-${sorted[0]}-${sorted[1]}`;
      const m = tournament.matches[mid];
      expect(m, mid).toBeDefined();
      expect(m!.status).toBe('scheduled');
      expect(m!.classId).toBe(vetId);
    }

    expect(await snapshotClassBracket(page, 'jun')).toBe(junBefore);
    expect(Object.keys(tournament.classTournaments.sen!.groups)).toHaveLength(0);

    expect(log.some((c) => c.type === 'AddTournamentClass')).toBe(true);
    expect(log.some((c) => c.type === 'SetClassGroups')).toBe(true);
    expect(log.some((c) => c.type === 'SetPlayerGroup')).toBe(true);

    await expectReplayRoundTrip(page);
  });
});
