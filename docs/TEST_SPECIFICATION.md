# Tournament Tracker — Test Specification (Pre-Implementation)

This document lists all test cases to be written **before implementation begins**. Tests are organized by priority batch and feature area.

**Test writing approach**:
- Each test follows **Given → When → Then** structure
- Tests use concrete tournament scenarios (real player names, realistic match counts)
- Property-based tests use `fast-check` to generate random valid states
- All tests written as stubs first; implementation follows to pass them

---

## Priority Batch 1: Table Tennis Rules + Bracket Generation (A + B)

### A1: Table Tennis Score Legality Tests

#### Unit Tests: Valid Single-Game Score Transitions

```
Test A1.1: Empty game starts at 0-0
Given: new game
When: initialize
Then: score is (0, 0)

Test A1.2: Valid progression 0-0 → 1-0 → 1-1 → 2-1 ... → 11-9 → win
Given: game with no deuce
When: Player A scores from 10-9
Then: score becomes 11-9 and game is marked "finished" with Player A as winner

Test A1.3: Deuce at 10-10
Given: game with score 10-10
When: Player A scores
Then: score is 11-10 (Player A "advantage")

Test A1.4: Deuce point removal
Given: game at 11-10 (Player A advantage)
When: Player B scores
Then: score goes back to 10-10

Test A1.5: Win from advantage (11-10)
Given: game at 11-10 (Player A advantage)
When: Player A scores again
Then: Player A wins the game

Test A1.6: Win-by-2 from 12-12
Given: deuce at 12-12
When: Player A scores
Then: score is 13-12 (Player A advantage); not yet finished

Test A1.7: Sequential scores form valid monotonic progression
Given: empty game
When: apply sequence of scores [A, B, A, A, B, A, ...] 
Then: each intermediate score is valid (both players' scores ≥ 0, difference ≤ 2 unless pre-deuce)

```

#### Unit Tests: Invalid Score Transitions (Error Handling)

```
Test A1.8: Cannot set absolute scores (must increment via scoring)
Given: game at 5-3
When: attempt to set score directly to (8-2)
Then: error (commands must be granular: "Player A scores", not "set to 8-2")

Test A1.9: Cannot score after game is finished
Given: game finished (winner determined)
When: attempt to add a score
Then: error

Test A1.10: Negative scores rejected
Given: any game state
When: attempt to enter negative score
Then: error

Test A1.11: Impossible score transitions (non-monotonic)
Given: game at 5-3
When: apply score leaving only Player B to advance (e.g., to 6-2) then immediately Player A (to 7-2)
Then: valid; but if we try to create (5-3) → (4-3) [decreasing A's score], error

```

#### Unit Tests: Match Format Configuration

```
Test A1.12: Default best-of-5 (first to 3 wins)
Given: match with [format="best-of-5", pointTarget=11]
When: Player A wins games 1, 2, 3
Then: match is finished; Player A is match winner; games 4 & 5 are not played

Test A1.13: Best-of-3 (first to 2 wins)
Given: match with [format="best-of-3", pointTarget=11]
When: Player A wins games 1, 2
Then: match is finished; game 3 not played

Test A1.14: Custom point target (to 21)
Given: match with [format="best-of-5", pointTarget=21]
When: Player A reaches 21-19
Then: game finishes; Player A wins this game

Test A1.15: Per-stage format variance
Given: tournament with [groupStageFormat="best-of-3", bracketFormat="best-of-5"]
When: player plays group match and later bracket match
Then: group match uses best-of-3, bracket match uses best-of-5

```

#### Unit Tests: Edge Cases & Non-Played Outcomes

```
Test A1.16: Forfeit outcome type
Given: match configured to allow forfeit
When: apply command "Player B forfeits before match starts"
Then: match outcome is "forfeit" (Player A wins); games are not entered

Test A1.17: Walkover (opponent doesn't show)
Given: match with Player A present, Player B absent
When: apply command "Player B walkover"
Then: match outcome is "walkover" (Player A wins); games are not entered

Test A1.18: Retirement mid-match
Given: match at game 3 with scores Game1: A wins 11-9, Game2: B wins 11-8, Game3 @ 5-3 in favor of B
When: apply command "Player A retires"
Then: match is finished; Player B wins match; Game 3 is marked incomplete

Test A1.19: Disqualification
Given: match in progress
When: apply command "Player A disqualified"
Then: match outcome is "disqualified" (Player B wins)

```

