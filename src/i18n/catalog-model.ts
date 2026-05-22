import type { MessageEntry } from './types';

const e = (en: string): MessageEntry => ({ en, nl: '' });

/** Model-layer user-facing strings (returns and thrown errors surfaced in UI). */
export const modelCatalog = {
  'model.classificationHandicapsNotImplemented': e('Classification handicaps are not implemented yet'),
  'model.handicapMustBeIntegerInRange': e('Handicap must be an integer from {{min}} to {{max}}'),
  'model.unknownClassId': e('Unknown class id.'),
  'model.clearBracketPerClassTrack': e(
    'Clear the bracket from each class track when multiple competition classes are defined.',
  ),
  'model.noKnockoutBracketToRemove': e('No knockout bracket to remove.'),
  'model.tieBreakSaltRequired': e('tieBreakSalt is required.'),
  'model.bracketRoundLockedWithPeriod': e('Bracket round {{round}} is locked.'),
  'model.noOpenPairingsForElimination': e(
    'No open pairings in that round could be resolved by elimination.',
  ),
  'model.groupNumberedTitle': e('Group {{n}}'),
  'model.placeWord': e('place'),
  'model.bracketSlotPlaceLabel': e('{{group}} {{placeWord}} {{place}}'),
  'model.playerAlreadyOnTable': e('{{name}} is already playing another match{{tablePart}}'),
  'model.tableAlreadyHasMatch': e('That table already has a match in progress'),
  'model.tableNotConfigured': e('Table not configured for this tournament'),
  'model.cannotAssignCompletedMatch': e('Cannot assign a completed match to a table'),
} as const satisfies Record<string, MessageEntry>;
