import type { MessageEntry } from './types';

const e = (en: string): MessageEntry => ({ en, nl: '' });
const t = (en: string, nl: string): MessageEntry => ({ en, nl });

/** Model-layer user-facing strings (returns and thrown errors surfaced in UI). */
export const modelCatalog = {
  'model.classificationHandicapsNotImplemented': t(
    'Classification handicaps are not implemented yet',
    'Classificatiehandicaps zijn nog niet geïmplementeerd',
  ),
  'model.handicapMustBeIntegerInRange': t(
    'Handicap must be an integer from {{min}} to {{max}}',
    'Handicap moet een geheel getal zijn van {{min}} tot {{max}}',
  ),
  'model.unknownClassId': t('Unknown class id.', 'Onbekend reeks-id.'),
  'model.clearBracketPerClassTrack': t(
    'Clear the bracket from each class track when multiple competition classes are defined.',
    'Wis het knockout-schema per klasse wanneer er meerdere competitieklassen zijn ingesteld.',
  ),
  'model.noKnockoutBracketToRemove': t(
    'No knockout bracket to remove.',
    'Geen knockout-bracket om te verwijderen.',
  ),
  'model.tieBreakSaltRequired': t('tieBreakSalt is required.', 'tieBreakSalt is verplicht.'),
  'model.bracketRoundLockedWithPeriod': t(
    'Bracket round {{round}} is locked.',
    'Knockoutronde {{round}} is vergrendeld.',
  ),
  'model.noOpenPairingsForElimination': t(
    'No open pairings in that round could be resolved by elimination.',
    'In die ronde konden geen open koppels via eliminatie worden afgehandeld.',
  ),
  'model.groupNumberedTitle': t('Group {{n}}', 'Poule {{n}}'),
  'model.placeWord': t('place', 'plaats'),
  'model.bracketSlotPlaceLabel': t(
    '{{group}} {{placeWord}} {{place}}',
    '{{group}} {{placeWord}} {{place}}',
  ),
  'model.playerAlreadyOnTable': t(
    '{{name}} is already playing another match{{tablePart}}',
    '{{name}} speelt al een andere wedstrijd{{tablePart}}',
  ),
  'model.tableAlreadyHasMatch': t(
    'That table already has a match in progress',
    'Op die tafel loopt al een wedstrijd',
  ),
  'model.tableNotConfigured': t(
    'Table not configured for this tournament',
    'Tafel is niet geconfigureerd voor dit tornooi',
  ),
  'model.cannotAssignCompletedMatch': t(
    'Cannot assign a completed match to a table',
    'Je kunt een afgelopen wedstrijd niet aan een tafel toewijzen',
  ),
} as const satisfies Record<string, MessageEntry>;