#### Property-Based Tests: TT Score Legality

```
Test A1.20: Replay determinism for TT scoring
Property: Given any valid sequence of score commands on a match, replaying the same sequence produces identical final game states
Generator: fast-check to generate random but valid score sequences
If fails: indicates non-determinism in score computation (violation of core TDD principle)

Test A1.21: Score sequence transition validity
Property: Any valid score sequence should never produce an invalid intermediate state during replay
Generator: fast-check generates sequences; all intermediate states must pass legality checks
If fails: indicates replay validation is broken

Test A1.22: Match completion consistency
Property: A match in finished state always has a unique winner; if match not finished, scores never exceed game limit
Generator: fast-check generates partial and finished matches
If fails: indicates incomplete/incorrect match-end detection

```

---

### B1: Bracket Generation & Seeding Tests

#### Unit Tests: Basic Bracket Generation

```
Test B1.1: Single-bracket, power-of-two entry (8 players, no byes)
Given: group results with 8 advancers ranked 1-8
When: generate single-elimination bracket
Then: 
  - bracket has 7 matches (8 → 4 → 2 → 1)
  - seeding is: [1 vs 8, 4 vs 5, 2 vs 7, 3 vs 6] (top half); [5-8 → 4-5 position, etc.]
  - no byes

Test B1.2: Power-of-two fill (6 players, 2 byes)
Given: group results with 6 advancers ranked 1-6, bracket fill enabled
When: generate bracket for 8 slots
Then:
  - bracket has 8 slots (will have 7 matches)
  - players 1 and 2 get byes (free wins in first round)
  - seeding is: [bye-1 advances, 8 vs 7, bye-2 advances, 6 vs 5, 4 vs 3] // adjusted
  - actually: [1 bye, 8 vs 7, 2 bye, 6 vs 5, 3 vs 4] or similar structure

Test B1.3: Bracket generation with 5 players (3 byes to reach 8)
Given: 5 players ranked 1-5, fill to power-of-two enabled
When: generate bracket
Then:
  - top 3 players (1, 2, 3) receive byes
  - 4 vs 5 play in first round
  - winner of 4 vs 5 plays 3 in round 2, etc.

Test B1.4: Cull option: 6 players, cull to 4
Given: 6 players ranked 1-6, cull to previous power-of-two enabled
When: generate bracket
Then:
  - only top 4 (players 1-4) advance
  - players 5 and 6 are eliminated (do not appear in bracket)
  - bracket is: [1 vs 4, 2 vs 3]

```

#### Unit Tests: Seeding Algorithm Constraints

```
Test B1.5: Top-2 separation (no 1 vs 2 until finals)
Given: 8 advancers with players ranked 1-8
When: generate bracket
Then:
  - player 1 bracket position ≠ player 2 bracket position in semis or earlier
  - they only meet if both win to final

Test B1.6: Bracket structure respects power-of-two geometry
Given: 4, 8, or 16 advancers
When: generate bracket
Then:
  - structure is valid binary tree
  - all leaf nodes are at same depth

Test B1.7: Seeding preserves ranking order where possible
Given: 8 players ranked 1-8
When: generate bracket
Then:
  - seed#1 has "easier" half (lower-ranked opponents on average than seed#2)
  - actual strength-of-schedule differs, but structural fairness is maintained

```

#### Unit Tests: Multi-Bracket Generation (Group → Multiple Stages)

