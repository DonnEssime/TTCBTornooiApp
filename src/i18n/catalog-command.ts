import type { MessageEntry } from './types';

const t = (en: string, nl: string): MessageEntry => ({ en, nl });
const e = (en: string): MessageEntry => ({ en, nl: '' });

/** Command-layer validation and failure messages. */
export const commandCatalog = {
  'command.commandIdAlreadyExists': t('Command ID already exists', 'De opdracht-ID bestaat al'),
  'command.missingDependency': t('Missing dependency: {{dep}}', 'Ontbrekende afhankelijkheid: {{dep}}'),
  'command.cannotAppendUndo': t('Cannot append Undo', 'Kan geen ongedaanmaking toevoegen'),
  'command.commandNotFound': t('Command not found', 'Opdracht niet gevonden'),
  'command.cannotReverseUndoWithLaterMutations': t(
    'Cannot reverse this Undo while later active mutations exist',
    'Deze ongedaanmaking kan niet worden teruggedraaid zolang er latere actieve wijzigingen zijn',
  ),
  'command.targetAlreadyUndone': t('Target is already undone', 'Doel is al ongedaan gemaakt'),
  'command.commandHasActiveDependents': t(
    'Command has active dependents; cannot undo',
    'De opdracht heeft actieve afhankelijkheden; ongedaan maken is niet mogelijk',
  ),
  'command.nothingToRedo': t('Nothing to redo', 'Niets om opnieuw uit te voeren'),
  'command.nothingToUndo': t('Nothing to undo', 'Niets om ongedaan te maken'),
  'command.playerAlreadyExists': t('Player already exists', 'Speler bestaat al'),
  'command.playerNameAlreadyExists': t(
    'A player with this name already exists',
    'Er bestaat al een speler met deze naam',
  ),
  'command.playerNameMiscAlreadyExists': t(
    'A player with this name and {{label}} already exists',
    'Er bestaat al een speler met deze naam en {{label}}',
  ),
  'command.playerMiscRequired': t(
    '{{label}} is required for each player',
    '{{label}} is verplicht voor elke speler',
  ),
  'command.invalidMiscConfiguration': t(
    'Invalid misc field configuration',
    'Ongeldige configuratie voor extra veld',
  ),
  'command.teamAlreadyExists': t('Team already exists', 'Ploeg bestaat al'),
  'command.playerNotFoundWithId': t('Player not found: {{playerId}}', 'Speler niet gevonden: {{playerId}}'),
  'command.playerMatchesNotAllowedInTeamFixture': t(
    'Player matches are not allowed in a team vs team fixture',
    'Spelerswedstrijden zijn niet toegestaan in een ploeg-tegen-ploeg-onderdeel',
  ),
  'command.matchAlreadyExists': t('Match already exists', 'Wedstrijd bestaat al'),
  'command.playerNotFound': t('Player not found', 'Speler niet gevonden'),
  'command.teamVsTeamWithPlayerBracket': t(
    'Team vs team matches cannot be used alongside a player bracket',
    'Ploeg-tegen-ploeg-wedstrijden kunnen niet samen met een spelerstabel worden gebruikt',
  ),
  'command.onlyOneTeamVsTeamMatch': t(
    'Only one team vs team match is allowed per tournament',
    'Slechts één ploeg-tegen-ploeg-wedstrijd is toegestaan per tornooi',
  ),
  'command.teamMatchAlreadyExists': t('Team match already exists', 'Ploegwedstrijd bestaat al'),
  'command.teamNotFound': t('Team not found', 'Ploeg niet gevonden'),
  'command.teamCannotPlayItself': t('A team cannot play itself', 'Een ploeg kan niet tegen zichzelf spelen'),
  'command.matchNotFound': t('Match not found', 'Wedstrijd niet gevonden'),
  'command.matchDecidedWithoutScores': t(
    'This match was already decided without entering game scores (forfeit / elimination).',
    'Deze wedstrijd is al beslist zonder gamescores in te geven (opgeven / eliminatie).',
  ),
  'command.bracketRoundLocked': t('{{round}} is locked', '{{round}} is vergrendeld'),
  'command.bracketMatchCannotChange': t(
    'This bracket match cannot be changed: a later knockout match already has scores, or the round is locked.',
    'Deze afvallingswedstrijd kan niet worden gewijzigd: een latere knockoutwedstrijd heeft al scores, of de ronde is vergrendeld.',
  ),
  'command.groupResultCannotChange': t(
    'This group result cannot be changed: a knockout match in this track already has recorded play.',
    'Dit groepsresultaat kan niet worden gewijzigd: een knockoutwedstrijd in dit traject heeft al gespeelde partiën.',
  ),
  'command.invalidScores': t(
    'Invalid scores: each game must finish at 11+ with a two-point margin, and the match must have a best-of-five winner (first to three games).',
    'Ongeldige scores: elke game moet eindigen op 11+ met twee punten voorsprong, en de wedstrijd moet een best-of-five-winnaar hebben (eerste tot drie games).',
  ),
  'command.noScoresToClear': t('No scores to clear', 'Geen scores om te wissen'),
  'command.groupResultCannotClear': t(
    'This group result cannot be cleared: a knockout match in this track already has recorded play.',
    'Dit groepsresultaat kan niet worden gewist: een knockoutwedstrijd in dit traject heeft al gespeelde partiën.',
  ),
  'command.eliminatedResultsCannotClear': t(
    'Eliminated results cannot be cleared here; use undo if applicable.',
    'Geëlimineerde resultaten kunnen hier niet worden gewist; gebruik ongedaan maken indien van toepassing.',
  ),
  'command.bracketMatchCannotClear': t(
    'This bracket match cannot be cleared: a later knockout match already has scores, or the round is locked.',
    'Deze afvallingswedstrijd kan niet worden gewist: een latere knockoutwedstrijd heeft al scores, of de ronde is vergrendeld.',
  ),
  'command.teamMatchNotFound': t('Team match not found', 'Ploegwedstrijd niet gevonden'),
  'command.teamGroupForfeitsNotSupported': t(
    'Team group forfeits are not supported',
    'Opgeven in ploeggroepen wordt niet ondersteund',
  ),
  'command.invalidBracketRound': t('Invalid bracket round', 'Ongeldige afvallingsronde'),
  'command.cannotUnlockBracketRoundHasScores': t(
    'Cannot unlock: a match in this bracket round already has scores',
    'Kan niet ontgrendelen: een wedstrijd in deze afvallingsronde heeft al scores',
  ),
  'command.seedingsMustBeNonEmpty': t(
    'Seedings must be a non-empty ordered player id list',
    'Rangschikking moet een niet-lege geordende lijst van speler-ID\'s zijn',
  ),
  'command.unknownPlayerInSeedings': t('Unknown player in seedings: {{pid}}', 'Onbekende speler in rangschikking: {{pid}}'),
  'command.invalidHandicapConfiguration': t(
    'Invalid handicap configuration',
    'Ongeldige handicapconfiguratie',
  ),
  'command.classesMustBeArray': t('classes must be an array', 'classes moet een array zijn'),
  'command.classNeedsDisplayName': t(
    'Each class needs a non-empty display name',
    'Elke reeks heeft een niet-lege weergavenaam nodig',
  ),
  'command.duplicateClassId': t('Duplicate class id', 'Dubbele reeks-ID'),
  'command.defineTwoClassesBeforePlayers': t(
    'Define at least two competition classes before adding players.',
    'Definieer minstens twee reeksen voordat je spelers toevoegt.',
  ),
  'command.cannotChangeClassesWhilePlayersExist': t(
    'Cannot add or remove a competition class while players exist.',
    'Kan geen wedstrijdreeks toevoegen of verwijderen zolang er spelers zijn.',
  ),
  'command.flagsObjectRequired': t('flags object required', 'flags-object is verplicht'),
  'command.useSetClassGroupsFromClassTab': t(
    'Use SetClassGroups from each class tab when multiple competition classes are defined',
    'Gebruik SetClassGroups vanuit elk reekstabblad wanneer meerdere reeksen zijn gedefinieerd',
  ),
  'command.groupsNotAvailableWithTeamMatch': t(
    'Groups are not available alongside a team vs team match',
    'Groepen zijn niet beschikbaar naast een ploeg-tegen-ploeg-wedstrijd',
  ),
  'command.setGroupsPassOneOf': t(
    'SetGroups: pass one of groups, targetGroupSize, or targetGroupCount with playerIds',
    'SetGroups: geef één van groups, targetGroupSize of targetGroupCount door met playerIds',
  ),
  'command.playerIdsMustBeArray': t(
    'playerIds must be an array when using targetGroupSize or targetGroupCount',
    'playerIds moet een array zijn bij gebruik van targetGroupSize of targetGroupCount',
  ),
  'command.unknownPlayer': t('Unknown player: {{pid}}', 'Onbekende speler: {{pid}}'),
  'command.targetGroupSizePositive': t(
    'targetGroupSize must be a positive integer',
    'targetGroupSize moet een positief geheel getal zijn',
  ),
  'command.targetGroupCountPositive': t(
    'targetGroupCount must be a positive integer',
    'targetGroupCount moet een positief geheel getal zijn',
  ),
  'command.groupsMustBeArray': t('groups must be an array', 'groups moet een array zijn'),
  'command.setGroupsRequiresOneOf': t(
    'SetGroups requires groups, targetGroupSize + playerIds, or targetGroupCount + playerIds',
    'SetGroups vereist groups, targetGroupSize + playerIds, of targetGroupCount + playerIds',
  ),
  'command.eachGroupNeedsId': t('Each group needs an id', 'Elke groep heeft een id nodig'),
  'command.duplicateGroupId': t('Duplicate group id', 'Dubbele groep-ID'),
  'command.unknownPlayerInGroup': t(
    'Unknown player in group {{id}}: {{pid}}',
    'Onbekende speler in groep {{id}}: {{pid}}',
  ),
  'command.playerInMultipleGroups': t(
    'Player {{pid}} cannot appear in more than one group',
    'Speler {{pid}} mag niet in meer dan één groep staan',
  ),
  'command.setClassGroupsOnlyWithMultipleClasses': t(
    'SetClassGroups is only used when multiple competition classes are defined',
    'SetClassGroups wordt alleen gebruikt wanneer meerdere reeksen zijn gedefinieerd',
  ),
  'command.unknownClassId': t('Unknown class id', 'Onbekende reeks-ID'),
  'command.classSliceNotFound': t('Class slice not found', 'Reeksdeel niet gevonden'),
  'command.setClassGroupsPassOneOf': t(
    'SetClassGroups: pass one of groups, targetGroupSize, or targetGroupCount with playerIds',
    'SetClassGroups: geef één van groups, targetGroupSize of targetGroupCount door met playerIds',
  ),
  'command.playerNotInClassSeedingList': t(
    'Player {{pid}} is not in this class seeding list',
    'Speler {{pid}} staat niet in deze reeksrangschikking',
  ),
  'command.setClassGroupsRequiresOneOf': t(
    'SetClassGroups requires groups, targetGroupSize + playerIds, or targetGroupCount + playerIds',
    'SetClassGroups vereist groups, targetGroupSize + playerIds, of targetGroupCount + playerIds',
  ),
  'command.classIdRequiredForGroupMatches': t(
    'classId is required and must be valid to generate group matches for a class track',
    'classId is verplicht en moet geldig zijn om poule-wedstrijden te genereren voor een reekstraject',
  ),
  'command.classIdMustNotBeSetSingleClass': t(
    'classId must not be set when only one competition class is in use',
    'classId mag niet worden ingesteld wanneer slechts één wedstrijdreeks in gebruik is',
  ),
  'command.groupRoundRobinNotWithTeamMatch': t(
    'Group round robin is not available alongside a team vs team match',
    'Groeps-round robin is niet beschikbaar naast een ploeg-tegen-ploeg-wedstrijd',
  ),
  'command.defineGroupsBeforeRoundRobin': t(
    'Define groups before generating round-robin matches',
    'Definieer groepen voordat je round-robin-wedstrijden genereert',
  ),
  'command.globalBracketDisabledMultiClass': t(
    'Global bracket is disabled when multiple competition classes are defined; generate a bracket from each class tab instead.',
    'Globale afvallingstabel is uitgeschakeld wanneer meerdere reeksen zijn gedefinieerd; genereer in plaats daarvan een afvallingstabel vanuit elk reekstabblad.',
  ),
  'command.cannotGenerateBracketWithTeamMatch': t(
    'Cannot generate bracket while a team vs team match exists',
    'Kan geen afvallingstabel genereren zolang er een ploeg-tegen-ploeg-wedstrijd bestaat',
  ),
  'command.cannotClearBracketWithTeamMatch': t(
    'Cannot clear bracket while a team vs team match exists',
    'Kan afvallingstabel niet wissen zolang er een ploeg-tegen-ploeg-wedstrijd bestaat',
  ),
  'command.globalBracketActionsDisabledMultiClass': t(
    'Global bracket actions are disabled when multiple competition classes are defined; use the class track controls instead.',
    'Globale afvallingsacties zijn uitgeschakeld wanneer meerdere reeksen zijn gedefinieerd; gebruik in plaats daarvan de bediening per reekstraject.',
  ),
  'command.bracketEliminationNotWithTeamMatch': t(
    'Bracket elimination is not available alongside a team vs team match',
    'Bracketeliminatie is niet beschikbaar naast een ploeg-tegen-ploeg-wedstrijd',
  ),
  'command.roundMustBePositive': t('round must be a positive integer', 'round moet een positief geheel getal zijn'),
  'command.atLeastOneTableId': t('At least one table id is required', 'Minstens één tafel-ID is verplicht'),
  'command.tableIdsMustBeArray': t('tableIds must be an array', 'tableIds moet een array zijn'),
  'command.matchIdAndTableIdRequired': t(
    'matchId and tableId are required',
    'matchId en tableId zijn verplicht',
  ),
  'command.matchIdRequired': t('matchId is required', 'matchId is verplicht'),
  'command.matchNotAssignedToTable': t(
    'Match is not assigned to a table',
    'Wedstrijd is niet aan een tafel toegewezen',
  ),
  'command.unknownCommandType': t('Unknown command type', 'Onbekend opdrachttype'),
  'command.dynamicError': e('{{message}}'),
  'command.replayFailed': t('Replay failed', 'Opnieuw afspelen mislukt'),
  'command.invalidCommandFormat': t('invalid command format', 'ongeldig opdrachtformaat'),
} as const satisfies Record<string, MessageEntry>;
