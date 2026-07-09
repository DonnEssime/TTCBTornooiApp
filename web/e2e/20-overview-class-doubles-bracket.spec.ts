import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from './fixtures/test-fixture';
import { CommandRunner } from '../../src/command';
import { exportCommandsAsJsonLines } from '../../src/storage';
import { importJsonlAndOpen } from './helpers/importExport';
import { goToOverviewTab } from './helpers/overview';

const BO3 = [
  { playerA: 11, playerB: 5 },
  { playerA: 11, playerB: 7 },
  { playerA: 11, playerB: 3 },
];

function buildClassDoublesTopFourFixture(): string {
  const runner = new CommandRunner();
  const commands: Array<Parameters<CommandRunner['execute']>[0]> = [];
  const ts = '2026-01-01T00:00:00.000Z';
  const classId = 'jun';
  const exec = (command: Parameters<CommandRunner['execute']>[0]) => {
    commands.push(structuredClone(command));
    runner.execute(command);
  };

  exec({
    id: 'classes',
    type: 'SetTournamentClasses',
    dependsOn: [],
    payload: { classes: [{ id: classId, name: 'Junior' }] },
    timestamp: ts,
  });

  const playerIds: string[] = [];
  for (let i = 1; i <= 16; i++) {
    const playerId = `p${i}`;
    playerIds.push(playerId);
    exec({
      id: `create-${playerId}`,
      type: 'CreatePlayer',
      dependsOn: [],
      payload: { playerId, name: `P${i}`, handicap: 0 },
      timestamp: ts,
    });
  }

  exec({
    id: 'seed',
    type: 'SetSeedings',
    dependsOn: playerIds.map((id) => `create-${id}`),
    payload: { playerIds },
    timestamp: ts,
  });

  for (const playerId of playerIds) {
    exec({
      id: `flag-${playerId}`,
      type: 'SetPlayerClassFlags',
      dependsOn: [`create-${playerId}`],
      payload: { playerId, flags: { [classId]: true } },
      timestamp: ts,
    });
  }

  exec({
    id: 'groups',
    type: 'SetClassGroups',
    dependsOn: ['seed', ...playerIds.map((id) => `flag-${id}`)],
    payload: {
      classId,
      targetGroupSize: 4,
      playerIds,
      format: 'doubles-random-partners',
    },
    timestamp: ts,
  });

  const groupMatches = Object.values(runner.getTournament().matches)
    .filter((m) => m.groupId && m.classId === classId)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const match of groupMatches) {
    exec({
      id: `score-${match.id}`,
      type: 'EnterScore',
      dependsOn: [],
      payload: { matchId: match.id, scores: BO3 },
      timestamp: ts,
    });
  }

  exec({
    id: 'gen',
    type: 'GenerateBracket',
    dependsOn: ['groups'],
    payload: {
      fillByes: true,
      cullToPowerOfTwo: false,
      classId,
      qualifierCount: 4,
      bracketSeedingMode: 'crop_closed_form',
      tieBreakSalt: 'e2e-overview',
    },
    timestamp: ts,
  });

  return exportCommandsAsJsonLines(commands);
}

test.describe('20 overview class doubles bracket', () => {
  test('opening a ready class doubles bracket match from Overview opens the score modal', async ({ page }) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ttc-overview-doubles-'));
    const filePath = path.join(dir, 'overview-class-doubles-top4.jsonl');
    writeFileSync(filePath, buildClassDoublesTopFourFixture(), 'utf8');

    await importJsonlAndOpen(page, filePath);
    await goToOverviewTab(page);
    const ready = page.locator('.ov-ready-btn').first();
    await expect(ready).toBeVisible();
    await ready.click();
    await expect(page.getByTestId('score-modal')).toBeVisible();
  });
});