```
Test B1.8: Group-stage standings used for bracket seeding
Given: 
  - Group A: Player 1 (3 wins), Player 2 (2 wins), Player 3 (1 win), Player 4 (0 wins)
  - Group B: Player 5 (3 wins), Player 6 (2 wins), Player 7 (1 win), Player 8 (0 wins)
When: generate brackets (e.g., top 2 from each group advance)
Then:
  - Bracket 1: [Player 1 (seed#1) vs Player 5 (seed#2)] and [Player 2 (seed#3) vs Player 6 (seed#4)]
  - (or similar structure respecting cross-group ranking)

Test B1.9: Brackets for multiple bands (split by ranking)
Given: 16 advancers, request for 2 brackets (top 8 and bottom 8)
When: generate brackets
Then:
  - Upper bracket: top 8 players (1-8)
  - Lower bracket: players 9-16
  - winner of lower bracket can play in lower-final or separate playoff

Test B1.10: No bracket generation if insufficient advancers
Given: 2 players advance, bracket requires minimum 4
When: attempt to generate bracket
Then: error or return "no bracket needed" (finals directly)

```

#### Property-Based Tests: Bracket Generation

```
Test B1.11: Bracket determinism
Property: Given same group rankings and same bracket config, generating bracket twice produces identical structure
Generator: fast-check generates random group results and ranking orderings
If fails: indicates non-deterministic seeding algorithm

Test B1.12: Bracket completeness
Property: Bracket must have exactly (n-1) matches for n players, where n is power-of-two
Generator: fast-check generates various player counts and fill/cull settings
If fails: indicates bracket generation produces invalid tree

Test B1.13: Seeding constraint preservation
Property: For 8-player bracket, seed#1 and seed#2 never meet before finals
Generator: fast-check verifies for all generated brackets
If fails: indicates seeding algorithm violates separation rule

Test B1.14: Bracket roundness (all leaves at same depth for given bracket size)
Property: All players in a bracket advance/exit at same round
Generator: fast-check tests various bracket sizes
If fails: indicates unbalanced tree generation

```

---

## Priority Batch 2: Undo Dependency Graph + Command-Result Core (C + E)

### E1: Command-Result Core Tests (foundation for all others)

#### Unit Tests: Command Execution & State Mutation

```
Test E1.1: Command execution produces result
Given: empty tournament state
When: execute command "CreatePlayer(name='Alice', id='p1')"
Then: 
  - command returns result with status="success"
  - tournament state now contains player 'p1' with name='Alice'

Test E1.2: Invalid command rejected with error result
Given: tournament state with existing player 'p1'
When: execute command "CreatePlayer(name='Bob', id='p1')" [duplicate ID]
Then:
  - result status="error"
  - error message indicates duplicate player ID
  - tournament state unchanged

Test E1.3: Commands are applied sequentially
Given: empty state
When: execute commands [CreatePlayer(p1), CreatePlayer(p2), CreateMatch(matchID=m1, players=[p1,p2])]
Then:
  - all three succeed in order
  - final state has 2 players and 1 match
  - match references valid players

```

#### Unit Tests: Deterministic Replay

```
Test E1.4: Replay from JSONL produces identical state
Given: 
  - initial state: empty
  - commandLog: [CreatePlayer(p1), CreatePlayer(p2), CreateMatch(m1, [p1,p2]), EnterScore(m1, game1=[11,9])]
When: 
  - execute commands in sequence → state1
  - load commandLog from file and replay → state2
Then: state1 ≡ state2 (deep equality check)

Test E1.5: Order of deterministic commands does not affect final result
Given: commands that are commutative [CreatePlayer(p1), CreatePlayer(p2)]
When: replay in original order and also in reverse order
Then: final state is identical
Note: some commands are NOT commutative (e.g., match depends on players existing first)

Test E1.6: Randomness in commands is deterministic given seed
Given: tournament with [randomSeed=12345]
When: replay match ordering twice with same seed
Then: match assignments are identical both times

```

#### Unit Tests: JSONL Serialization Round-Trip

```
Test E1.7: Command serialization and deserialization
Given: command "EnterScore(matchID='m1', gameNum=1, scores=[11, 9])"
When: serialize to JSON line, then deserialize
Then: recreated command equals original command

Test E1.8: Full tournament serialization round-trip
Given: complete tournament state with 4 players, 6 group matches, 2 bracket matches
When: serialize state to JSONL, then load and replay commands
Then: final state equals original state

Test E1.9: Partial JSONL load (up to line N) produces correct state
Given: JSONL with 20 commands
When: load only first 10 commands and replay
Then: state matches expected state at that point (useful for undo/branching)

```

