import { catalog, type MessageKey } from './catalog';

/** Map legacy English model error strings to catalog keys (for transitional throws). */
const MODEL_ERROR_TO_KEY: Record<string, MessageKey> = {
  'Classification handicaps are not implemented yet': 'model.classificationHandicapsNotImplemented',
  'Unknown class id.': 'model.unknownClassId',
  'Clear the bracket from each class track when multiple competition classes are defined.':
    'model.clearBracketPerClassTrack',
  'No knockout bracket to remove.': 'model.noKnockoutBracketToRemove',
  'tieBreakSalt is required.': 'model.tieBreakSaltRequired',
  'No open pairings in that round could be resolved by elimination.': 'model.noOpenPairingsForElimination',
  'Match not found': 'command.matchNotFound',
  'Table not configured for this tournament': 'model.tableNotConfigured',
  'Cannot assign a completed match to a table': 'model.cannotAssignCompletedMatch',
  'That table already has a match in progress': 'model.tableAlreadyHasMatch',
  'Player not found': 'command.playerNotFound',
  'Team not found': 'command.teamNotFound',
  'Team group forfeits are not supported': 'command.teamGroupForfeitsNotSupported',
};

export function modelErrorToKey(message: string): MessageKey {
  if (message in catalog) return message as MessageKey;
  const direct = MODEL_ERROR_TO_KEY[message];
  if (direct) return direct;
  const locked = /^Bracket round (\d+) is locked\.$/.exec(message);
  if (locked) return 'model.bracketRoundLockedWithPeriod';
  const playing = /^(.+) is already playing another match(.*)$/.exec(message);
  if (playing) {
    return 'model.playerAlreadyOnTable';
  }
  return 'command.dynamicError';
}

export function modelErrorParams(message: string): Record<string, string> | undefined {
  const locked = /^Bracket round (\d+) is locked\.$/.exec(message);
  if (locked) return { round: locked[1]! };
  const playing = /^(.+) is already playing another match(.*)$/.exec(message);
  if (playing) return { name: playing[1]!, tablePart: playing[2]! };
  if (!MODEL_ERROR_TO_KEY[message] && !(message in catalog)) {
    return { message };
  }
  return undefined;
}
