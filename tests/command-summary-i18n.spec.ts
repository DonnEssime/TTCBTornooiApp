import { describe, it, expect } from 'vitest';
import type { CommandType } from '../src/command';
import { catalog } from '../src/i18n/catalog';

/** Primary footer summary key per command (variant keys for branches are listed separately). */
const FOOTER_SUMMARY_KEYS: string[] = [
  'ui.noActionsYet',
  'ui.summary.addedPlayer',
  'ui.summary.updatedPlayer',
  'ui.summary.setSeeding',
  'ui.summary.disabledHandicap',
  'ui.summary.disabledMisc',
  'ui.summary.enabledDebugMode',
  'ui.summary.disabledDebugMode',
  'ui.summary.miscConfig',
  'ui.summary.handicapConfig',
  'ui.summary.enteredScores',
  'ui.summary.enteredMatchScores',
  'ui.summary.clearedScores',
  'ui.summary.clearedMatchScores',
  'ui.summary.enteredTeamScores',
  'ui.summary.enteredTeamMatchScores',
  'ui.summary.createdMatch',
  'ui.summary.createdTeam',
  'ui.summary.createdTeamMatch',
  'ui.summary.generatedBracket',
  'ui.summary.removedBracket',
  'ui.summary.eliminatedRound',
  'ui.summary.generatedRoundRobin',
  'ui.summary.generatedRoundRobinClass',
  'ui.summary.clearedGroups',
  'ui.summary.updatedGroupsOne',
  'ui.summary.updatedGroupsMany',
  'ui.summary.createdGroupsFromSeeding',
  'ui.summary.clearedGroupsForClass',
  'ui.summary.updatedGroupsForClass',
  'ui.summary.createdGroupsForClass',
  'ui.summary.setCompetitionClasses',
  'ui.summary.addedCompetitionClass',
  'ui.summary.updatedClassFlags',
  'ui.summary.lockedRound',
  'ui.summary.unlockedRound',
  'ui.summary.assignedTables',
  'ui.summary.setUpTables',
  'ui.summary.startedOnTable',
  'ui.summary.assignedMatchToTable',
  'ui.summary.clearedTable',
  'ui.summary.clearedTableAssignment',
  'ui.summary.advancedBracketRound',
  'ui.summary.playerForfeit',
  'ui.summary.teamForfeit',
  'ui.summary.undo',
  'ui.summary.seedingClosedForm',
  'ui.summary.seedingExtendedClosedForm',
  'ui.summary.seedingHeuristic',
  'ui.summary.critMinusPoints',
  'ui.summary.critHeadstart',
  'ui.phase.group',
  'ui.phase.bracket',
  'ui.summary.unhandledCommand',
];

const COMMAND_TYPES: CommandType[] = [
  'CreatePlayer',
  'CreateTeam',
  'CreateMatch',
  'CreateTeamMatch',
  'EnterScore',
  'ClearMatchScores',
  'EnterTeamScore',
  'PlayerForfeit',
  'TeamForfeit',
  'SetRoundLock',
  'SetSeedings',
  'SetHandicapConfig',
  'SetMiscConfig',
  'SetDebugMode',
  'SetTournamentClasses',
  'AddTournamentClass',
  'SetPlayerClassFlags',
  'SetGroups',
  'SetClassGroups',
  'GenerateGroupRoundRobin',
  'GenerateBracket',
  'ClearBracket',
  'EliminateLowestBracketRound',
  'AssignTables',
  'SetTournamentTables',
  'AssignMatchToTable',
  'ClearMatchTableAssignment',
  'AdvanceBracketRound',
  'RenamePlayer',
  'Undo',
];

describe('command summary i18n', () => {
  it('catalog contains every footer summary key', () => {
    for (const key of FOOTER_SUMMARY_KEYS) {
      expect(catalog).toHaveProperty(key);
      expect(catalog[key as keyof typeof catalog].en.length).toBeGreaterThan(0);
    }
  });

  it('lists a summary mapping for each command type', () => {
    expect(COMMAND_TYPES.length).toBe(30);
  });
});