#### Property-Based Tests: Command-Result Core

```
Test E1.10: Idempotent read operations
Property: Querying state with multiple read commands doesn't change state
Generator: fast-check generates various query patterns
If fails: indicates read functions have side effects

Test E1.11: All executed commands remain in log
Property: After executing N commands, log always contains exactly N entries
Generator: fast-check generates random command sequences
If fails: indicates command loss or log corruption

Test E1.12: Replay from partial log matches expected state
Property: Loading log up to line N and replaying should match state at that point in full replay
Generator: fast-check generates commands and partition points
If fails: indicates replay determinism violation

```

---

### C1: Undo Dependency Graph Tests (critical architecture)

#### Unit Tests: Dependency Tracking

```
Test C1.1: Single command with no dependencies can always be undone
Given: tournament with single command "CreatePlayer(p1)"
When: query canUndo(p1-creation-command)
Then: returns true

Test C1.2: Command blocked if later command depends on it
Given:
  - command 1: CreatePlayer(p1)
  - command 2: CreateMatch(m1, [p1, ...])
  - command 2 depends on command 1 (references p1)
When: query canUndo(command 1)
Then: returns false (because command 2 depends on it)

Test C1.3: Command can be undone if dependent is already undone
Given:
  - command 1: CreatePlayer(p1)
  - command 2: CreateMatch(m1, [p1, ...])
  - command 2 already undone
When: query canUndo(command 1)
Then: returns true (no active dependents)

Test C1.4: Independent commands can be undone in any order
Given:
  - command 1: CreatePlayer(p1)
  - command 2: CreatePlayer(p2)
  - command 3: CreateRound(round1)
  - (commands 1, 2 independent; 3 independent of 1 & 2)
When: undo command 1, then 3, then 2
Then:
  - all succeed
  - final state has no players, no rounds

Test C1.5: Circular dependency detection (should not occur in valid commands)
Given: tournament log with no circular command dependencies
When: compute dependency DAG
Then: DAG is acyclic (no cycles detected)

```

#### Unit Tests: Selective Undo Operations

```
Test C1.6: Undo command by ID
Given: command log [cmd1, cmd2, cmd3], all independent
When: undo(cmd2)
Then:
  - cmd2 is removed from log and history
  - cmd1, cmd3 remain active
  - state reverts as if cmd2 never executed

Test C1.7: Undo triggers dependent removal if auto-mode enabled
Given:
  - cmd1: CreateMatch(m1)
  - cmd2: EnterScore(m1, ...)
  - canUndo(cmd1) = false (cmd2 depends on it)
When: attempt undo(cmd1) with auto-dependent-removal=true
Then:
  - cmd2 is also undone
  - result: "Undid cmd2 (dependent); then undid cmd1"

Test C1.8: Undo rejection with reason
Given:
  - cmd1: CreateMatch(m1)
  - cmd2: EnterScore(m1, ...)
When: undo(cmd1) with auto-dependent-removal=false
Then: error "Cannot undo cmd1; dependent commands exist: [cmd2]"

Test C1.9: Undo lock/finalization
Given: round that is locked/finalized
When: undo(lock-command)
Then:
  - lock is removed
  - warning issued ("Undid finalization; dependent bracket stages must be manually removed")

```

#### Unit Tests: Redo & Branch Semantics

```
Test C1.10: Redo after undo
Given: 
  - log [cmd1, cmd2, cmd3]
  - undo(cmd2)
Then:
  - log is [cmd1, cmd3]
When: redo()
Then: cmd2 is restored to log
And: state matches state before undo(cmd2)

Test C1.11: Redo blocked if new command issued
Given:
  - undone cmd2
When: execute new command cmd4
Then:
  - cmd4 is appended
  - log is now [cmd1, cmd3, cmd4]
  - redo() is no longer available (history branch not preserved)

Test C1.12: Multiple undos and selective redo
Given:
  - log [cmd1, cmd2, cmd3] all independent
  - undo(cmd1), undo(cmd3)
Then: log is [cmd2]
When: redo (most recent undo) [which is cmd3]
Then: log is [cmd2, cmd3]

```

