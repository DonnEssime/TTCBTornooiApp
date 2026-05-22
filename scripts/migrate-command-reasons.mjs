import fs from 'fs';

const path = 'src/command.ts';
let s = fs.readFileSync(path, 'utf8');

const map = [
  ["return { success: false, reason: 'Command ID already exists' }", "return commandFail('command.commandIdAlreadyExists')"],
  ["return { success: false, reason: `Missing dependency: ${dep}` }", "return commandFail('command.missingDependency', { dep })"],
  ["return { success: false, reason: ok.reason ?? 'Cannot append Undo' }", "return commandFail(ok.reason ?? 'command.cannotAppendUndo', ok.reasonParams)"],
  ["return { success: false, reason: err }", "return commandFailFromText(err)"],
  ["return { ok: false, reason: 'Command not found' }", "return { ok: false, reason: 'command.commandNotFound' }"],
  ["reason: 'Cannot reverse this Undo while later active mutations exist'", "reason: 'command.cannotReverseUndoWithLaterMutations'"],
  ["return { ok: false, reason: 'Target is already undone' }", "return { ok: false, reason: 'command.targetAlreadyUndone' }"],
  ["return { ok: false, reason: 'Command has active dependents; cannot undo' }", "return { ok: false, reason: 'command.commandHasActiveDependents' }"],
  ["return { success: false, reason: 'Nothing to redo' }", "return commandFail('command.nothingToRedo')"],
  ["return { success: false, reason: 'Player already exists' }", "return commandFail('command.playerAlreadyExists')"],
  ["return { success: false, reason: 'A player with this name already exists' }", "return commandFail('command.playerNameAlreadyExists')"],
  ["return { success: false, reason: 'Team already exists' }", "return commandFail('command.teamAlreadyExists')"],
  ["return { success: false, reason: `Player not found: ${playerId}` }", "return commandFail('command.playerNotFoundWithId', { playerId })"],
  ["return { success: false, reason: 'Player matches are not allowed in a team vs team fixture' }", "return commandFail('command.playerMatchesNotAllowedInTeamFixture')"],
  ["return { success: false, reason: 'Match already exists' }", "return commandFail('command.matchAlreadyExists')"],
  ["return { success: false, reason: 'Player not found' }", "return commandFail('command.playerNotFound')"],
  ["return { success: false, reason: 'Team vs team matches cannot be used alongside a player bracket' }", "return commandFail('command.teamVsTeamWithPlayerBracket')"],
  ["return { success: false, reason: 'Only one team vs team match is allowed per tournament' }", "return commandFail('command.onlyOneTeamVsTeamMatch')"],
  ["return { success: false, reason: 'Team match already exists' }", "return commandFail('command.teamMatchAlreadyExists')"],
  ["return { success: false, reason: 'Team not found' }", "return commandFail('command.teamNotFound')"],
  ["return { success: false, reason: 'A team cannot play itself' }", "return commandFail('command.teamCannotPlayItself')"],
  ["return { success: false, reason: 'Match not found' }", "return commandFail('command.matchNotFound')"],
  ["reason: 'This match was already decided without entering game scores (forfeit / elimination).'", "reason: 'command.matchDecidedWithoutScores'"],
  ["return { success: false, reason: `Bracket round ${round} is locked` }", "return commandFail('command.bracketRoundLocked', { round: String(round) })"],
  ["reason:\n              'This bracket match cannot be changed: a later knockout match already has scores, or the round is locked.'", "reason: 'command.bracketMatchCannotChange'"],
  ["reason:\n                'This group result cannot be changed: a knockout match in this track already has recorded play.'", "reason: 'command.groupResultCannotChange'"],
  ["reason:\n              'Invalid scores: each game must finish at 11+ with a two-point margin, and the match must have a best-of-five winner (first to three games).'", "reason: 'command.invalidScores'"],
  ["return { success: false, reason: 'No scores to clear' }", "return commandFail('command.noScoresToClear')"],
  ["reason:\n                'This group result cannot be cleared: a knockout match in this track already has recorded play.'", "reason: 'command.groupResultCannotClear'"],
  ["return { success: false, reason: 'Eliminated results cannot be cleared here; use undo if applicable.' }", "return commandFail('command.eliminatedResultsCannotClear')"],
  ["reason:\n              'This bracket match cannot be cleared: a later knockout match already has scores, or the round is locked.'", "reason: 'command.bracketMatchCannotClear'"],
  ["return { success: false, reason: 'Team match not found' }", "return commandFail('command.teamMatchNotFound')"],
  ["return { success: false, reason: 'Team group forfeits are not supported' }", "return commandFail('command.teamGroupForfeitsNotSupported')"],
  ["return { success: false, reason: 'Invalid bracket round' }", "return commandFail('command.invalidBracketRound')"],
  ["return { success: false, reason: 'Cannot unlock: a match in this bracket round already has scores' }", "return commandFail('command.cannotUnlockBracketRoundHasScores')"],
  ["return { success: false, reason: 'Seedings must be a non-empty ordered player id list' }", "return commandFail('command.seedingsMustBeNonEmpty')"],
  ["return { success: false, reason: `Unknown player in seedings: ${pid}` }", "return commandFail('command.unknownPlayerInSeedings', { pid })"],
  ["return { success: false, reason: 'Invalid handicap configuration' }", "return commandFail('command.invalidHandicapConfiguration')"],
  ["return { success: false, reason: 'Classification handicaps are not implemented yet' }", "return commandFail('model.classificationHandicapsNotImplemented')"],
  ["return { success: false, reason: 'classes must be an array' }", "return commandFail('command.classesMustBeArray')"],
  ["return { success: false, reason: 'Each class needs a non-empty display name' }", "return commandFail('command.classNeedsDisplayName')"],
  ["return { success: false, reason: 'Duplicate class id' }", "return commandFail('command.duplicateClassId')"],
  ["reason: 'Define at least two competition classes before adding players.'", "reason: 'command.defineTwoClassesBeforePlayers'"],
  ["reason: 'Cannot add or remove a competition class while players exist.'", "reason: 'command.cannotChangeClassesWhilePlayersExist'"],
  ["return { success: false, reason: 'flags object required' }", "return commandFail('command.flagsObjectRequired')"],
  ["reason: 'Use SetClassGroups from each class tab when multiple competition classes are defined'", "reason: 'command.useSetClassGroupsFromClassTab'"],
  ["return { success: false, reason: 'Groups are not available alongside a team vs team match' }", "return commandFail('command.groupsNotAvailableWithTeamMatch')"],
  ["reason: 'SetGroups: pass one of groups, targetGroupSize, or targetGroupCount with playerIds'", "reason: 'command.setGroupsPassOneOf'"],
  ["reason: 'playerIds must be an array when using targetGroupSize or targetGroupCount'", "reason: 'command.playerIdsMustBeArray'"],
  ["return { success: false, reason: `Unknown player: ${pid}` }", "return commandFail('command.unknownPlayer', { pid })"],
  ["return { success: false, reason: 'targetGroupSize must be a positive integer' }", "return commandFail('command.targetGroupSizePositive')"],
  ["return { success: false, reason: 'targetGroupCount must be a positive integer' }", "return commandFail('command.targetGroupCountPositive')"],
  ["return { success: false, reason: 'groups must be an array' }", "return commandFail('command.groupsMustBeArray')"],
  ["reason: 'SetGroups requires groups, targetGroupSize + playerIds, or targetGroupCount + playerIds'", "reason: 'command.setGroupsRequiresOneOf'"],
  ["return { success: false, reason: 'Each group needs an id' }", "return commandFail('command.eachGroupNeedsId')"],
  ["return { success: false, reason: 'Duplicate group id' }", "return commandFail('command.duplicateGroupId')"],
  ["return { success: false, reason: `Unknown player in group ${id}: ${pid}` }", "return commandFail('command.unknownPlayerInGroup', { id, pid })"],
  ["return { success: false, reason: `Player ${pid} cannot appear in more than one group` }", "return commandFail('command.playerInMultipleGroups', { pid })"],
  ["return { success: false, reason: 'SetClassGroups is only used when multiple competition classes are defined' }", "return commandFail('command.setClassGroupsOnlyWithMultipleClasses')"],
  ["return { success: false, reason: 'Unknown class id' }", "return commandFail('command.unknownClassId')"],
  ["return { success: false, reason: 'Class slice not found' }", "return commandFail('command.classSliceNotFound')"],
  ["reason: 'SetClassGroups: pass one of groups, targetGroupSize, or targetGroupCount with playerIds'", "reason: 'command.setClassGroupsPassOneOf'"],
  ["return { success: false, reason: `Player ${pid} is not in this class seeding list` }", "return commandFail('command.playerNotInClassSeedingList', { pid })"],
  ["reason: 'SetClassGroups requires groups, targetGroupSize + playerIds, or targetGroupCount + playerIds'", "reason: 'command.setClassGroupsRequiresOneOf'"],
  ["reason: 'classId is required and must be valid to generate group matches for a class track'", "reason: 'command.classIdRequiredForGroupMatches'"],
  ["return { success: false, reason: 'classId must not be set when only one competition class is in use' }", "return commandFail('command.classIdMustNotBeSetSingleClass')"],
  ["return { success: false, reason: 'Group round robin is not available alongside a team vs team match' }", "return commandFail('command.groupRoundRobinNotWithTeamMatch')"],
  ["return { success: false, reason: 'Define groups before generating round-robin matches' }", "return commandFail('command.defineGroupsBeforeRoundRobin')"],
  ["reason:\n              'Global bracket is disabled when multiple competition classes are defined; generate a bracket from each class tab instead.'", "reason: 'command.globalBracketDisabledMultiClass'"],
  ["return { success: false, reason: 'Cannot generate bracket while a team vs team match exists' }", "return commandFail('command.cannotGenerateBracketWithTeamMatch')"],
  ["return { success: false, reason: e instanceof Error ? e.message : String(e) }", "return commandFail('command.dynamicError', { message: e instanceof Error ? e.message : String(e) })"],
  ["return { success: false, reason: 'Cannot clear bracket while a team vs team match exists' }", "return commandFail('command.cannotClearBracketWithTeamMatch')"],
  ["reason:\n              'Global bracket actions are disabled when multiple competition classes are defined; use the class track controls instead.'", "reason: 'command.globalBracketActionsDisabledMultiClass'"],
  ["return { success: false, reason: 'Bracket elimination is not available alongside a team vs team match' }", "return commandFail('command.bracketEliminationNotWithTeamMatch')"],
  ["return { success: false, reason: 'round must be a positive integer' }", "return commandFail('command.roundMustBePositive')"],
  ["return { success: false, reason: 'At least one table id is required' }", "return commandFail('command.atLeastOneTableId')"],
  ["return { success: false, reason: 'tableIds must be an array' }", "return commandFail('command.tableIdsMustBeArray')"],
  ["return { success: false, reason: 'matchId and tableId are required' }", "return commandFail('command.matchIdAndTableIdRequired')"],
  ["return { success: false, reason: 'matchId is required' }", "return commandFail('command.matchIdRequired')"],
  ["return { success: false, reason: 'Match is not assigned to a table' }", "return commandFail('command.matchNotAssignedToTable')"],
  ["return { success: false, reason: 'Unknown command type' }", "return commandFail('command.unknownCommandType')"],
  ["return r.reason ?? 'Replay failed'", "return r.reason ?? 'command.dynamicError'"],
];

for (const [from, to] of map) {
  if (!s.includes(from)) {
    console.warn('MISSING:', from.slice(0, 60));
  } else {
    s = s.split(from).join(to);
  }
}

// hcErr and err from model
s = s.replace(
  /return \{ success: false, reason: hcErr \};/g,
  "return commandFail(hcErr.key, hcErr.params);",
);
s = s.replace(
  /if \(err\) \{\s*return \{ success: false, reason: err \};/g,
  'if (err) {\n          return commandFail(err.key, err.params);',
);

s = s.replace(
  'canAppendUndo(targetCommandId: string): { ok: boolean; reason?: string }',
  'canAppendUndo(targetCommandId: string): UndoCheckResult',
);
s = s.replace('private rebuildFromLog(): string | undefined', 'private rebuildFromLog(): MessageKey | undefined');

fs.writeFileSync(path, s);
console.log('done');
