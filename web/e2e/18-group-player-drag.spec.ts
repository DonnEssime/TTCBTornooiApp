import { test, expect } from './fixtures/test-fixture';
import { createMinimalTournament } from './helpers/wizard';
import { debugFillPlayers } from './helpers/players';
import {
  createGroupsByPlayerCount,
  dragPlayerToGroup,
  goToGroupsTab,
  openFirstGroupCell,
} from './helpers/groups';
import { fillBo5WinnerA, saveScoreModal } from './helpers/scores';
import { expectReplayRoundTrip, readBackend } from './helpers/backend';

test.describe('18 group player drag', () => {
  test.beforeEach(async ({ page }) => {
    await createMinimalTournament(page);
    await debugFillPlayers(page, 8);
    await createGroupsByPlayerCount(page, 4);
  });

  test('drags player between groups before any group match is played', async ({ page }) => {
    const { tournament: before } = await readBackend(page);
    const groupIds = Object.keys(before.groups).sort((a, b) => Number(a) - Number(b));
    expect(groupIds.length).toBeGreaterThanOrEqual(2);
    const fromGroupId = groupIds[0]!;
    const toGroupId = groupIds[1]!;
    const playerId = before.groups[fromGroupId]!.playerIds[0]!;
    expect(before.groups[toGroupId]!.playerIds).not.toContain(playerId);

    await dragPlayerToGroup(page, playerId, toGroupId);

    const { tournament: after, log } = await readBackend(page);
    expect(after.groups[fromGroupId]!.playerIds).not.toContain(playerId);
    expect(after.groups[toGroupId]!.playerIds).toContain(playerId);
    expect(log.some((c) => c.type === 'SetPlayerGroup' && c.payload.playerId === playerId)).toBe(true);
    await expectReplayRoundTrip(page);
  });

  test('blocks dragging a player who has played a group match', async ({ page }) => {
    await openFirstGroupCell(page);
    await fillBo5WinnerA(page);
    await saveScoreModal(page);

    const { tournament } = await readBackend(page);
    const finished = Object.values(tournament.matches).find(
      (m) => m.id.startsWith('gm-') && m.status === 'finished',
    );
    expect(finished).toBeTruthy();
    const playedPlayerId = finished!.playerA;
    const fromGroupId = Object.values(tournament.groups).find((g) =>
      g.playerIds.includes(playedPlayerId),
    )!.id;
    const toGroupId = Object.keys(tournament.groups).find((id) => id !== fromGroupId)!;

    await goToGroupsTab(page);
    const dragHandle = page.getByTestId(`group-player-drag-${playedPlayerId}`);
    await expect(dragHandle).toHaveAttribute('draggable', 'false');

    const groupsBefore = structuredClone(tournament.groups);
    await dragPlayerToGroup(page, playedPlayerId, toGroupId);
    const { tournament: after, log } = await readBackend(page);
    expect(after.groups).toEqual(groupsBefore);
    expect(log.filter((c) => c.type === 'SetPlayerGroup' && c.payload.playerId === playedPlayerId)).toHaveLength(
      0,
    );
  });
});