#### Property-Based Tests: Undo Dependency Graph

```
Test C1.13: Undo/redo result in deterministic state
Property: Undo + redo of any command sequence results in state identical to before undo
Generator: fast-check generates commands, undo sequences, redo patterns
If fails: indicates undo/redo non-determinism

Test C1.14: Dependency graph acyclicity
Property: For any valid command sequence, the dependency DAG is acyclic
Generator: fast-check generates various command orders
If fails: indicates circular dependency creation (architectural bug)

Test C1.15: Independent command subset can be undone in any subset order
Property: For N independent commands, any subset can be undone in any order; remaining commands' state is identical
Generator: fast-check generates independent command sets and random undo orderings
If fails: indicates undo order sensitivity for independent commands

```

---

## Priority Batch 3: Team-Versus-Team Match Logic (D)

### D1: Team-Versus-Team Match Structure

#### Unit Tests: Team Composition & Matchup Generation

```
Test D1.1: Even-sized teams (3v3)
Given: Team A [p1, p2, p3], Team B [p4, p5, p6]
When: generate all individual matchups
Then:
  - 9 matches total (each Team A player vs each Team B player)
  - matches: p1-p4, p1-p5, p1-p6, p2-p4, p2-p5, p2-p6, p3-p4, p3-p5, p3-p6

Test D1.2: Unequal teams (2v4)
Given: Team A [p1, p2], Team B [p4, p5, p6, p7]
When: generate matchups with constraint "equal match count per player"
Then:
  - If constraint is "all players play same # matches": each A player plays 4, each B player plays 2
  - Total 8 matches (not 2×4=8, but constrained by 2 being smaller)

Test D1.3: Team result: match-win tiebreaker
Given:
  - Team A vs Team B matchups all complete
  - Team A wins 5 matches, Team B wins 4 matches
When: determine team winner
Then: Team A wins (more match wins)

Test D1.4: Team result: game-win tiebreaker
Given:
  - Team A wins 4 matches, Team B wins 4 matches
  - Team A total games won: 14, Team B total games won: 12
When: determine team winner
Then: Team A wins (more games/sets won)

Test D1.5: Team result: points tiebreaker
Given:
  - Same matches won: 4 each
  - Same games won: 12 each
  - Team A total points: 135, Team B total points: 132
When: determine team winner
Then: Team A wins (more points scored)

```

#### Unit Tests: Team Seeding & Bracket Placement

```
Test D1.6: Team bracket seeding from group
Given:
  - Group with 4 teams: 
    - Team A: 3 wins (strongest)
    - Team B: 2 wins
    - Team C: 1 win
    - Team D: 0 wins
When: generate semifinals bracket
Then: 
  - seeding is [Team A seed#1 vs Team D seed#4, Team B seed#2 vs Team C seed#3]

Test D1.7: Team strength aggregation (for seeding)
Given: 
  - Team A [p1 (strong), p2 (weak), p3 (medium)]
  - Team B [p4 (medium), p5 (strong), p6 (weak)]
When: compute team strength for seeding
Then: 
  - approach 1 (strongest player): both teams same strength (p1 & p5)
  - approach 2 (average): Team A and B have similar average
  - decision: use aggregate or strongest 2? [to be specified based on balance preference]

Test D1.8: Scheduling: both teams play balanced rounds
Given: Team A [p1, p2], Team B [p4, p5, p6, p7]
When: schedule rounds such that max(team-wise players per round) = min-team-size or less
Then:
  - Round 1: p1 plays p4, p2 plays p5 (each team has 1 active match)
  - Round 2: p1 plays p6, p2 plays p7
  - No round has Team A with 2 players in parallel (impossible; only 2 players)
  - Each round is balanced / fair break time

```

