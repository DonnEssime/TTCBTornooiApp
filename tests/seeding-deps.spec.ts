import { describe, expect, it } from 'vitest';
import {
  findCreatePlayerCommandId,
  seedingDepsForAddedPlayer,
  seedingDepsForBatchAddedPlayers,
} from '../src/command';
import { TournamentController } from '../src/controller';

describe('seedingDepsForAddedPlayer', () => {
  it('chains from last SetSeedings when create command ids are not cmd-{playerId}', () => {
    const c = new TournamentController();
    expect(c.createPlayer('p1', 'A', 0, '', 'cp-p1')).toEqual({ success: true });
    expect(c.setSeedings(['p1'], ['cp-p1'], 'seed1')).toEqual({ success: true });
    expect(c.createPlayer('p2', 'B', 0, '', 'cp-p2')).toEqual({ success: true });

    const log = c.getCommandLog();
    const deps = seedingDepsForAddedPlayer(log, ['p1'], 'p2', 'seed1');
    expect(deps.sort()).toEqual(['cp-p2', 'seed1'].sort());
    expect(c.setSeedings(['p1', 'p2'], deps, 'seed2')).toEqual({ success: true });

    const broken = c.setSeedings(['p1', 'p2'], ['cmd-p1', 'cmd-p2'], 'seed-broken');
    expect(broken.success).toBe(false);
    expect(broken.reason).toBe('command.missingDependency');
  });

  it('resolves create command ids from the log when there is no prior SetSeedings', () => {
    const log = [
      { id: 'cp-a', type: 'CreatePlayer', payload: { playerId: 'a' } },
      { id: 'cp-b', type: 'CreatePlayer', payload: { playerId: 'b' } },
    ];
    expect(findCreatePlayerCommandId(log, 'a')).toBe('cp-a');
    const deps = seedingDepsForBatchAddedPlayers(log, ['a'], ['b'], '');
    expect(deps.sort()).toEqual(['cp-a', 'cp-b'].sort());
  });
});
