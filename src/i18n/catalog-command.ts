import type { MessageEntry } from './types';

const e = (en: string): MessageEntry => ({ en, nl: '' });

/** Command-layer validation and failure messages. */
export const commandCatalog = {
  'command.commandIdAlreadyExists': e('Command ID already exists'),
  'command.missingDependency': e('Missing dependency: {{dep}}'),
  'command.cannotAppendUndo': e('Cannot append Undo'),
  'command.commandNotFound': e('Command not found'),
  'command.cannotReverseUndoWithLaterMutations': e(
    'Cannot reverse this Undo while later active mutations exist',
  ),
  'command.targetAlreadyUndone': e('Target is already undone'),
  'command.commandHasActiveDependents': e('Command has active dependents; cannot undo'),
  'command.nothingToRedo': e('Nothing to redo'),
  'command.nothingToUndo': e('Nothing to undo'),
  'command.playerAlreadyExists': e('Player already exists'),
  'command.playerNameAlreadyExists': e('A player with this name already exists'),
  'command.teamAlreadyExists': e('Team already exists'),
  'command.playerNotFoundWithId': e('Player not found: {{playerId}}'),
  'command.playerMatchesNotAllowedInTeamFixture': e(
    'Player matches are not allowed in a team vs team fixture',
  ),
  'command.matchAlreadyExists': e('Match already exists'),
  'command.playerNotFound': e('Player not found'),
  'command.teamVsTeamWithPlayerBracket': e(
    'Team vs team matches cannot be used alongside a player bracket',
  ),
  'command.onlyOneTeamVsTeamMatch': e('Only one team vs team match is allowed per tournament'),
  'command.teamMatchAlreadyExists': e('Team match already exists'),
  'command.teamNotFound': e('Team not found'),
  'command.teamCannotPlayItself': e('A team cannot play itself'),
  'command.matchNotFound': e('Match not found'),
  'command.matchDecidedWithoutScores': e(
    'This match was already decided without entering game scores (forfeit / elimination).',
  ),
  'command.bracketRoundLocked': e('Bracket round {{round}} is locked'),
  'command.bracketMatchCannotChange': e(
    'This bracket match cannot be changed: a later knockout match already has scores, or the round is locked.',
  ),
  'command.groupResultCannotChange': e(
    'This group result cannot be changed: a knockout match in this track already has recorded play.',
  ),
  'command.invalidScores': e(
    'Invalid scores: each game must finish at 11+ with a two-point margin, and the match must have a best-of-five winner (first to three games).',
  ),
  'command.noScoresToClear': e('No scores to clear'),
  'command.groupResultCannotClear': e(
    'This group result cannot be cleared: a knockout match in this track already has recorded play.',
  ),
  'command.eliminatedResultsCannotClear': e(
    'Eliminated results cannot be cleared here; use undo if applicable.',
  ),
  'command.bracketMatchCannotClear': e(
    'This bracket match cannot be cleared: a later knockout match already has scores, or the round is locked.',
  ),
  'command.teamMatchNotFound': e('Team match not found'),
  'command.teamGroupForfeitsNotSupported': e('Team group forfeits are not supported'),
  'command.invalidBracketRound': e('Invalid bracket round'),
  'command.cannotUnlockBracketRoundHasScores': e(
    'Cannot unlock: a match in this bracket round already has scores',
  ),
  'command.seedingsMustBeNonEmpty': e('Seedings must be a non-empty ordered player id list'),
  'command.unknownPlayerInSeedings': e('Unknown player in seedings: {{pid}}'),
  'command.invalidHandicapConfiguration': e('Invalid handicap configuration'),
  'command.classesMustBeArray': e('classes must be an array'),
  'command.classNeedsDisplayName': e('Each class needs a non-empty display name'),
  'command.duplicateClassId': e('Duplicate class id'),
  'command.defineTwoClassesBeforePlayers': e(
    'Define at least two competition classes before adding players.',
  ),
  'command.cannotChangeClassesWhilePlayersExist': e(
    'Cannot add or remove a competition class while players exist.',
  ),
  'command.flagsObjectRequired': e('flags object required'),
  'command.useSetClassGroupsFromClassTab': e(
    'Use SetClassGroups from each class tab when multiple competition classes are defined',
  ),
  'command.groupsNotAvailableWithTeamMatch': e(
    'Groups are not available alongside a team vs team match',
  ),
  'command.setGroupsPassOneOf': e(
    'SetGroups: pass one of groups, targetGroupSize, or targetGroupCount with playerIds',
  ),
  'command.playerIdsMustBeArray': e(
    'playerIds must be an array when using targetGroupSize or targetGroupCount',
  ),
  'command.unknownPlayer': e('Unknown player: {{pid}}'),
  'command.targetGroupSizePositive': e('targetGroupSize must be a positive integer'),
  'command.targetGroupCountPositive': e('targetGroupCount must be a positive integer'),
  'command.groupsMustBeArray': e('groups must be an array'),
  'command.setGroupsRequiresOneOf': e(
    'SetGroups requires groups, targetGroupSize + playerIds, or targetGroupCount + playerIds',
  ),
  'command.eachGroupNeedsId': e('Each group needs an id'),
  'command.duplicateGroupId': e('Duplicate group id'),
  'command.unknownPlayerInGroup': e('Unknown player in group {{id}}: {{pid}}'),
  'command.playerInMultipleGroups': e('Player {{pid}} cannot appear in more than one group'),
  'command.setClassGroupsOnlyWithMultipleClasses': e(
    'SetClassGroups is only used when multiple competition classes are defined',
  ),
  'command.unknownClassId': e('Unknown class id'),
  'command.classSliceNotFound': e('Class slice not found'),
  'command.setClassGroupsPassOneOf': e(
    'SetClassGroups: pass one of groups, targetGroupSize, or targetGroupCount with playerIds',
  ),
  'command.playerNotInClassSeedingList': e('Player {{pid}} is not in this class seeding list'),
  'command.setClassGroupsRequiresOneOf': e(
    'SetClassGroups requires groups, targetGroupSize + playerIds, or targetGroupCount + playerIds',
  ),
  'command.classIdRequiredForGroupMatches': e(
    'classId is required and must be valid to generate group matches for a class track',
  ),
  'command.classIdMustNotBeSetSingleClass': e(
    'classId must not be set when only one competition class is in use',
  ),
  'command.groupRoundRobinNotWithTeamMatch': e(
    'Group round robin is not available alongside a team vs team match',
  ),
  'command.defineGroupsBeforeRoundRobin': e('Define groups before generating round-robin matches'),
  'command.globalBracketDisabledMultiClass': e(
    'Global bracket is disabled when multiple competition classes are defined; generate a bracket from each class tab instead.',
  ),
  'command.cannotGenerateBracketWithTeamMatch': e(
    'Cannot generate bracket while a team vs team match exists',
  ),
  'command.cannotClearBracketWithTeamMatch': e(
    'Cannot clear bracket while a team vs team match exists',
  ),
  'command.globalBracketActionsDisabledMultiClass': e(
    'Global bracket actions are disabled when multiple competition classes are defined; use the class track controls instead.',
  ),
  'command.bracketEliminationNotWithTeamMatch': e(
    'Bracket elimination is not available alongside a team vs team match',
  ),
  'command.roundMustBePositive': e('round must be a positive integer'),
  'command.atLeastOneTableId': e('At least one table id is required'),
  'command.tableIdsMustBeArray': e('tableIds must be an array'),
  'command.matchIdAndTableIdRequired': e('matchId and tableId are required'),
  'command.matchIdRequired': e('matchId is required'),
  'command.matchNotAssignedToTable': e('Match is not assigned to a table'),
  'command.unknownCommandType': e('Unknown command type'),
  'command.dynamicError': e('{{message}}'),
  'command.replayFailed': e('Replay failed'),
  'command.invalidCommandFormat': e('invalid command format'),
} as const satisfies Record<string, MessageEntry>;