#### Property-Based Tests: Team-Versus-Team

```
Test D1.14: Team result determinism
Property: Determining team winner from same individual match results always produces same outcome
Generator: fast-check generates match result sets; run multiple times
If fails: indicates non-deterministic team-result computation

Test D1.15: All individual matchups accounted for in team result
Property: Team result should reflect all individual match outcomes; no match lost or duplicated
Generator: fast-check generates team compositions and match results
If fails: indicates missing or duplicate matchups in calculation

```

---

## Cross-Cutting Test Patterns (All Batches)

### Integration Tests: E2E Tournament Flow

```
Test INT.1: Simple individual tournament (8 players, group→bracket)
Given: 
  - tournament initialized
  - 8 players added: Alice, Bob, Carol, Dave, Eve, Frank, Grace, Henry
  - format: round-robin group stage → single-elim bracket
When: 
  - execute group stage (4 rounds, round-robin within group)
  - enter all match scores (realistic, varying winners)
  - generate bracket from final standings
  - execute bracket matches (simulate finals)
Then:
  - standings computed correctly (wins, tiebreakers)
  - bracket structure respects seeding
  - final winner determined

Test INT.2: Team tournament (2 teams of 4, team-v-team format)
Given:
  - Team Red: [Alice, Bob, Carol, Dave]
  - Team Blue: [Eve, Frank, Grace, Henry]
  - all individual matchups scheduled
When:
  - enter all match scores
  - compute team result
Then:
  - team winner determined
  - all tiebreakers properly applied

Test INT.3: Tournament state recovery from JSONL
Given: 
  - tournament with 4 players, 6 matches, 2 rounds, 12 scores entered
  - export to JSONL file
When: 
  - close application
  - reopen file, reload tournament, replay commands
Then:
  - state identical to before export
  - all match results, standings, bracket unchanged

```

### Mutation Tests: Catch Missing Assertions

```
Test MUT.1: Changing a score constraint should break tests
Example: Change "win-by-2" logic to "win-by-1"; many TT tests should fail

Test MUT.2: Removing dependency tracking should fail undo tests
Example: Comment out dependency check in undo; unrelated-command undo should fail

Test MUT.3: Disabling deterministic seed should fail replay tests
Example: Introduce randomness in iteration order; property tests should fail

```

---

## Test Data & Fixtures

### Reusable Test Fixtures

**Standard 8-player tournament (Batch 1 baseline)**:
```typescript
const fixture8PlayerGroupBracket = {
  players: [
    { id: 'p1', name: 'Alice', seedRank: 1 },
    { id: 'p2', name: 'Bob', seedRank: 2 },
    // ... p3-p8
  ],
  groupMatches: [
    // 28 round-robin matches (8 players, ~4 rounds)
  ],
  expectedGroupWinners: ['p1', 'p5', 'p3', 'p7'],
  expectedBracketSeeding: [
    // [ p1 vs p7, p5 vs p3 ] in semis
  ]
}
```

**Team-versus-team fixture (Batch 3)**:
```typescript
const fixtureTeamVsTeam = {
  teamRed: ['p1', 'p2', 'p3', 'p4'],
  teamBlue: ['p5', 'p6', 'p7', 'p8'],
  matchResults: [
    // 16 matches (4v4), with various winners
  ],
  expectedTeamWinner: 'Red' // or 'Blue' based on results
}
```

---

## Success Criteria

A test is considered **ready to implement** when:
1. **Written in stub form** (describe/it blocks with minimal assertions)
2. **References actual domain types** (not just strings)
3. **Has clear Given-When-Then structure**
4. **Property-based tests have generator logic sketched**
5. **Integration tests have realistic data**
6. **Can reasonably be completed within 1-2 hours of implementation per batch**

Once Batch 1 tests pass, proceed to Batch 2. Once Batch 2 passes, proceed to Batch 3.

---

## Notes

- **No UI tests in this spec**: View/Controller tests come after domain layer is solid
- **No storage tests yet**: File I/O tests deferred until JSONL format is stable
- **Mock result generation**: deferred to after core tests; will use established command infra

